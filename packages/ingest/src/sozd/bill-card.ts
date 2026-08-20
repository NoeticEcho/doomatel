import * as cheerio from 'cheerio';
import { parseBillNumber } from '@doomatel/legal';

/**
 * Разбор карточки законопроекта СОЗД (`https://sozd.duma.gov.ru/bill/{номер}-{созыв}`).
 *
 * Селекторы взяты из работающих открытых парсеров СОЗД. Поскольку СОЗД
 * недоступен из части сред разработки, парсер разрабатывается против
 * зафиксированных снимков страниц (`packages/ingest/test/fixtures/sozd`),
 * снимаемых командой `doomatel-ingest capture` из среды с доступом.
 *
 * Разбор устойчив к отсутствию любого блока: карточки разных созывов
 * отличаются набором полей, и отсутствие блока не является ошибкой.
 */

export const SOZD_BASE_URL = 'https://sozd.duma.gov.ru';

/** Карта подписей паспорта законопроекта на поля модели. */
export const PASSPORT_FIELD_MAP: Record<string, keyof BillPassport> = {
  'Субъект права законодательной инициативы': 'initiator',
  'Форма законопроекта': 'lawForm',
  'Профильный комитет': 'profileCommittee',
  'Комитеты-соисполнители': 'coexecutorCommittees',
  'Отрасль законодательства': 'branch',
  'Тематический блок законопроектов': 'topic',
  'Ответственный комитет': 'responsibleCommittee',
  'Срок представления поправок': 'amendmentDeadline',
  'Предмет ведения': 'jurisdictionSubject',
  'Вопрос ведения': 'jurisdictionQuestion',
  'Принадлежность к примерной программе': 'programAffiliation',
};

export interface BillPassport {
  initiator?: string;
  lawForm?: string;
  profileCommittee?: string;
  coexecutorCommittees?: string;
  branch?: string;
  topic?: string;
  responsibleCommittee?: string;
  amendmentDeadline?: string;
  jurisdictionSubject?: string;
  jurisdictionQuestion?: string;
  programAffiliation?: string;
  /** Поля паспорта, для которых нет сопоставления в модели. */
  extra: Record<string, string>;
}

export type AttachmentFormat = 'pdf' | 'doc' | 'docx' | 'rtf' | 'zip' | 'xls' | 'xlsx' | 'unknown';

export interface BillAttachment {
  /** Абсолютный URL для скачивания. */
  url: string;
  /** GUID документа, если он присутствует в ссылке `/download/{guid}`. */
  guid?: string;
  name: string;
  /** Дата документа в формате ISO, если указана. */
  date?: string;
  /** Формат файла, определённый по CSS-классу иконки — до скачивания. */
  format: AttachmentFormat;
}

export interface BillEvent {
  /**
   * Иерархический номер события «{стадия}.{фаза}», напр. «1.1» — внесение
   * законопроекта в Государственную Думу.
   */
  eventNum: string;
  title: string;
  /** Дата события в формате ISO. */
  date?: string;
  /** Решение по итогам события, если указано. */
  solution?: string;
  /** Документы, приложенные к событию. */
  attachments: BillAttachment[];
}

export interface ParsedBillCard {
  /** Номер законопроекта «{порядковый}-{созыв}». */
  number?: string;
  convocation?: number;
  name?: string;
  status?: string;
  passport: BillPassport;
  events: BillEvent[];
  attachments: BillAttachment[];
  /** Предупреждения разбора — попадают в отчёт о качестве ингеста. */
  warnings: string[];
}

const DATE_RE = /(\d{2})\.(\d{2})\.(\d{4})/u;

/** Преобразует дату «27.07.2006» в ISO «2006-07-27». */
export function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = DATE_RE.exec(value);
  if (!match) return undefined;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

const KNOWN_FORMATS = new Set<AttachmentFormat>([
  'pdf',
  'doc',
  'docx',
  'rtf',
  'zip',
  'xls',
  'xlsx',
]);

/**
 * Определяет формат вложения по CSS-классу иконки.
 * СОЗД кодирует формат суффиксом класса, напр. `table_iconatd1-pdf`.
 */
export function formatFromIconClass(className: string | undefined): AttachmentFormat {
  if (!className) return 'unknown';
  for (const token of className.split(/\s+/u)) {
    const suffix = token.split('-').pop()?.toLowerCase();
    if (suffix && KNOWN_FORMATS.has(suffix as AttachmentFormat)) {
      return suffix as AttachmentFormat;
    }
  }
  return 'unknown';
}

/** Приводит относительную ссылку СОЗД к абсолютной. */
export function absoluteUrl(href: string, baseUrl = SOZD_BASE_URL): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function extractGuid(url: string): string | undefined {
  return /\/download\/([0-9a-fA-F-]{8,})/u.exec(url)?.[1];
}

type CheerioApi = ReturnType<typeof cheerio.load>;

