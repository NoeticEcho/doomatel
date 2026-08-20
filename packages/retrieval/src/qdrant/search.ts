import type { QdrantClient } from '@qdrant/js-client-rest';
import { encodeQuery, extractRequisites, type SparseVector } from '../lexical/russian.js';
import { applyAccessScope, toQdrantFilter, type QdrantFilter, type SearchFilter } from '../filters/dsl.js';

/**
 * Гибридный поиск по корпусу законодательства.
 *
 * Три независимые ветви отбора объединяются взаимно-ранговым слиянием (RRF):
 *
 *   1. плотная — смысловая близость;
 *   2. разрежённая (BM25) — совпадение слов, включая узкие термины;
 *   3. точная по реквизитам — совпадение номера акта или статьи.
 *
 * Слияние выполняется по рангам, а не по значениям близости: оценки BM25
 * и косинуса несопоставимы по масштабу, и масштаб BM25 к тому же смещается
 * по мере роста корпуса, который пополняется ежедневно. Ранговое слияние
 * от масштаба не зависит.
 *
 * Третья ветвь существует потому, что запрос «что говорит 149-ФЗ о реестре»
 * должен гарантированно поднимать нормы именно этого закона, а не похожие
 * по смыслу нормы соседних законов.
 */

export interface HybridSearchOptions {
  collection: string;
  /** Плотный вектор запроса. */
  denseVector: number[];
  /** Текст запроса — из него строится разрежённый вектор и реквизиты. */
  queryText: string;
  filter?: SearchFilter;
  /** Ограничение прав пользователя. Применяется всегда. */
  accessScope?: { userId: string; projectIds: string[]; tenantIds: string[] };
  /** Сколько кандидатов брать из каждой ветви. */
  prefetchLimit?: number;
  /** Сколько кандидатов вернуть после слияния. */
  limit?: number;
  /**
   * Способ слияния. `rrf` — ранговое (по умолчанию, устойчиво);
   * `dbsf` — по распределению оценок, может выигрывать при откалиброванных
   * ветвях. Выбор вынесен в настройку, чтобы его можно было измерить.
   */
  fusion?: 'rrf' | 'dbsf';
}

export interface SearchHit {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
  /** Ветви, в которых документ был найден — полезно для отладки качества. */
  matchedBranches?: string[];
}

/** Выполняет гибридный поиск и возвращает объединённый список кандидатов. */
export async function hybridSearch(
  client: QdrantClient,
  options: HybridSearchOptions,
): Promise<SearchHit[]> {
  const prefetchLimit = options.prefetchLimit ?? 100;
  const limit = options.limit ?? 100;

  const baseFilter = toQdrantFilter(options.filter ?? {});
  const filter = options.accessScope
    ? applyAccessScope(baseFilter, options.accessScope)
    : baseFilter;

  const sparse: SparseVector = encodeQuery(options.queryText);
  const requisites = extractRequisites(options.queryText);

  const prefetch: Record<string, unknown>[] = [
    {
      query: options.denseVector,
      using: 'dense',
      ...(filter ? { filter } : {}),
      limit: prefetchLimit,
      params: { quantization: { rescore: true, oversampling: 2.0 } },
    },
  ];

  if (sparse.indices.length > 0) {
    prefetch.push({
      query: { indices: sparse.indices, values: sparse.values },
      using: 'bm25',
      ...(filter ? { filter } : {}),
      limit: prefetchLimit,
    });
  }

  // Ветвь точного совпадения реквизитов: узкий фильтр по номеру акта.
  const actNumbers = requisites.filter((value) => /^\d+-(фз|фкз)$/u.test(value));
  if (actNumbers.length > 0) {
    const citationFilter: QdrantFilter = {
      must: [
        ...(filter?.must ?? []),
        { key: 'act_number_normalized', match: { any: actNumbers } },
      ],
    };
    prefetch.push({
      query: { indices: sparse.indices, values: sparse.values },
      using: 'bm25',
      filter: citationFilter,
      limit: Math.ceil(prefetchLimit / 2),
    });
  }

  const response = await client.query(options.collection, {
    prefetch: prefetch as never,
    query: { fusion: options.fusion ?? 'rrf' } as never,
    limit,
    with_payload: true,
  });

  return response.points.map((point) => ({
    id: point.id,
    score: point.score ?? 0,
    payload: (point.payload ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Расширение результатов до родительской единицы.
 *
 * Найденный фрагмент часто является частью статьи. Для ответа нужна статья
 * целиком: пункт без вводной части своей статьи читается неверно, а именно
 * такое чтение и порождает ошибочные юридические выводы.
 */
export async function expandToParents(
  client: QdrantClient,
  collection: string,
  hits: SearchHit[],
  options: { maxParents?: number } = {},
): Promise<SearchHit[]> {
  const maxParents = options.maxParents ?? 8;
  const parentPaths = new Set<string>();
  const ordered: SearchHit[] = [];

  for (const hit of hits) {
    const parentPath = hit.payload['parent_path'];
    const workUri = hit.payload['work_uri'];
    if (typeof parentPath !== 'string' || typeof workUri !== 'string') {
      ordered.push(hit);
      continue;
    }
    const key = `${workUri}#${parentPath}`;
    if (parentPaths.has(key)) continue;
    parentPaths.add(key);
    ordered.push(hit);
    if (parentPaths.size >= maxParents) break;
  }

  if (parentPaths.size === 0) return ordered;

  const parents = await client.scroll(collection, {
    filter: {
      should: [...parentPaths].map((key) => {
        const [workUri, path] = key.split('#');
        return {
          must: [
            { key: 'work_uri', match: { value: workUri } },
            { key: 'path', match: { value: path } },
          ],
        };
      }),
    } as never,
    limit: maxParents,
    with_payload: true,
  });

  const parentHits: SearchHit[] = parents.points.map((point) => ({
    id: point.id,
    score: 0,
    payload: (point.payload ?? {}) as Record<string, unknown>,
    matchedBranches: ['parent'],
  }));

  // Родители добавляются после исходных попаданий: порядок ранжирования
  // определяется слиянием, а расширение лишь дополняет контекст.
  const seen = new Set(ordered.map((hit) => String(hit.id)));
  return [...ordered, ...parentHits.filter((hit) => !seen.has(String(hit.id)))];
}
