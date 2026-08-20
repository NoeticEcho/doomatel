import { describe, expect, it } from 'vitest';
import { buildMastra } from '../src/mastra/index.js';
import { loadModelsConfig, toMastraModel } from '../src/mastra/models/index.js';
import {
  corruptionMarkersTool,
  extractReferencesTool,
  parseActStructureTool,
} from '../src/mastra/tools/legal-analysis.js';

/**
 * Проверка сборки сервиса агентов.
 *
 * Тесты не обращаются к языковой модели: они проверяют то, что ломается чаще
 * всего и молча — состав агентов, наличие инструментов у нужных ролей,
 * работу детерминированных инструментов и отказ при отсутствии настройки.
 */

const ENV = {
  LLM_BASE_URL: 'http://127.0.0.1:8000/v1',
  LLM_MODEL: 'qwen3-32b-instruct',
  LLM_PROVIDER_ID: 'vllm',
  QDRANT_URL: 'http://127.0.0.1:6333',
  EMBEDDINGS_BASE_URL: 'http://127.0.0.1:8001/v1',
  EMBEDDINGS_MODEL: 'deepvk/USER-bge-m3',
  API_URL: 'http://127.0.0.1:3001',
} as NodeJS.ProcessEnv;

describe('настройка моделей', () => {
  it('требует явного указания адреса модели', () => {
    // Молчаливый переход на внешний сервис недопустим: лучше не запуститься.
    expect(() => loadModelsConfig({} as NodeJS.ProcessEnv)).toThrow(/LLM_BASE_URL/u);
  });

  it('строит конфигурацию для совместимого эндпоинта', () => {
    const config = loadModelsConfig(ENV);
    expect(config.primary.modelId).toBe('qwen3-32b-instruct');
    expect(config.primary.url).toBe('http://127.0.0.1:8000/v1');

    const model = toMastraModel(config.primary) as { id: string; url: string };
    expect(model.id).toBe('vllm/qwen3-32b-instruct');
    expect(model.url).toBe('http://127.0.0.1:8000/v1');
  });

  it('разные роли моделей настраиваются независимо', () => {
    const config = loadModelsConfig({
      ...ENV,
      LLM_MODEL_FAST: 'qwen3-8b-instruct',
    } as NodeJS.ProcessEnv);
    expect(config.fast.modelId).toBe('qwen3-8b-instruct');
    expect(config.primary.modelId).toBe('qwen3-32b-instruct');
  });
});

describe('сборка Mastra', () => {
  const mastra = buildMastra({ env: ENV });

  it('регистрирует всех предметных агентов', () => {
    const agents = mastra.listAgents();
    expect(Object.keys(agents).sort()).toEqual([
      'analyst',
      'drafter',
      'expert',
      'finance',
      'speech',
      'supervisor',
    ]);
  });

  it('регистрирует рабочий процесс подготовки законопроекта', () => {
    expect(Object.keys(mastra.listWorkflows())).toContain('billDrafting');
  });

  it('у каждого агента есть описание — по нему координатор выбирает исполнителя', async () => {
    for (const [key, agent] of Object.entries(mastra.listAgents())) {
      const description = agent.getDescription();
      expect(description, `агент ${key}`).toBeTruthy();
      expect(description.length, `агент ${key}`).toBeGreaterThan(30);
    }
  });

  it('у составителя есть инструменты поиска и работы с документами', async () => {
    const tools = await mastra.getAgent('drafter').listTools();
    const names = Object.keys(tools);
    expect(names).toContain('searchLegalCorpus');
    expect(names).toContain('suggestDraftEdit');
  });

  it('у эксперта есть инструменты антикоррупционной экспертизы', async () => {
    const names = Object.keys(await mastra.getAgent('expert').listTools());
    expect(names).toContain('findCorruptionMarkers');
    expect(names).toContain('listCorruptionFactors');
  });

  it('координатор не имеет предметных инструментов и обязан делегировать', async () => {
    const names = Object.keys(await mastra.getAgent('supervisor').listTools());
    expect(names).not.toContain('searchLegalCorpus');
  });

  it('инструкции запрещают воспроизводить нормы по памяти', async () => {
    for (const key of ['analyst', 'drafter', 'expert', 'finance', 'speech']) {
      const instructions = await mastra.getAgent(key).getInstructions();
      expect(String(instructions), `агент ${key}`).toContain('по памяти');
    }
  });
});

describe('детерминированные инструменты', () => {
  const emptyContext = { requestContext: new Map() } as never;

  it('извлекает ссылки из текста', async () => {
    const result = (await extractReferencesTool.execute!(
      {
        text: 'В соответствии с частью 3 статьи 15 Федерального закона от 27.07.2006 № 149-ФЗ...',
        minConfidence: 0.5,
      },
      emptyContext,
    )) as { references: Array<{ actUri: string; path: string }>; total: number };

    expect(result.total).toBeGreaterThan(0);
    expect(result.references[0]!.actUri).toBe('eli:rf:federal-law:2006-07-27:149-fz');
    expect(result.references[0]!.path).toBe('st_15/p_3');
  });

  it('разбирает структуру акта', async () => {
    const result = (await parseActStructureTool.execute!(
      {
        text: 'Статья 1. Предмет\n\n1. Первая часть.\n2. Вторая часть.\n',
        articleChildKind: 'clause',
      },
      emptyContext,
    )) as { units: Array<{ path: string; kind: string }> };

    const paths = result.units.map((unit) => unit.path);
    expect(paths).toContain('st_1');
    expect(paths).toContain('st_1/p_1');
  });

  it('находит маркеры коррупциогенных факторов и перечисляет непроверяемые по словам', async () => {
    const result = (await corruptionMarkersTool.execute!(
      { text: 'Уполномоченный орган вправе принять решение в разумный срок.' },
      emptyContext,
    )) as {
      hits: Array<{ factorCode: string; factorName: string; clause: string }>;
      factorsWithoutMarkers: Array<{ code: string }>;
    };

    expect(result.hits.map((hit) => hit.factorCode)).toContain('discretion.b');
    expect(result.hits[0]!.clause).toMatch(/пункта [34]/u);
    // Факторы, не выявляемые по словам, обязаны попадать в отчёт:
    // иначе экспертиза выглядела бы полной, не будучи таковой.
    expect(result.factorsWithoutMarkers.length).toBeGreaterThan(0);
  });
});
