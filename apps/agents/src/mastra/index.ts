import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { QdrantClient } from '@qdrant/js-client-rest';
import { EmbeddingsClient, RerankerClient } from '@doomatel/retrieval';

import {
  createAnalystAgent,
  createDrafterAgent,
  createExpertAgent,
  createFinanceAgent,
  createSpeechAgent,
  createSupervisorAgent,
  type AgentDeps,
} from './agents/index.js';
import { loadModelsConfig, toMastraModel } from './models/index.js';
import { createActUnitTool, createLegalSearchTool } from './tools/legal-search.js';
import {
  corruptionFactorsReferenceTool,
  corruptionMarkersTool,
  extractReferencesTool,
  parseActStructureTool,
} from './tools/legal-analysis.js';
import {
  createBillCardTool,
  createBillSearchTool,
  createReadDraftTool,
  createSuggestEditTool,
  createTaskTool,
} from './tools/platform.js';
import { createBillDraftingWorkflow } from './workflows/bill-drafting.js';

/**
 * Сборка сервиса агентов.
 *
 * Сервис вынесен отдельно от прикладного API намеренно. Работа агента над
 * законопроектом занимает минуты и потребляет много памяти под контекст;
 * держать это в одном процессе с обработкой обычных запросов означало бы,
 * что тяжёлый агентный запуск влияет на отзывчивость интерфейса.
 * Раздельные процессы масштабируются независимо: интерфейсу нужны
 * многочисленные лёгкие обработчики, агентам — немногочисленные тяжёлые.
 */

export interface BuildMastraOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * Извлечение прав пользователя из контекста запроса. Задаётся сервером,
   * который проверил токен, — модель на это влиять не может.
   */
  resolveAccessScope?: (requestContext: unknown) => {
    userId: string;
    projectIds: string[];
    tenantIds: string[];
  };
  authHeaders?: (requestContext: unknown) => Record<string, string>;
}

/** Значения прав по умолчанию: только публичный корпус. */
const PUBLIC_ONLY_SCOPE = { userId: 'anonymous', projectIds: [], tenantIds: ['public'] };

function readRequestContext(requestContext: unknown): Record<string, unknown> {
  if (requestContext && typeof requestContext === 'object') {
    const maybeGet = (requestContext as { get?: (key: string) => unknown }).get;
    if (typeof maybeGet === 'function') {
      return {
        userId: maybeGet.call(requestContext, 'userId'),
        projectIds: maybeGet.call(requestContext, 'projectIds'),
        tenantIds: maybeGet.call(requestContext, 'tenantIds'),
        accessToken: maybeGet.call(requestContext, 'accessToken'),
      };
    }
    return requestContext as Record<string, unknown>;
  }
  return {};
}

export function buildMastra(options: BuildMastraOptions = {}) {
  const env = options.env ?? process.env;
  const modelsConfig = loadModelsConfig(env);

  const models = {
    primary: toMastraModel(modelsConfig.primary),
    fast: toMastraModel(modelsConfig.fast),
    long: toMastraModel(modelsConfig.long),
  };

  const qdrant = new QdrantClient({
    url: env['QDRANT_URL'] ?? 'http://127.0.0.1:6333',
    ...(env['QDRANT_API_KEY'] ? { apiKey: env['QDRANT_API_KEY'] } : {}),
  });

  const embeddings = new EmbeddingsClient({
    baseUrl: env['EMBEDDINGS_BASE_URL'] ?? 'http://127.0.0.1:8001/v1',
    ...(env['EMBEDDINGS_API_KEY'] ? { apiKey: env['EMBEDDINGS_API_KEY'] } : {}),
    model: env['EMBEDDINGS_MODEL'] ?? 'deepvk/USER-bge-m3',
    dimensions: Number(env['EMBEDDINGS_DIMENSIONS'] ?? 1024),
  });

  const reranker = env['RERANKER_URL']
    ? new RerankerClient({
        url: env['RERANKER_URL'],
        ...(env['RERANKER_MODEL'] ? { model: env['RERANKER_MODEL'] } : {}),
      })
    : undefined;

  const resolveAccessScope =
    options.resolveAccessScope ??
    ((requestContext: unknown) => {
      const context = readRequestContext(requestContext);
      const userId = typeof context['userId'] === 'string' ? context['userId'] : undefined;
      if (!userId) return PUBLIC_ONLY_SCOPE;
      return {
        userId,
        projectIds: Array.isArray(context['projectIds'])
          ? (context['projectIds'] as string[])
          : [],
        tenantIds: Array.isArray(context['tenantIds']) ? (context['tenantIds'] as string[]) : [],
      };
    });

  const defaultAuthHeaders = (requestContext: unknown): Record<string, string> => {
    const context = readRequestContext(requestContext);
    const token = context['accessToken'];
    return typeof token === 'string' ? { authorization: `Bearer ${token}` } : {};
  };
  const authHeaders = options.authHeaders ?? defaultAuthHeaders;

  const searchDeps = { qdrant, embeddings, ...(reranker ? { reranker } : {}), resolveAccessScope };
  const platformDeps = {
    baseUrl: env['API_URL'] ?? 'http://127.0.0.1:3001',
    authHeaders,
  };

  const tools = {
    search: {
      searchLegalCorpus: createLegalSearchTool(searchDeps),
      getLegalUnit: createActUnitTool(searchDeps),
    },
    analysis: {
      extractReferences: extractReferencesTool,
      parseActStructure: parseActStructureTool,
      findCorruptionMarkers: corruptionMarkersTool,
      listCorruptionFactors: corruptionFactorsReferenceTool,
    },
    bills: {
      searchBills: createBillSearchTool(platformDeps),
      getBill: createBillCardTool(platformDeps),
    },
    documents: {
      readDraft: createReadDraftTool(platformDeps),
      suggestDraftEdit: createSuggestEditTool(platformDeps),
      createTask: createTaskTool(platformDeps),
    },
  };

  // Постоянное хранилище нужно не для удобства: без него приостановленный
  // рабочий процесс не переживёт перезапуск сервиса, и депутат потеряет
  // документ, ожидающий визы.
  const storage = env['DATABASE_URL']
    ? new PostgresStore({ connectionString: env['DATABASE_URL'], schemaName: 'mastra' })
    : undefined;

  const memory = storage
    ? new Memory({
        storage,
        options: {
          lastMessages: 20,
          workingMemory: {
            enabled: true,
            template: `# Контекст работы депутата
- Проект: {{project}}
- Законопроект: {{bill}}
- Стадия: {{stage}}
- Ключевые решения: {{decisions}}
- Открытые вопросы: {{openQuestions}}`,
          },
        },
      })
    : undefined;

  const agentDeps: AgentDeps = { models, tools, ...(memory ? { memory } : {}) };

  const analyst = createAnalystAgent(agentDeps);
  const drafter = createDrafterAgent(agentDeps);
  const expert = createExpertAgent(agentDeps);
  const finance = createFinanceAgent(agentDeps);
  const speech = createSpeechAgent(agentDeps);

  const billDrafting = createBillDraftingWorkflow({ analyst, drafter, expert, finance });

  const supervisor = createSupervisorAgent(
    agentDeps,
    { analyst, drafter, expert, finance, speech },
    { billDrafting },
  );

  return new Mastra({
    agents: { supervisor, analyst, drafter, expert, finance, speech },
    workflows: { billDrafting },
    ...(storage ? { storage } : {}),
    logger: new PinoLogger({ name: 'doomatel-agents', level: 'info' }),
  });
}

export type DoomatelMastra = ReturnType<typeof buildMastra>;
