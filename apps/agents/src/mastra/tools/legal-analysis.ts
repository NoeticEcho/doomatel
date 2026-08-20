import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  CORRUPTION_FACTORS,
  CORRUPTION_FACTOR_BY_CODE,
  actUri,
  extractReferences,
  findCorruptionMarkers,
  flattenAct,
  parseAct,
  unitPathToString,
} from '@doomatel/legal';

/**
 * Инструменты разбора и проверки правовых текстов.
 *
 * Все они детерминированные: разбор ссылок, структуры и поиск маркеров
 * коррупциогенных факторов выполняются кодом, а не моделью. Модель получает
 * результат разбора и рассуждает над ним.
 *
 * Причина такого разделения проста: у извлечения ссылок и структурного разбора
 * есть проверяемый правильный ответ, и там, где он есть, программа надёжнее
 * модели. Модели остаётся то, где правильного ответа механически нет —
 * оценка существенности фактора, формулировка вывода, выбор редакции нормы.
 */

/** Извлечение ссылок на нормативные правовые акты из текста. */
export const extractReferencesTool = createTool({
  id: 'extract-legal-references',
  description:
    'Найти в тексте все ссылки на нормативные правовые акты и их структурные единицы ' +
    '(«пункта 2 части 3 статьи 15 Федерального закона от 27.07.2006 № 149-ФЗ»). ' +
    'Возвращает разобранные ссылки с устойчивыми идентификаторами. ' +
    'Используй перед анализом чужого текста, чтобы понять, на какие нормы он опирается.',
  inputSchema: z.object({
    text: z.string().min(1).describe('Текст для разбора'),
    minConfidence: z.number().min(0).max(1).default(0.5),
  }),
  outputSchema: z.object({
    references: z.array(
      z.object({
        raw: z.string().describe('Как ссылка записана в тексте'),
        actUri: z.string().describe('Устойчивый идентификатор акта'),
        actType: z.string(),
        actNumber: z.string().optional(),
        actDate: z.string().optional(),
        path: z.string().describe('Путь к структурной единице'),
        confidence: z.number(),
      }),
    ),
    total: z.number(),
  }),
  execute: async (input) => {
    const references = extractReferences(input.text, {
      minConfidence: input.minConfidence,
    });
    return {
      references: references.map((reference) => ({
        raw: reference.raw,
        actUri: actUri(reference),
        actType: reference.type,
        actNumber: reference.number,
        actDate: reference.date,
        path: unitPathToString(reference.path),
        confidence: reference.confidence,
      })),
      total: references.length,
    };
  },
});

/** Разбор структуры нормативного правового акта. */
export const parseActStructureTool = createTool({
  id: 'parse-act-structure',
  description:
    'Разобрать текст акта или законопроекта на структурные единицы: разделы, главы, ' +
    'статьи, части, пункты, подпункты. Возвращает дерево с путями к каждой единице. ' +
    'Используй, чтобы точно адресовать правки: «изложить часть 3 статьи 15 в редакции…».',
  inputSchema: z.object({
    text: z.string().min(1),
    articleChildKind: z
      .enum(['clause', 'item'])
      .default('clause')
      .describe(
        'На что делится статья: «часть» для федеральных законов, «пункт» для кодексов',
      ),
  }),
  outputSchema: z.object({
    title: z.string().optional(),
    actTypeLabel: z.string().optional(),
    units: z.array(
      z.object({
        kind: z.string(),
        number: z.string().optional(),
        heading: z.string().optional(),
        path: z.string(),
        depth: z.number(),
        textPreview: z.string(),
      }),
    ),
    warnings: z.array(z.string()),
  }),
  execute: async (input) => {
    const act = parseAct(input.text, { articleChildKind: input.articleChildKind });
    const flat = flattenAct(act);
    return {
      title: act.title,
      actTypeLabel: act.actTypeLabel,
      units: flat.map((unit) => ({
        kind: unit.kind,
        number: unit.number,
        heading: unit.heading,
        path: unit.pathString,
        depth: unit.depth,
        textPreview: unit.ownText.slice(0, 200),
      })),
      warnings: act.warnings,
    };
  },
});

