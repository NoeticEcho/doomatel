import { createTool } from '@mastra/core/tools';
import { request } from 'undici';
import { z } from 'zod';

/**
 * Инструменты обращения к прикладному сервису.
 *
 * Агенты не ходят в базу напрямую. Причина не в удобстве, а в безопасности:
 * все правила разграничения доступа реализованы в прикладном сервисе и
 * политиках базы, и обход этого слоя означал бы, что права пользователя
 * зависят от того, что модель решит запросить. Поэтому агент вызывает те же
 * методы, что и интерфейс, и с теми же правами.
 */

export interface PlatformToolsDeps {
  /** Базовый адрес прикладного сервиса. */
  baseUrl: string;
  /** Формирует заголовки авторизации от имени текущего пользователя. */
  authHeaders: (requestContext: unknown) => Record<string, string>;
  timeoutMs?: number;
}

async function callApi<T>(
  deps: PlatformToolsDeps,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> },
  requestContext: unknown,
): Promise<T> {
  const url = new URL(`${deps.baseUrl.replace(/\/$/, '')}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const response = await request(url, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...deps.authHeaders(requestContext),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headersTimeout: deps.timeoutMs ?? 30_000,
    bodyTimeout: deps.timeoutMs ?? 30_000,
  });

  const text = await response.body.text();
  if (response.statusCode >= 400) {
    throw new Error(`Сервис вернул ${response.statusCode} на ${path}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

/** Поиск законопроектов в базе СОЗД. */
export function createBillSearchTool(deps: PlatformToolsDeps) {
  return createTool({
    id: 'search-bills',
    description:
      'Поиск законопроектов, внесённых в Государственную Думу. Позволяет узнать, ' +
      'вносились ли по теме законопроекты ранее и чем закончилось их рассмотрение. ' +
      'Это важно: повторное внесение отклонённого проекта требует иной аргументации.',
    inputSchema: z.object({
      query: z.string().optional().describe('Поиск по наименованию'),
      number: z.string().optional().describe('Точный номер, например 149922-8'),
      convocation: z.number().int().optional(),
      statusCodes: z
        .array(z.number().int())
        .optional()
        .describe('Коды статуса: 1 — внесён, 2 — на рассмотрении, 7 — подписан, 8 — отклонён'),
      committeeId: z.number().int().optional(),
      introducedFrom: z.string().optional(),
      introducedTo: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    outputSchema: z.object({
      bills: z.array(
        z.object({
          number: z.string(),
          name: z.string(),
          introductionDate: z.string().optional(),
          statusText: z.string().optional(),
          lastEventDate: z.string().optional(),
          responsibleCommittee: z.string().optional(),
          initiators: z.array(z.string()).optional(),
          sozdUrl: z.string(),
        }),
      ),
      total: z.number(),
    }),
    execute: async (input, { requestContext }) =>
      callApi(
        deps,
        '/api/bills/search',
        { method: 'POST', body: input },
        requestContext,
      ),
  });
}

/** Карточка законопроекта с хронологией. */
export function createBillCardTool(deps: PlatformToolsDeps) {
  return createTool({
    id: 'get-bill',
    description:
      'Получить полную карточку законопроекта: паспорт, хронологию рассмотрения, ' +
      'перечень сопроводительных документов, решения по чтениям.',
    inputSchema: z.object({
      number: z.string().describe('Номер законопроекта, например 149922-8'),
      includeDocuments: z.boolean().default(true),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      bill: z.record(z.string(), z.unknown()).optional(),
      events: z.array(z.record(z.string(), z.unknown())).optional(),
      documents: z.array(z.record(z.string(), z.unknown())).optional(),
    }),
    execute: async (input, { requestContext }) =>
      callApi(
        deps,
        `/api/bills/${encodeURIComponent(input.number)}`,
        { query: { documents: String(input.includeDocuments) } },
        requestContext,
      ),
  });
}

/** Чтение рабочего документа проекта. */
export function createReadDraftTool(deps: PlatformToolsDeps) {
  return createTool({
    id: 'read-draft',
    description:
      'Прочитать рабочий документ проекта: текст законопроекта, пояснительную записку, ' +
      'финансово-экономическое обоснование, таблицу поправок.',
    inputSchema: z.object({
      draftId: z.string().uuid(),
    }),
    outputSchema: z.object({
      id: z.string(),
      title: z.string(),
      kind: z.string(),
      status: z.string(),
      plainText: z.string(),
      version: z.number(),
    }),
    execute: async (input, { requestContext }) =>
      callApi(deps, `/api/drafts/${input.draftId}`, {}, requestContext),
  });
}

/**
 * Предложение правки в рабочий документ.
 *
 * Агент не изменяет документ напрямую — он создаёт предложение правки,
 * которое человек принимает или отклоняет. Это соответствует принятому
 * порядку работы с поправками и оставляет решение за депутатом.
 */
export function createSuggestEditTool(deps: PlatformToolsDeps) {
  return createTool({
    id: 'suggest-draft-edit',
    description:
      'Предложить правку в рабочий документ. Правка не применяется сразу: она ' +
      'появляется у автора документа как предложение, которое он принимает или ' +
      'отклоняет. Используй этот инструмент вместо переписывания документа целиком.',
    inputSchema: z.object({
      draftId: z.string().uuid(),
      kind: z.enum(['insert', 'delete', 'replace', 'comment']),
      anchorBlockId: z
        .string()
        .optional()
        .describe('Идентификатор блока документа, к которому относится правка'),
      quotedText: z.string().optional().describe('Фрагмент, который заменяется'),
      proposedText: z.string().optional().describe('Предлагаемый текст'),
      rationale: z
        .string()
        .describe('Обоснование правки — попадает в таблицу поправок, поэтому обязательно'),
    }),
    outputSchema: z.object({ suggestionId: z.string(), created: z.boolean() }),
    execute: async (input, { requestContext }) =>
      callApi(
        deps,
        `/api/drafts/${input.draftId}/suggestions`,
        { method: 'POST', body: input },
        requestContext,
      ),
  });
}

/** Постановка задачи в проекте или рабочей группе. */
export function createTaskTool(deps: PlatformToolsDeps) {
  return createTool({
    id: 'create-task',
    description:
      'Создать задачу в проекте, рабочей группе или лично для участника. ' +
      'Используй при разборе расшифровок совещаний, когда прозвучало поручение.',
    inputSchema: z.object({
      projectId: z.string().uuid().optional(),
      workgroupId: z.string().uuid().optional(),
      title: z.string().min(3),
      description: z.string().optional(),
      assigneeId: z.string().uuid().optional(),
      dueDate: z.string().optional().describe('Срок в формате ISO'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
      sourceTranscriptId: z
        .string()
        .uuid()
        .optional()
        .describe('Расшифровка, из которой возникло поручение'),
    }),
    outputSchema: z.object({ taskId: z.string(), created: z.boolean() }),
    execute: async (input, { requestContext }) =>
      callApi(deps, '/api/tasks', { method: 'POST', body: input }, requestContext),
  });
}
