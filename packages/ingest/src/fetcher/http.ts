import { request as undiciRequest, ProxyAgent, type Dispatcher } from 'undici';
import { FetchError, type FetchRequest, type FetchResponse, type SourceFetcher } from './types.js';

export interface HttpFetcherOptions {
  /** User-Agent. Обязателен: анонимные запросы к duma.gov.ru чаще отбиваются. */
  userAgent?: string;
  /** HTTP(S)-прокси, например российский выходной узел. */
  proxyUrl?: string;
  /** Таймаут по умолчанию, мс. */
  timeoutMs?: number;
  /** Дополнительные заголовки для всех запросов. */
  headers?: Record<string, string>;
  /** Максимальное число переходов по редиректам. */
  maxRedirects?: number;
}

const DEFAULT_USER_AGENT =
  'DoomatelBot/0.1 (+https://doomatel.ru/bot; законотворческая аналитика; contact: webmaster)';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Прямой HTTP-транспорт. Работает для `api.duma.gov.ru`,
 * `publication.pravo.gov.ru` и скачивания файлов СОЗД, но не рендерит SPA.
 */
export class HttpFetcher implements SourceFetcher {
  readonly name = 'http';
  private readonly dispatcher?: Dispatcher;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly maxRedirects: number;

  constructor(options: HttpFetcherOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.headers = options.headers ?? {};
    this.maxRedirects = options.maxRedirects ?? 5;
    if (options.proxyUrl) this.dispatcher = new ProxyAgent(options.proxyUrl);
  }

  supports(request: FetchRequest): boolean {
    return request.requiresJs !== true;
  }

  async fetch(request: FetchRequest): Promise<FetchResponse> {
    const startedAt = Date.now();
    try {
      const { response, finalUrl } = await this.requestFollowingRedirects(request);
      const buffer = Buffer.from(await response.body.arrayBuffer());
      const headers = normalizeHeaders(response.headers);
      return {
        url: finalUrl,
        status: response.statusCode,
        headers,
        body: decodeBody(buffer, headers['content-type']),
        bytes: new Uint8Array(buffer),
        via: this.name,
        durationMs: Date.now() - startedAt,
      };
    } catch (cause) {
      throw new FetchError(
        `Не удалось загрузить ${request.url}: ${(cause as Error).message}`,
        request.url,
        undefined,
        this.name,
        { cause },
      );
    }
  }

  /**
   * undici не следует за редиректами без явного интерцептора, а источники
   * duma.gov.ru активно перенаправляют http→https и на домены-алиасы
   * (`sozd.parlament.gov.ru`), поэтому переходы обрабатываются здесь.
   */
  private async requestFollowingRedirects(request: FetchRequest) {
    let url = request.url;
    let method = request.method ?? 'GET';
    let body = request.body;

    for (let hop = 0; ; hop += 1) {
      const response = await undiciRequest(url, {
        method,
        headers: {
          'user-agent': this.userAgent,
          'accept-language': 'ru-RU,ru;q=0.9',
          ...this.headers,
          ...request.headers,
        },
        ...(body === undefined ? {} : { body }),
        headersTimeout: request.timeoutMs ?? this.timeoutMs,
        bodyTimeout: request.timeoutMs ?? this.timeoutMs,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });

      const location = headerValue(response.headers['location']);
      if (!REDIRECT_STATUSES.has(response.statusCode) || !location || hop >= this.maxRedirects) {
        return { response, finalUrl: url };
      }

      await response.body.dump();
      url = new URL(location, url).toString();
      // 303 и «мягкие» 301/302 превращают POST в GET — так делают браузеры.
      if (response.statusCode === 303 || (method === 'POST' && response.statusCode !== 307 && response.statusCode !== 308)) {
        method = 'GET';
        body = undefined;
      }
    }
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function normalizeHeaders(raw: Record<string, string | string[] | undefined>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * Декодирует тело ответа с учётом кодировки.
 *
 * Часть российских государственных ресурсов и большинство legacy-документов
 * отдаются в windows-1251, поэтому UTF-8 нельзя предполагать по умолчанию.
 */
export function decodeBody(buffer: Buffer, contentType?: string): string {
  const charset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // Кодировка не поддерживается средой — падаем обратно на UTF-8.
    }
  }
  const utf8 = buffer.toString('utf8');
  // Эвристика: подмена «�» указывает на однобайтовую кириллическую кодировку
  // без заголовка charset — типичный случай для asozd2 и старых выгрузок.
  if (!charset && countReplacementChars(utf8) > 3) {
    try {
      return new TextDecoder('windows-1251').decode(buffer);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

function countReplacementChars(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length && count <= 4; i += 1) {
    if (value.charCodeAt(i) === 0xfffd) count += 1;
  }
  return count;
}
