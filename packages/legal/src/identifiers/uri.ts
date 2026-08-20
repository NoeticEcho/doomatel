import { UNIT_KIND_SLUGS, type ActRef, type ActType, type UnitKind, type UnitRef } from './types.js';

/**
 * Идентификатор акта в стиле ELI/FRBR, адаптированный под российское право.
 *
 * Work (сам акт, вне зависимости от редакции):
 *   `eli:rf:federal-law:2006-07-27:149-fz`
 * Expression (конкретная редакция на дату):
 *   `eli:rf:federal-law:2006-07-27:149-fz@2024-08-08`
 * Структурная единица внутри редакции:
 *   `eli:rf:federal-law:2006-07-27:149-fz@2024-08-08#st_15/p_3/i_2`
 *
 * Схема выбрана так, чтобы идентификатор был:
 *  - устойчивым (не зависит от внутренних id источника);
 *  - человекочитаемым;
 *  - пригодным как первичный ключ и как якорь для цитат в ответах ИИ.
 */

const SLUG_BY_TYPE: Record<ActType, string> = {
  constitution: 'constitution',
  'constitutional-law': 'constitutional-law',
  'federal-law': 'federal-law',
  code: 'code',
  'law-rf': 'law-rf',
  'presidential-decree': 'decree',
  'presidential-order': 'president-order',
  'government-resolution': 'gov-resolution',
  'government-order': 'gov-order',
  'ministerial-act': 'ministerial',
  'duma-resolution': 'duma-resolution',
  'council-resolution': 'council-resolution',
  'constitutional-court': 'ksrf',
  'supreme-court': 'vsrf',
  'international-treaty': 'treaty',
  'regional-act': 'regional',
  'municipal-act': 'municipal',
  'draft-law': 'draft',
  other: 'other',
};

const TYPE_BY_SLUG: Record<string, ActType> = Object.fromEntries(
  Object.entries(SLUG_BY_TYPE).map(([type, slug]) => [slug, type as ActType]),
) as Record<string, ActType>;

const KIND_BY_SLUG: Record<string, UnitKind> = Object.fromEntries(
  Object.entries(UNIT_KIND_SLUGS).map(([kind, slug]) => [slug, kind as UnitKind]),
) as Record<string, UnitKind>;

/** Нормализует номер акта для использования в идентификаторе: «149-ФЗ» → «149-fz». */
export function normalizeActNumber(number: string): string {
  return number
    .trim()
    .toLowerCase()
    .replace(/^[№#nº]\s*/u, '')
    .replace(/ф3$/u, 'фз') // частая опечатка: цифра «3» вместо буквы «з»
    .replace(/[\s ]+/gu, '')
    .replace(/фкз/gu, 'fkz')
    .replace(/фз/gu, 'fz')
    .replace(/[^\p{L}\p{N}.\-/]/gu, '');
}

/** Нормализует номер структурной единицы: «15.1», «2-1», «а», «10¹» → «15.1», «2-1», «а», «10.1». */
export function normalizeUnitNumber(number: string): string {
  const superscripts: Record<string, string> = {
    '¹': '1',
    '²': '2',
    '³': '3',
    '⁴': '4',
    '⁵': '5',
    '⁶': '6',
    '⁷': '7',
    '⁸': '8',
    '⁹': '9',
    '⁰': '0',
  };
  let out = '';
  let sawSuperscript = false;
  for (const ch of number.trim()) {
    const mapped = superscripts[ch];
    if (mapped !== undefined) {
      if (!sawSuperscript) out += '.';
      sawSuperscript = true;
      out += mapped;
    } else {
      sawSuperscript = false;
      out += ch;
    }
  }
  return out
    .toLowerCase()
    .replace(/[\s ]+/gu, '')
    .replace(/[).]+$/u, '');
}

function actSegments(ref: ActRef): string {
  const type = SLUG_BY_TYPE[ref.type] ?? 'other';
  const date = ref.date ?? '0000-00-00';
  const number = ref.number ? normalizeActNumber(ref.number) : 'none';
  return `${type}:${date}:${number}`;
}

/** Строит идентификатор уровня Work. */
export function actUri(ref: ActRef): string {
  return `eli:rf:${actSegments(ref)}`;
}

/** Строит идентификатор уровня Expression (редакция на дату). */
export function expressionUri(ref: ActRef, asOf: string): string {
  return `${actUri(ref)}@${asOf}`;
}

/** Сериализует путь к структурной единице: `st_15/p_3/i_2`. */
export function unitPathToString(path: readonly UnitRef[]): string {
  return path
    .map((unit) => {
      const slug = UNIT_KIND_SLUGS[unit.kind];
      return unit.number ? `${slug}_${normalizeUnitNumber(unit.number)}` : slug;
    })
    .join('/');
}

/** Разбирает путь к структурной единице обратно в массив. */
export function unitPathFromString(path: string): UnitRef[] {
  if (!path) return [];
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const idx = segment.indexOf('_');
      const slug = idx === -1 ? segment : segment.slice(0, idx);
      const number = idx === -1 ? undefined : segment.slice(idx + 1);
      const kind = KIND_BY_SLUG[slug];
      if (!kind) throw new Error(`Неизвестный вид структурной единицы: «${slug}»`);
      return number ? { kind, number } : { kind };
    });
}

/** Полный идентификатор со структурной единицей и (опционально) датой редакции. */
export function unitUri(ref: ActRef, path: readonly UnitRef[], asOf?: string): string {
  const base = asOf ? expressionUri(ref, asOf) : actUri(ref);
  const suffix = unitPathToString(path);
  return suffix ? `${base}#${suffix}` : base;
}

export interface ParsedUri {
  type: ActType;
  date?: string;
  number?: string;
  asOf?: string;
  path: UnitRef[];
}

/** Разбирает идентификатор обратно в структуру. Бросает при некорректном формате. */
export function parseUri(uri: string): ParsedUri {
  const match = /^eli:rf:([^:]+):([^:]+):([^@#]+)(?:@([^#]+))?(?:#(.*))?$/u.exec(uri.trim());
  if (!match) throw new Error(`Некорректный идентификатор акта: «${uri}»`);
  const [, typeSlug, date, number, asOf, path] = match;
  const type = TYPE_BY_SLUG[typeSlug ?? ''];
  if (!type) throw new Error(`Неизвестный тип акта в идентификаторе: «${typeSlug}»`);
  const result: ParsedUri = { type, path: unitPathFromString(path ?? '') };
  if (date && date !== '0000-00-00') result.date = date;
  if (number && number !== 'none') result.number = number;
  if (asOf) result.asOf = asOf;
  return result;
}

/**
 * Идентификатор законопроекта в СОЗД: «1234567-8» → `eli:rf:draft:sozd:1234567-8`.
 * Номер законопроекта состоит из порядкового номера и номера созыва.
 */
export function billUri(billNumber: string): string {
  return `eli:rf:draft:sozd:${billNumber.trim().toLowerCase()}`;
}

/** Разбирает номер законопроекта «1234567-8» на порядковый номер и созыв. */
export function parseBillNumber(billNumber: string): { serial: string; convocation: number } {
  const match = /^(\d{1,10})-(\d{1,2})$/u.exec(billNumber.trim());
  if (!match) throw new Error(`Некорректный номер законопроекта: «${billNumber}»`);
  return { serial: match[1]!, convocation: Number(match[2]) };
}
