import * as cheerio from 'cheerio';
import { SOZD_BASE_URL, toIsoDate } from './bill-card.js';

/**
 * Построение запросов к разделу «Объекты законотворчества» СОЗД и разбор
 * страниц списка.
 *
 * У СОЗД две формы поиска, и они несовместимы по параметрам.
 *
 * 1. **Компактная** — `/oz/b?class=b&b[Convocation][]=8&count_items=250&page=2`.
 *    Пагинация обычным параметром `page`, размер страницы задаётся
 *    `count_items` (по умолчанию 10, допускается 250).
 *
 * 2. **Расширенная** — та же страница с полным набором фильтров, но параметр
 *    страницы называется `page_{GUID}`, где GUID — идентификатор класса
 *    объекта законотворчества. Обычный `page` в этой форме **молча
 *    игнорируется**: сервер возвращает первую страницу снова и снова,
 *    и обход выглядит успешным, не будучи таковым. Это самая дорогая
 *    ошибка при работе с СОЗД, поэтому параметр вынесен в явную настройку.
 */

/**
 * Идентификатор класса объекта законотворчества «законопроект»,
 * используемый в имени параметра страницы расширенной формы.
 *
 * Значение подтверждено двумя независимыми парсерами СОЗД. Оно может
 * измениться при обновлении системы, поэтому вынесено в константу и
 * переопределяется настройкой.
 */
export const BILL_CLASS_GUID = '34F6AE40-BDF0-408A-A56E-E48511C6B618';

export interface SozdSearchFilters {
  /** Созывы: `b[Convocation][]`. */
  convocations?: number[];
  /** Год внесения: `b[Year]`. */
  year?: number;
  /** Номер принятого закона: `b[FzNumber]`. */
  fzNumber?: string;
  /** Отрасль законодательства: `b[SectorOfLaw]`. */
  sectorOfLaw?: string;
  /** Тематический блок. */
  thematicBlock?: string;
  /** Ответственный комитет. */
  responsibleCommittee?: string;
  /** Фракция инициатора. */
  faction?: string;
  /** Депутат-инициатор. */
  deputy?: string;
  /** Последние решения: `b[LastDecisions][]`, значения вида «8.1.1». */
  lastDecisions?: string[];
  /** Форма законопроекта: `b[FormOfTheObjectLawmaking][]`. */
  form?: string[];
  /** Период внесения, ISO-даты. */
  introducedFrom?: string;
  introducedTo?: string;
  /** Поиск по наименованию. */
  query?: string;
}

export interface SozdSearchOptions {
  baseUrl?: string;
  /** Номер страницы, начиная с единицы. */
  page?: number;
  /** Размер страницы. СОЗД принимает до 250. */
  pageSize?: number;
  /**
   * Использовать расширенную форму. В ней параметр страницы называется
   * `page_{GUID}`; в компактной — `page`.
   */
  extendedForm?: boolean;
  /** GUID класса объекта для расширенной формы. */
  classGuid?: string;
}

/** Преобразует ISO-дату в формат периода СОЗД: `27.07.2006`. */
function toSozdDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

/** Строит адрес страницы списка законопроектов. */
export function buildSearchUrl(
  filters: SozdSearchFilters = {},
  options: SozdSearchOptions = {},
): string {
  const base = (options.baseUrl ?? SOZD_BASE_URL).replace(/\/$/, '');
  const url = new URL(`${base}/oz/b`);
  url.searchParams.set('class', 'b');

  for (const convocation of filters.convocations ?? []) {
    url.searchParams.append('b[Convocation][]', String(convocation));
  }
  for (const decision of filters.lastDecisions ?? []) {
    url.searchParams.append('b[LastDecisions][]', decision);
  }
  for (const form of filters.form ?? []) {
    url.searchParams.append('b[FormOfTheObjectLawmaking][]', form);
  }
  if (filters.year !== undefined) url.searchParams.set('b[Year]', String(filters.year));
  if (filters.fzNumber) url.searchParams.set('b[FzNumber]', filters.fzNumber);
  if (filters.sectorOfLaw) url.searchParams.set('b[SectorOfLaw]', filters.sectorOfLaw);
  if (filters.thematicBlock) {
    url.searchParams.set('b[ThematicBlockOfBills]', filters.thematicBlock);
  }
  if (filters.responsibleCommittee) {
    url.searchParams.set('b[ResponsibleCommittee]', filters.responsibleCommittee);
  }
  if (filters.faction) url.searchParams.set('b[Fraction]', filters.faction);
  if (filters.deputy) url.searchParams.set('b[PersonDeputy]', filters.deputy);
  if (filters.query) url.searchParams.set('b[Annotation]', filters.query);

  if (filters.introducedFrom || filters.introducedTo) {
    // Период задаётся парой параметров; любой конец может быть опущен.
    if (filters.introducedFrom) {
      url.searchParams.set('date_period_from_IntroducedDate', toSozdDate(filters.introducedFrom));
    }
    if (filters.introducedTo) {
      url.searchParams.set('date_period_to_IntroducedDate', toSozdDate(filters.introducedTo));
    }
  }

  url.searchParams.set('count_items', String(options.pageSize ?? 250));

  const page = options.page ?? 1;
  if (page > 1) {
    url.searchParams.set(pageParamName(options), String(page));
  }

  return url.toString();
}

