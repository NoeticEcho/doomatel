/**
 * Абстракция транспорта для загрузки внешних источников.
 *
 * Мотивация: источники законодательства РФ (СОЗД, publication.pravo.gov.ru)
 * недоступны из части сетей и частично отдают контент только после
 * клиентского рендеринга. Поэтому транспорт вынесен в интерфейс и выбирается
 * конфигурацией, а парсеры от него не зависят.
 */

export interface FetchRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Таймаут запроса, мс. */
  timeoutMs?: number;
  /**
   * Требуется ли выполнение JavaScript. СОЗД — SPA, поэтому карточки
   * законопроектов запрашиваются с `requiresJs: true`.
   */
  requiresJs?: boolean;
  /** CSS-селектор, появления которого нужно дождаться (для браузерного транспорта). */
  waitForSelector?: string;
}

export interface FetchResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Тело в виде байтов — заполняется только для бинарных загрузок. */
  bytes?: Uint8Array;
  /** Имя транспорта, обслужившего запрос. */
  via: string;
  /** Длительность запроса, мс. */
  durationMs: number;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    readonly via?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'FetchError';
  }
}

export interface SourceFetcher {
  readonly name: string;
  /** Может ли транспорт обслужить данный запрос (например, умеет ли он JS). */
  supports(request: FetchRequest): boolean;
  fetch(request: FetchRequest): Promise<FetchResponse>;
  close?(): Promise<void>;
}
