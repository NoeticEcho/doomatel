import { FetchError, type FetchRequest, type FetchResponse, type SourceFetcher } from './types.js';

export interface RateLimitOptions {
  /** Минимальный интервал между запросами к одному хосту, мс. */
  minIntervalMs?: number;
  /** Максимум одновременных запросов к одному хосту. */
  concurrencyPerHost?: number;
  /** Число повторов при временных ошибках. */
  retries?: number;
  /** Базовая задержка экспоненциального отката, мс. */
  retryBaseMs?: number;
  /** Коды, при которых повтор осмыслен. */
  retryStatuses?: number[];
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

interface HostState {
  lastStartedAt: number;
  active: number;
  queue: Array<() => void>;
}

/**
 * Декоратор транспорта: вежливая политика нагрузки и повторы.
 *
 * Государственные источники не публикуют явных лимитов на HTML-страницы,
 * поэтому по умолчанию берётся консервативный режим — один запрос в секунду
 * на хост и одно соединение. Для `api.duma.gov.ru` действует официальный лимит
 * 50 000 вызовов в сутки на ключ, что соответствует ~0.6 запроса в секунду.
 */
export class PolitePolicyFetcher implements SourceFetcher {
  readonly name: string;
  private readonly hosts = new Map<string, HostState>();
  private readonly minIntervalMs: number;
  private readonly concurrencyPerHost: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private readonly retryStatuses: Set<number>;

  constructor(
    private readonly inner: SourceFetcher,
    options: RateLimitOptions = {},
  ) {
    this.name = `polite(${inner.name})`;
    this.minIntervalMs = options.minIntervalMs ?? 1_000;
    this.concurrencyPerHost = options.concurrencyPerHost ?? 1;
    this.retries = options.retries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 2_000;
    this.retryStatuses = new Set(options.retryStatuses ?? DEFAULT_RETRY_STATUSES);
  }

  supports(request: FetchRequest): boolean {
    return this.inner.supports(request);
  }

  async fetch(request: FetchRequest): Promise<FetchResponse> {
    const host = new URL(request.url).host;
    await this.acquire(host);
    try {
      return await this.withRetries(request);
    } finally {
      this.release(host);
    }
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }

  private async withRetries(request: FetchRequest): Promise<FetchResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (attempt > 0) {
        await delay(this.retryBaseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
      }
      try {
        const response = await this.inner.fetch(request);
        if (this.retryStatuses.has(response.status) && attempt < this.retries) {
          lastError = new FetchError(
            `Временный статус ${response.status}`,
            request.url,
            response.status,
            this.inner.name,
          );
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt === this.retries) break;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new FetchError('Неизвестная ошибка загрузки', request.url, undefined, this.inner.name);
  }

  private async acquire(host: string): Promise<void> {
    const state = this.hosts.get(host) ?? { lastStartedAt: 0, active: 0, queue: [] };
    this.hosts.set(host, state);

    if (state.active >= this.concurrencyPerHost) {
      await new Promise<void>((resolve) => state.queue.push(resolve));
    }
    state.active += 1;

    const wait = state.lastStartedAt + this.minIntervalMs - Date.now();
    if (wait > 0) await delay(wait);
    state.lastStartedAt = Date.now();
  }

  private release(host: string): void {
    const state = this.hosts.get(host);
    if (!state) return;
    state.active -= 1;
    const next = state.queue.shift();
    if (next) next();
  }
}

/** Пробует транспорты по порядку, пока один не отдаст успешный ответ. */
export class FallbackFetcher implements SourceFetcher {
  readonly name: string;

  constructor(private readonly chain: SourceFetcher[]) {
    if (chain.length === 0) throw new Error('FallbackFetcher требует хотя бы один транспорт');
    this.name = `fallback(${chain.map((f) => f.name).join('→')})`;
  }

  supports(request: FetchRequest): boolean {
    return this.chain.some((fetcher) => fetcher.supports(request));
  }

  async fetch(request: FetchRequest): Promise<FetchResponse> {
    const errors: string[] = [];
    for (const fetcher of this.chain) {
      if (!fetcher.supports(request)) continue;
      try {
        const response = await fetcher.fetch(request);
        if (response.status < 400) return response;
        errors.push(`${fetcher.name}: HTTP ${response.status}`);
      } catch (error) {
        errors.push(`${fetcher.name}: ${(error as Error).message}`);
      }
    }
    throw new FetchError(
      `Все транспорты отказали для ${request.url}\n  ${errors.join('\n  ')}`,
      request.url,
      undefined,
      this.name,
    );
  }

  async close(): Promise<void> {
    await Promise.all(this.chain.map((fetcher) => fetcher.close?.()));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
