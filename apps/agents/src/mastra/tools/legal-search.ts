import { createTool } from '@mastra/core/tools';
import { QdrantClient } from '@qdrant/js-client-rest';
import { z } from 'zod';
import {
  COLLECTIONS,
  EmbeddingsClient,
  RerankerClient,
  hybridSearch,
  passthroughRerank,
  searchFilterSchema,
  expandToParents,
} from '@doomatel/retrieval';

/**
 * Инструменты поиска по корпусу законодательства.
 *
 * Общее правило для всех инструментов этого файла: они возвращают **готовые
 * ссылки на источник**, а не только текст. Ответ законодательного помощника
 * без точной ссылки на норму бесполезен — его нельзя проверить и нельзя
 * использовать в документе. Поэтому поле `citation` обязательно, а инструкции
 * агентов требуют приводить его при каждом утверждении.
 */

export interface LegalToolsDeps {
  qdrant: QdrantClient;
  embeddings: EmbeddingsClient;
  reranker?: RerankerClient;
  /**
   * Ограничение прав пользователя. Передаётся сервером, а не моделью:
   * модель не должна иметь возможности расширить себе доступ.
   */
  resolveAccessScope: (requestContext: unknown) => {
    userId: string;
    projectIds: string[];
    tenantIds: string[];
  };
}

const searchResultSchema = z.object({
  citation: z.string().describe('Готовая ссылка на норму для цитирования'),
  citationFull: z.string().optional(),
  text: z.string().describe('Дословный текст нормы'),
  workUri: z.string().optional().describe('Устойчивый идентификатор акта'),
  path: z.string().optional().describe('Путь к структурной единице'),
  docKind: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  score: z.number(),
});

export type LegalSearchResult = z.infer<typeof searchResultSchema>;

/** Поиск по действующему законодательству. */
export function createLegalSearchTool(deps: LegalToolsDeps) {
  return createTool({
    id: 'search-legal-corpus',
    description:
      'Поиск по корпусу действующего законодательства Российской Федерации: ' +
      'федеральные законы, кодексы, указы, постановления. Возвращает дословные ' +
      'тексты норм с готовыми ссылками. Используй этот инструмент всегда, когда ' +
      'нужно сослаться на действующую норму: не воспроизводи тексты законов по памяти.',
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .describe(
          'Запрос на естественном языке. Указывай реквизиты, если они известны: ' +
            '«статья 15 149-ФЗ о реестре запрещённой информации».',
        ),
      filter: searchFilterSchema.optional().describe('Уточняющие условия отбора'),
      limit: z.number().int().min(1).max(20).default(8),
      expandToArticle: z
        .boolean()
        .default(true)
        .describe('Дополнять найденный фрагмент текстом статьи целиком'),
    }),
    outputSchema: z.object({
      results: z.array(searchResultSchema),
      /** Число кандидатов до переранжирования — для оценки полноты. */
      candidatesConsidered: z.number(),
    }),
    execute: async (input, { requestContext }) => {
      const scope = deps.resolveAccessScope(requestContext);
      const denseVector = await deps.embeddings.embedQuery(input.query);

      const hits = await hybridSearch(deps.qdrant, {
        collection: COLLECTIONS.legalChunks,
        denseVector,
        queryText: input.query,
        ...(input.filter ? { filter: input.filter } : {}),
        accessScope: scope,
        limit: 100,
      });

      const expanded = input.expandToArticle
        ? await expandToParents(deps.qdrant, COLLECTIONS.legalChunks, hits)
        : hits;

      const candidates = expanded.map((hit) => ({
        id: String(hit.id),
        text: String(hit.payload['text'] ?? ''),
      }));

      const ranked = deps.reranker
        ? await deps.reranker.rerank(input.query, candidates, input.limit)
        : passthroughRerank(candidates, input.limit);

      const byId = new Map(expanded.map((hit) => [String(hit.id), hit]));
      const results: LegalSearchResult[] = [];
      for (const item of ranked) {
        const hit = byId.get(String(item.id));
        if (!hit) continue;
        const optional = (key: string): string | undefined =>
          hit.payload[key] === undefined || hit.payload[key] === null
            ? undefined
            : String(hit.payload[key]);
        results.push({
          citation: String(hit.payload['citation_short'] ?? ''),
          text: String(hit.payload['text'] ?? ''),
          score: item.score,
          ...(optional('citation_full') ? { citationFull: optional('citation_full')! } : {}),
          ...(optional('work_uri') ? { workUri: optional('work_uri')! } : {}),
          ...(optional('path') ? { path: optional('path')! } : {}),
          ...(optional('doc_kind') ? { docKind: optional('doc_kind')! } : {}),
          ...(optional('valid_from') ? { validFrom: optional('valid_from')! } : {}),
          ...(optional('valid_to') ? { validTo: optional('valid_to')! } : {}),
        });
      }

      return { results, candidatesConsidered: expanded.length };
    },
  });
}