/**
 * Предварительная проверка на коррупциогенные факторы.
 *
 * Инструмент возвращает **места, требующие оценки**, а не заключение.
 * Заключение по каждому фактору формулирует агент-эксперт, опираясь на
 * определение из методики: маркер вроде слова «вправе» сам по себе нарушением
 * не является, и выдавать его за нарушение означало бы завалить депутата
 * ложными срабатываниями.
 */
export const corruptionMarkersTool = createTool({
  id: 'find-corruption-markers',
  description:
    'Найти в тексте проекта места, требующие оценки на коррупциогенные факторы ' +
    'по методике, утверждённой постановлением Правительства Российской Федерации ' +
    'от 26.02.2010 № 96. Возвращает найденные маркеры с контекстом и определением ' +
    'соответствующего фактора. Это подсказка для экспертизы, а не заключение: ' +
    'по каждому маркеру нужно оценить, действительно ли фактор присутствует.',
  inputSchema: z.object({
    text: z.string().min(1),
    factorCodes: z
      .array(z.string())
      .optional()
      .describe('Ограничить проверку конкретными факторами'),
  }),
  outputSchema: z.object({
    hits: z.array(
      z.object({
        factorCode: z.string(),
        factorName: z.string(),
        factorDefinition: z.string(),
        clause: z.string().describe('Пункт методики'),
        checkQuestion: z.string(),
        marker: z.string(),
        context: z.string(),
        position: z.number(),
      }),
    ),
    factorsWithoutMarkers: z
      .array(z.object({ code: z.string(), name: z.string(), checkQuestion: z.string() }))
      .describe(
        'Факторы, которые не выявляются по языковым маркерам и требуют содержательной оценки',
      ),
  }),
  execute: async (input) => {
    const all = findCorruptionMarkers(input.text);
    const filtered = input.factorCodes
      ? all.filter((hit) => input.factorCodes!.includes(hit.factorCode))
      : all;

    const hits = filtered.map((hit) => {
      const factor = CORRUPTION_FACTOR_BY_CODE.get(hit.factorCode)!;
      return {
        factorCode: hit.factorCode,
        factorName: factor.name,
        factorDefinition: factor.definition,
        clause: factor.clause,
        checkQuestion: factor.checkQuestion,
        marker: hit.marker,
        context: hit.context,
        position: hit.span[0],
      };
    });

    // Часть факторов принципиально не выявляется по словам: например,
    // принятие акта за пределами компетенции. Их нужно проверять по существу,
    // и агент должен об этом знать, иначе экспертиза окажется неполной.
    const withMarkers = new Set(hits.map((hit) => hit.factorCode));
    const factorsWithoutMarkers = CORRUPTION_FACTORS.filter(
      (factor) => !withMarkers.has(factor.code),
    ).map((factor) => ({
      code: factor.code,
      name: factor.name,
      checkQuestion: factor.checkQuestion,
    }));

    return { hits, factorsWithoutMarkers };
  },
});

/** Полный перечень коррупциогенных факторов — как справочник для агента. */
export const corruptionFactorsReferenceTool = createTool({
  id: 'list-corruption-factors',
  description:
    'Получить полный перечень коррупциогенных факторов с определениями по методике ' +
    'проведения антикоррупционной экспертизы. Используй, чтобы построить структуру заключения.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    factors: z.array(
      z.object({
        code: z.string(),
        group: z.string(),
        clause: z.string(),
        name: z.string(),
        definition: z.string(),
        checkQuestion: z.string(),
      }),
    ),
  }),
  execute: async () => ({
    factors: CORRUPTION_FACTORS.map((factor) => ({
      code: factor.code,
      group: factor.group,
      clause: factor.clause,
      name: factor.name,
      definition: factor.definition,
      checkQuestion: factor.checkQuestion,
    })),
  }),
});
