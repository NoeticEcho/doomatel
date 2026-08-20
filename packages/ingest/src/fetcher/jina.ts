import { HttpFetcher, type HttpFetcherOptions } from './http.js';
import { FetchError, type FetchRequest, type FetchResponse, type SourceFetcher } from './types.js';

export interface JinaFetcherOptions extends HttpFetcherOptions {
  /** Базовый адрес Jina Reader. Можно указать self-hosted инстанс. */
  baseUrl?: string;
  /** API-ключ Jina: без него действуют жёсткие анонимные лимиты. */
  apiKey?: string;
  /** Формат ответа: markdown (по умолчанию) или html. */
  respondWith?: 'markdown' | 'html' | 'text';
  /** Таймаут рендеринга на стороне Jina, секунды. */
  readerTimeoutSec?: number;
}

/**
 * Транспорт через Jina Reader (`https://r.jina.ai/<url>`).
 *
 * Полезен, когда прямой доступ к источнику закрыт, а также когда нужен
 * рендеринг SPA без собственного браузера. Ограничения проверены 2026-08-20:
 * `duma.gov.ru` доступен только по схеме `http://`; `sozd.duma.gov.ru`
 * не отдаётся и через Jina (таймаут при ожидании `networkidle`).
 */
export class JinaFetcher implements SourceFetcher {
  readonly name = 'jina';
  private readonly http: HttpFetcher;
  private readonly baseUrl: string;
  private readonly options: JinaFetcherOptions;

  constructor(options: JinaFetcherOptions = {}) {
    this.options = options;
    this.baseUrl = (options.baseUrl ?? 'https://r.jina.ai').replace(/\/$/, '');
    this.http = new HttpFetcher(options);
  }

  supports(request: FetchRequest): boolean {
    return request.method === undefined || request.method === 'GET';
  }

  async fetch(request: FetchRequest): Promise<FetchResponse> {
    const headers: Record<string, string> = {
      'x-timeout': String(this.options.readerTimeoutSec ?? 45),
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      ...(this.options.respondWith ? { 'x-respond-with': this.options.respondWith } : {}),
      ...(request.waitForSelector ? { 'x-wait-for-selector': request.waitForSelector } : {}),
      ...request.headers,
    };

    const response = await this.http.fetch({
      ...request,
      url: `${this.baseUrl}/${request.url}`,
      headers,
    });

    if (response.status >= 400) {
      throw new FetchError(
        `Jina Reader вернул ${response.status} для ${request.url}: ${response.body.slice(0, 300)}`,
        request.url,
        response.status,
        this.name,
      );
    }

    return { ...response, url: request.url, via: this.name };
  }
}
