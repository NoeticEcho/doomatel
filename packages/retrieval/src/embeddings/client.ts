import { request } from 'undici';

/**
 * Клиент эмбеддингов по протоколу, совместимому с OpenAI.
 *
 * Собственный клиент вместо SDK нужен по двум причинам. Во-первых, модель
 * эмбеддингов размещается локально (vLLM, Infinity, TEI) — SDK тянет за собой
 * лишнее. Во-вторых, для государственного контура важно, чтобы единственная
 * точка выхода наружу была явной и заменяемой одной переменной окружения.
 */

export interface EmbeddingsOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Ожидаемая размерность. Несовпадение — ошибка, а не молчаливое искажение. */
  dimensions?: number;
  /** Размер пакета при массовой индексации. */
  batchSize?: number;
  timeoutMs?: number;
  /**
   * Префикс запроса. Часть моделей (семейство E5) требует различать
   * «query: » и «passage: »; у `USER-bge-m3` префиксы не нужны.
   */
  queryPrefix?: string;
  documentPrefix?: string;
}

export class EmbeddingsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmbeddingsError';
  }
}

export class EmbeddingsClient {
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: EmbeddingsOptions) {
    this.batchSize = options.batchSize ?? 32;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  get model(): string {
    return this.options.model;
  }

  /** Векторизует тексты документов. */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const prefix = this.options.documentPrefix ?? '';
    return this.embedAll(texts.map((text) => prefix + text));
  }

  /** Векторизует поисковый запрос. */
  async embedQuery(text: string): Promise<number[]> {
    const prefix = this.options.queryPrefix ?? '';
    const [vector] = await this.embedAll([prefix + text]);
    if (!vector) throw new EmbeddingsError('Сервис эмбеддингов вернул пустой ответ');
    return vector;
  }

  private async embedAll(inputs: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < inputs.length; i += this.batchSize) {
      const batch = inputs.slice(i, i + this.batchSize);
      out.push(...(await this.embedBatch(batch)));
    }
    return out;
  }

  private async embedBatch(inputs: string[]): Promise<number[][]> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/embeddings`;
    const response = await request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.options.model, input: inputs }),
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });

    const text = await response.body.text();
    if (response.statusCode >= 400) {
      throw new EmbeddingsError(
        `Сервис эмбеддингов вернул ${response.statusCode}: ${text.slice(0, 300)}`,
        response.statusCode,
      );
    }

    const payload = JSON.parse(text) as { data?: Array<{ embedding: number[]; index: number }> };
    if (!payload.data || payload.data.length !== inputs.length) {
      throw new EmbeddingsError(
        `Ожидалось ${inputs.length} векторов, получено ${payload.data?.length ?? 0}`,
      );
    }

    // Порядок в ответе не гарантирован — восстанавливаем по полю index.
    const sorted = [...payload.data].sort((a, b) => a.index - b.index);
    const vectors = sorted.map((item) => item.embedding);

    const expected = this.options.dimensions;
    if (expected) {
      for (const vector of vectors) {
        if (vector.length !== expected) {
          throw new EmbeddingsError(
            `Модель «${this.options.model}» вернула вектор размерности ${vector.length}, ожидалось ${expected}. ` +
              'Размерность коллекции и модель должны совпадать — иначе индекс станет непригодным.',
          );
        }
      }
    }

    return vectors;
  }
}
