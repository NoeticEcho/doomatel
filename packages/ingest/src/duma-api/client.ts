import { z } from 'zod';
import type { SourceFetcher } from '../fetcher/types.js';
import {
  dumaDeputy,
  dumaOrgan,
  dumaReferenceList,
  dumaSearchResponse,
  type DumaLaw,
  type DumaSearchResponse,
} from './schemas.js';

export interface DumaApiOptions {
  /** Ключ API (сегмент пути). Запрашивается на http://api.duma.gov.ru/key-request */
  apiKey: string;
  /** Ключ приложения (query-параметр `app_token`). Обязателен для server-side. */
  appToken: string;
  /** Базовый адрес. По умолчанию — официальный. */
  baseUrl?: string;
  fetcher: SourceFetcher;
}

export interface SearchParams {
  /** Номер законопроекта, напр. «301854-8». */
  number?: string;
  name?: string;
  /** Код статуса, см. `BILL_STATUS_CODES`. */
  status?: number;
  law_type?: number;
  topic?: number;
  class?: number;
  federal_subject?: number;
  regional_subject?: number;
  deputy?: number;
  responsible_committee?: number;
  soexecutor_committee?: number;
  profile_committee?: number;
  instance?: number;
  stage?: number;
  phase?: number;
  registration_start?: string;
  registration_end?: string;
  event_start?: string;
  event_end?: string;
  page?: number;
  limit?: number;
  sort?: 'date' | 'date_asc' | 'name' | 'number';
}

export class DumaApiError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DumaApiError';
  }
}

/**
 * Клиент ИС «Законотворчество».
 *
 * Формат запроса: `{base}/api/{apiKey}/{method}.{format}?app_token={appToken}&...`
 *
 * Официальный лимит — 50 000 вызовов в сутки на ключ; при превышении квоту
 * расширяют по письменному запросу. Соблюдение темпа обеспечивает
 * `PolitePolicyFetcher`, а не этот клиент.
 */
export class DumaApiClient {
  private readonly baseUrl: string;

  constructor(private readonly options: DumaApiOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://api.duma.gov.ru').replace(/\/$/, '');
  }

  /** Собирает URL метода API. */
  buildUrl(method: string, params: Record<string, string | number | undefined> = {}): string {
    const url = new URL(`${this.baseUrl}/api/${this.options.apiKey}/${method}.json`);
    url.searchParams.set('app_token', this.options.appToken);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async call<T>(
    method: string,
    schema: z.ZodType<T>,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const url = this.buildUrl(method, params);
    const response = await this.options.fetcher.fetch({ url });
    if (response.status >= 400) {
      throw new DumaApiError(
        `Метод «${method}» вернул HTTP ${response.status}`,
        method,
        response.status,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch (cause) {
      throw new DumaApiError(
        `Метод «${method}» вернул не JSON: ${response.body.slice(0, 200)}`,
        method,
        response.status,
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new DumaApiError(
        `Ответ метода «${method}» не соответствует схеме: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`,
        method,
        response.status,
      );
    }
    return parsed.data;
  }

  /** Поиск законопроектов. */
  search(params: SearchParams = {}): Promise<DumaSearchResponse> {
    return this.call('search', dumaSearchResponse, params as Record<string, string | number>);
  }

  /**
   * Постраничный обход результатов поиска.
   *
   * Число страниц вычисляется как `ceil(count / laws.length)` по первой странице:
   * API не возвращает общее число страниц напрямую.
   */
  async *searchAll(
    params: SearchParams = {},
    options: { maxPages?: number } = {},
  ): AsyncGenerator<DumaLaw, void, undefined> {
    const limit = params.limit ?? 20;
    let page = params.page ?? 1;
    let totalPages = options.maxPages ?? Number.POSITIVE_INFINITY;

    for (;;) {
      const response = await this.search({ ...params, page, limit });
      if (response.laws.length === 0) return;

      if (page === (params.page ?? 1)) {
        const perPage = response.laws.length || limit;
        const computed = Math.ceil(response.count / perPage);
        totalPages = Math.min(totalPages, Math.max(1, computed));
      }

      for (const law of response.laws) yield law;

      page += 1;
      if (page > totalPages) return;
    }
  }

  /** Справочник тематических блоков. */
  topics() {
    return this.call('topics', dumaReferenceList);
  }

  /** Справочник отраслей законодательства. */
  classes() {
    return this.call('classes', dumaReferenceList);
  }

  /** Справочник стадий рассмотрения. */
  stages() {
    return this.call('stages', dumaReferenceList);
  }

  /** Справочник инстанций рассмотрения. */
  instances(current = true) {
    return this.call('instances', dumaReferenceList, { current: current ? 1 : 0 });
  }

  /** Справочник созывов и сессий. */
  periods() {
    return this.call('periods', dumaReferenceList);
  }

  /** Комитеты Государственной Думы. */
  committees(current = true) {
    return this.call('committees', z.array(dumaOrgan), { current: current ? 1 : 0 });
  }

  /** Федеральные субъекты права законодательной инициативы. */
  federalOrgans(current = true) {
    return this.call('federal-organs', z.array(dumaOrgan), { current: current ? 1 : 0 });
  }

  /** Региональные субъекты права законодательной инициативы. */
  regionalOrgans(current = true) {
    return this.call('regional-organs', z.array(dumaOrgan), { current: current ? 1 : 0 });
  }

  /** Депутаты и сенаторы. */
  deputies(params: { current?: boolean; position?: string; begin?: string } = {}) {
    return this.call('deputies', z.array(dumaDeputy), {
      ...(params.current === undefined ? {} : { current: params.current ? 1 : 0 }),
      ...(params.position ? { position: params.position } : {}),
      ...(params.begin ? { begin: params.begin } : {}),
    });
  }

  /** Карточка депутата. */
  deputy(id: number) {
    return this.call('deputy', dumaDeputy, { id });
  }

  /** Вопросы заседаний Государственной Думы. */
  questions(params: { limit?: number; dateFrom?: string } = {}) {
    return this.call('questions', z.array(z.record(z.string(), z.unknown())), params);
  }

  /**
   * Сведения о голосовании.
   * Публичная страница результата: `http://vote.duma.gov.ru/vote/{id}`.
   */
  vote(id: number) {
    return this.call(`vote/${id}`, z.record(z.string(), z.unknown()));
  }

  /**
   * Стенограмма рассмотрения вопроса.
   * Нестандартный путь: `/api/{apiKey}/{kodz}/{kodvopr}.json`.
   */
  transcript(kodz: string | number, kodvopr: string | number) {
    return this.call(`${kodz}/${kodvopr}`, z.record(z.string(), z.unknown()));
  }
}