function parseAttachments(
  $: CheerioApi,
  scope: cheerio.Cheerio<never> | undefined,
  baseUrl: string,
): BillAttachment[] {
  const nodes = scope ? scope.find('.table_icona') : $('.table_icona');
  const out: BillAttachment[] = [];

  nodes.each((_, element) => {
    const node = $(element);
    const anchor = node.closest('a');
    const href = anchor.attr('href') ?? node.attr('href');
    if (!href) return;

    const url = absoluteUrl(href, baseUrl);
    const title = anchor.attr('title') ?? '';
    const iconClass = node.find('.table_iconatd1 span').attr('class');
    const name =
      node.find('.doc_wrap').first().text().trim() ||
      anchor.attr('title')?.replace(DATE_RE, '').trim() ||
      '';

    const attachment: BillAttachment = {
      url,
      name,
      format: formatFromIconClass(iconClass),
    };
    const guid = extractGuid(url);
    if (guid) attachment.guid = guid;
    const date = toIsoDate(title);
    if (date) attachment.date = date;
    out.push(attachment);
  });

  return out;
}

/** Разбирает HTML карточки законопроекта СОЗД. */
export function parseBillCard(html: string, baseUrl = SOZD_BASE_URL): ParsedBillCard {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const number = text($('#number_oz_id')) || undefined;
  const name = text($('#oz_name')) || undefined;
  const status = text($('#current_oz_status')) || undefined;

  if (!number) warnings.push('Не найден номер законопроекта (#number_oz_id)');
  if (!name) warnings.push('Не найдено наименование законопроекта (#oz_name)');

  let convocation: number | undefined;
  if (number) {
    try {
      convocation = parseBillNumber(number).convocation;
    } catch {
      warnings.push(`Номер законопроекта «${number}» не соответствует формату «NNNNNN-C»`);
    }
  }

  const passport = parsePassport($, warnings);
  const events = parseEvents($, baseUrl);
  const attachments = parseAttachments($, undefined, baseUrl);

  if (events.length === 0) warnings.push('Не найдена хронология рассмотрения ([data-eventnum])');
  if (attachments.length === 0) warnings.push('Не найдены сопроводительные документы (.table_icona)');

  const card: ParsedBillCard = { passport, events, attachments, warnings };
  if (number) card.number = number;
  if (convocation !== undefined) card.convocation = convocation;
  if (name) card.name = name;
  if (status) card.status = status;
  return card;
}

function parsePassport($: CheerioApi, warnings: string[]): BillPassport {
  const passport: BillPassport = { extra: {} };
  let found = 0;

  // Паспорт свёрстан как последовательность пар «подпись → значение».
  // Верстка менялась между созывами, поэтому поддерживаем два варианта:
  // таблицу и пары div-ов с классами `opinion_name` / `opinion_value`.
  $('[class*="opinion"], table tr, .oz_event_infoblock').each((_, element) => {
    const row = $(element);
    const label = text(row.find('.opinion_name, th, td').first());
    if (!label) return;
    const value = text(row.find('.opinion_value, td').last());
    if (!value || value === label) return;

    const key = PASSPORT_FIELD_MAP[label.replace(/[:\s]+$/u, '')];
    if (key && key !== 'extra') {
      Object.assign(passport, { [key]: value });
      found += 1;
    } else {
      passport.extra[label] = value;
    }
  });

  if (found === 0) warnings.push('Паспорт законопроекта не распознан ни одним из вариантов вёрстки');
  return passport;
}

function parseEvents($: CheerioApi, baseUrl: string): BillEvent[] {
  const events: BillEvent[] = [];

  $('[data-eventnum]').each((_, element) => {
    const node = $(element);
    const eventNum = node.attr('data-eventnum');
    if (!eventNum) return;

    const raw = text(node);
    const event: BillEvent = {
      eventNum,
      title: text(node.find('.event_title, .bh_etap_name, b').first()) || raw.slice(0, 200),
      attachments: parseAttachments($, node as unknown as cheerio.Cheerio<never>, baseUrl),
    };
    const date = toIsoDate(raw);
    if (date) event.date = date;
    const solution = text(node.find('.event_solution, .solution').first());
    if (solution) event.solution = solution;
    events.push(event);
  });

  return events;
}

function text(node: { text(): string } | undefined): string {
  return (node?.text() ?? '').replace(/\s+/gu, ' ').trim();
}

/** Строит URL карточки законопроекта. */
export function billCardUrl(billNumber: string, baseUrl = SOZD_BASE_URL): string {
  return `${baseUrl}/bill/${billNumber}`;
}

/** Строит URL скачивания документа по GUID. */
export function downloadUrl(guid: string, baseUrl = SOZD_BASE_URL): string {
  return `${baseUrl}/download/${guid}`;
}

/**
 * Извлекает расширение файла из заголовка `Content-Disposition`.
 * СОЗД не отдаёт расширение в URL — только в этом заголовке.
 */
export function extensionFromContentDisposition(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const filename =
    /filename\*=(?:UTF-8'')?"?([^";]+)"?/iu.exec(header)?.[1] ??
    /filename="?([^";]+)"?/iu.exec(header)?.[1];
  if (!filename) return undefined;
  const decoded = safeDecode(filename);
  const ext = decoded.split('.').pop()?.replace(/["']/gu, '').trim().toLowerCase();
  return ext && ext.length <= 5 ? ext : undefined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
