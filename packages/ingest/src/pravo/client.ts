import { z } from 'zod';
import type { SourceFetcher } from '../fetcher/types.js';

/**
 * Клиент официального интернет-портала правовой информации
 * (`publication.pravo.gov.ru`) — источник официально опубликованных актов.
 *
 * Особенности API, важные для ингеста:
 *  - параметр страницы называется `Index`, а не `page`;
 *  - размер страницы `PageSize` ограничен набором значений 10/30/100/200;
 *  - PDF по акту доступен по `/file/pdf?eoNumber={eoNumber}` и часто является
 *    сканом (image-only), поэтому требуется OCR-ветка извлечения текста.
 */

export const pravoDocument = z.object({
  id: z.string(),
  eoNumber: z.string(),
  publishDateShort: z.string().nullish(),
  viewDate: z.string().nullish(),
  complexName: z.string().nullish(),
  title: z.string().nullish(),
  name: z.string().nullish(),
  number: z.string().nullish(),
  documentDate: z.string().nullish(),
  jdRegNumber: z.string().nullish(),
  jdRegDate: z.string().nullish(),
  pagesCount: z.number().int().nullish(),
  pdfFileLength: z.number().nullish(),
  zipFileLength: z.number().nullish(),
  signatoryAuthorityId: z.string().nullish(),
  documentTypeId: z.string().nullish(),
  hasSvg: z.boolean().nullish(),
});
export type PravoDocument = z.infer<typeof pravoDocument>;

export const pravoDocumentsResponse = z.object({
  items: z.array(pravoDocument).default([]),
  itemsTotalCount: z.number().int().nullish(),
  itemsPerPage: z.number().int().nullish(),
  pagesTotalCount: z.number().int().nullish(),
  currentPage: z.number().int().nullish(),
});
export type PravoDocumentsResponse = z.infer<typeof pravoDocumentsResponse>;

export interface PravoSearchParams {
  Block?: string;
  Category?: string;
  SignatoryAuthorityId?: string;
  DocumentTypeId?: string | string[];
  EoNumber?: string;
  PeriodType?: 'daily' | 'weekly' | 'monthly' | 'day';
  Date?: string;
  DocumentDateFrom?: string;
  DocumentDateTo?: string;
  Name?: string;
  ComplexName?: string;
  Number?: string;
  NumberSearchType?: 0 | 1 | 2 | 3;
  JdRegNumber?: string;
  PublishDateFrom?: string;
  PublishDateTo?: string;
  /** Полнотекстовый поиск по тексту документа. */
  DocumentText?: string;
  PageSize?: 10 | 30 | 100 | 200;
  /** Номер страницы, 1-based. Внимание: параметр называется `Index`. */
  Index?: number;
  SortedBy?: 0 | 1 | 2 | 3 | 4 | 5;
  SortDestination?: 1 | 2;
}

export interface PravoClientOptions {
  baseUrl?: string;
  fetcher: SourceFetcher;
}

export class PravoClient {
  private readonly baseUrl: string;

  constructor(private readonly options: PravoClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://publication.pravo.gov.ru').replace(/\/$/, '');
  }

  buildUrl(path: string, params: Record<string, unknown> = {}): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async getJson<T>(path: string, schema: z.ZodType<T>, params: Record<string, unknown>) {
    const url = this.buildUrl(path, params);
    const response = await this.options.fetcher.fetch({ url });
    if (response.status >= 400) {
      throw new Error(`publication.pravo.gov.ru: ${path} вернул HTTP ${response.status}`);
    }
    const parsed = schema.safeParse(JSON.parse(response.body));
    if (!parsed.success) {
      throw new Error(
        `publication.pravo.gov.ru: ответ ${path} не соответствует схеме: ${JSON.stringify(
          parsed.error.issues.slice(0, 5),
        )}`,
      );
    }
    return parsed.data;
  }

  /** Поиск опубликованных актов. */
  documents(params: PravoSearchParams = {}): Promise<PravoDocumentsResponse> {
    return this.getJson('/api/Documents', pravoDocumentsResponse, {
      PageSize: 100,
      Index: 1,
      ...params,
    });
  }

  /** Постраничный обход результатов поиска. */
  async *documentsAll(
    params: PravoSearchParams = {},
    options: { maxPages?: number } = {},
  ): AsyncGenerator<PravoDocument, void, undefined> {
    let index = params.Index ?? 1;
    const limit = options.maxPages ?? Number.POSITIVE_INFINITY;
    let processedPages = 0;

    for (;;) {
      const response = await this.documents({ ...params, Index: index });
      if (response.items.length === 0) return;
      for (const item of response.items) yield item;

      processedPages += 1;
      const totalPages = response.pagesTotalCount ?? index;
      if (index >= totalPages || processedPages >= limit) return;
      index += 1;
    }
  }

  /** Один документ по номеру электронного опубликования. */
  document(eoNumber: string) {
    return this.getJson('/api/Document', pravoDocument, { eoNumber });
  }

  /** Блоки публикации (справочник). */
  publicBlocks(parent?: string) {
    return this.getJson(
      '/api/PublicBlocks/',
      z.array(z.record(z.string(), z.unknown())),
      parent ? { parent } : {},
    );
  }

  /** Виды документов (справочник). */
  documentTypes() {
    return this.getJson('/api/DocumentTypes', z.array(z.record(z.string(), z.unknown())), {});
  }

  /** Принявшие органы (справочник). */
  signatoryAuthorities() {
    return this.getJson(
      '/api/SignatoryAuthorities',
      z.array(z.record(z.string(), z.unknown())),
      {},
    );
  }

  /** Ссылка на подписанный PDF акта. */
  pdfUrl(eoNumber: string): string {
    return this.buildUrl('/file/pdf', { eoNumber });
  }

  /** Ссылка на HTML-страницу акта. */
  viewUrl(eoNumber: string): string {
    return `${this.baseUrl}/Document/View/${eoNumber}`;
  }
}