/**
 * Получение текста нормы на конкретную дату.
 *
 * Отдельный инструмент нужен потому, что вопрос «что действовало на дату D»
 * решается не поиском, а точной выборкой редакции. Поиск по смыслу здесь
 * дал бы действующую редакцию, что для оценки прошлых правоотношений неверно.
 */
export function createActUnitTool(deps: LegalToolsDeps) {
  return createTool({
    id: 'get-legal-unit',
    description:
      'Получить дословный текст конкретной структурной единицы акта (статьи, части, пункта), ' +
      'при необходимости — в редакции на заданную дату. Используй, когда реквизиты нормы известны точно.',
    inputSchema: z.object({
      workUri: z
        .string()
        .describe('Идентификатор акта, например eli:rf:federal-law:2006-07-27:149-fz'),
      path: z.string().describe('Путь к единице, например st_15/p_3'),
      asOf: z
        .string()
        .optional()
        .describe('Дата в формате ГГГГ-ММ-ДД. Без неё возвращается действующая редакция.'),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      citation: z.string().optional(),
      text: z.string().optional(),
      validFrom: z.string().optional(),
      validTo: z.string().optional(),
      note: z.string().optional(),
    }),
    execute: async (input, { requestContext }) => {
      const scope = deps.resolveAccessScope(requestContext);
      const conditions: Record<string, unknown>[] = [
        { key: 'work_uri', match: { value: input.workUri } },
        { key: 'path', match: { value: input.path } },
      ];
      if (input.asOf) {
        conditions.push({ key: 'valid_from', range: { lte: input.asOf } });
        conditions.push({ key: 'valid_to', range: { gt: input.asOf } });
      }
      conditions.push({
        should: [
          { key: 'visibility', match: { value: 'public' } },
          { key: 'owner_user_id', match: { value: scope.userId } },
        ],
      });

      const found = await deps.qdrant.scroll(COLLECTIONS.legalChunks, {
        filter: { must: conditions } as never,
        limit: 1,
        with_payload: true,
      });

      const point = found.points[0];
      if (!point) {
        return {
          found: false,
          note: input.asOf
            ? `Редакция на ${input.asOf} не найдена. Возможно, норма в этот период не действовала.`
            : 'Норма не найдена. Проверь идентификатор акта и путь к структурной единице.',
        };
      }

      const payload = point.payload ?? {};
      const optional = (key: string): string | undefined =>
        payload[key] === undefined || payload[key] === null ? undefined : String(payload[key]);
      return {
        found: true,
        citation: String(payload['citation_full'] ?? payload['citation_short'] ?? ''),
        text: String(payload['text'] ?? ''),
        ...(optional('valid_from') ? { validFrom: optional('valid_from')! } : {}),
        ...(optional('valid_to') ? { validTo: optional('valid_to')! } : {}),
      };
    },
  });
}
