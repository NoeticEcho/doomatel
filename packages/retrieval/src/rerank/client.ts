import { request } from 'undici';

/**
 * Клиент кросс-энкодера для переранжирования.
 *
 * Гибридный отбор даёт около сотни кандидатов; кросс-энкодер оценивает
 * пару «запрос — текст» совместно и отбирает лучшие. Для правовых текстов
 * это заметно точнее, чем расстояние между независимыми векторами: разница
 * между нормой, которая регулирует вопрос, и нормой, которая лишь упоминает
 * тот же предмет, часто выражена одним оборотом.
 *
 * Модель по умолчанию — `BAAI/bge-reranker-v2-m3` (Apache 2.0, контекст
 * 8192 токена, тот же токенизатор, что у основной модели эмбеддингов,
 * поэтому русский текст режется одинаково на обоих этапах).
 */

export interface RerankerOptions {
  /** Адрес сервиса переранжирования. */
  url: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export interface RerankCandidate {
  id: string | number;
  text: string;
}

export interface RerankResult {
  id: string | number;
  score: number;
  rank: number;
}

export class RerankerClient {
  constructor(private readonly options: RerankerOptions) {}

  /** Переранжирует кандидатов и возвращает лучшие `topN`. */
  async rerank(query: string, candidates: RerankCandidate[], topN = 8): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];

    const response = await request(this.options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        ...(this.options.model ? { model: this.options.model } : {}),
        query,
        documents: candidates.map((candidate) => candidate.text),
        top_n: Math.min(topN, candidates.length),
        return_documents: false,
      }),
      headersTimeout: this.options.timeoutMs ?? 60_000,
      bodyTimeout: this.options.timeoutMs ?? 60_000,
    });

    const body = await response.body.text();
    if (response.statusCode >= 400) {
      throw new Error(
        `Сервис переранжирования вернул ${response.statusCode}: ${body.slice(0, 300)}`,
      );
    }

    const payload = JSON.parse(body) as {
      results?: Array<{ index: number; relevance_score?: number; score?: number }>;
    };
    const results = payload.results ?? [];

    return results
      .map((item, rank) => {
        const candidate = candidates[item.index];
        if (!candidate) return undefined;
        return { id: candidate.id, score: item.relevance_score ?? item.score ?? 0, rank };
      })
      .filter((item): item is RerankResult => item !== undefined);
  }
}

/**
 * Запасной вариант переранжирования без внешнего сервиса.
 *
 * Применяется, когда сервис недоступен: лучше выдать результаты, отсортированные
 * слиянием, чем не выдать ничего. Порядок при этом сохраняется исходный —
 * функция не делает вида, что переранжировала.
 */
export function passthroughRerank(candidates: RerankCandidate[], topN = 8): RerankResult[] {
  return candidates.slice(0, topN).map((candidate, rank) => ({
    id: candidate.id,
    score: 1 - rank / Math.max(1, candidates.length),
    rank,
  }));
}