/**
 * Возвращает имя параметра страницы для выбранной формы поиска.
 *
 * Вынесено отдельно, чтобы ошибка была видна в тестах, а не проявлялась
 * бесконечным обходом первой страницы.
 */
export function pageParamName(options: SozdSearchOptions = {}): string {
  return options.extendedForm
    ? `page_${options.classGuid ?? BILL_CLASS_GUID}`
    : 'page';
}

export interface SozdSearchRow {
  /** Номер законопроекта из атрибута `data-law_number`. */
  number: string;
  name: string;
  /** Дата регистрации в ISO, если распознана. */
  registrationDate?: string;
  /** Абсолютный адрес карточки. */
  url: string;
}

export interface SozdSearchPage {
  rows: SozdSearchRow[];
  /** Общее число найденных объектов, если его удалось извлечь. */
  totalFound?: number;
  warnings: string[];
}

/** Разбирает страницу списка законопроектов. */
export function parseSearchPage(html: string, baseUrl = SOZD_BASE_URL): SozdSearchPage {
  const $ = cheerio.load(html);
  const rows: SozdSearchRow[] = [];
  const warnings: string[] = [];

  $('[data-law_number]').each((_, element) => {
    const node = $(element);
    const number = node.attr('data-law_number')?.trim();
    if (!number) return;

    const cells = node.find('td');
    const name =
      cells.eq(0).find('.fw500').first().text().trim() ||
      cells.eq(1).find('.fw500').first().text().trim() ||
      node.find('.fw500').first().text().trim();
    const dateText = cells.eq(1).text().trim() || cells.eq(2).text().trim();

    const row: SozdSearchRow = {
      number,
      name,
      url: `${baseUrl.replace(/\/$/, '')}/bill/${number}`,
    };
    const registrationDate = toIsoDate(dateText);
    if (registrationDate) row.registrationDate = registrationDate;
    rows.push(row);
  });

  if (rows.length === 0) {
    warnings.push(
      'На странице не найдено строк с атрибутом data-law_number. ' +
        'Возможные причины: изменилась вёрстка, страница отдана без результатов ' +
        'или параметр страницы не распознан (см. pageParamName).',
    );
  }

  const totalText = $('.search_results_count, .oz_count, .results-count').first().text();
  const total = /(\d[\d\s ]*)/u.exec(totalText.replace(/[\s ]/gu, ''))?.[1];
  const page: SozdSearchPage = { rows, warnings };
  if (total) page.totalFound = Number(total);
  return page;
}

/**
 * Проверка корректности обхода страниц.
 *
 * Если две подряд идущие страницы содержат одинаковый набор номеров,
 * это почти наверняка означает, что параметр страницы не был распознан
 * и сервер возвращает первую страницу. Молчаливо продолжать в такой ситуации
 * нельзя: обход завершится «успешно», собрав одну страницу многократно.
 */
export function detectPaginationStall(
  previous: readonly SozdSearchRow[],
  current: readonly SozdSearchRow[],
): boolean {
  if (previous.length === 0 || current.length === 0) return false;
  const previousNumbers = new Set(previous.map((row) => row.number));
  return current.every((row) => previousNumbers.has(row.number));
}
