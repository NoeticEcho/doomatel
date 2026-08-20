const MONTHS: Record<string, number> = {
  январ: 1,
  феврал: 2,
  март: 3,
  апрел: 4,
  ма: 5, // «мая», «май» — обрабатывается отдельной проверкой
  июн: 6,
  июл: 7,
  август: 8,
  сентябр: 9,
  октябр: 10,
  ноябр: 11,
  декабр: 12,
};

export const MONTH_NAMES_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/** Регулярное выражение для месяца в родительном падеже. */
export const MONTH_PATTERN =
  '(январ[яь]|феврал[яь]|март[а]?|апрел[яь]|ма[йя]|июн[яь]|июл[яь]|август[а]?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])';

function monthFromName(name: string): number | undefined {
  const lower = name.toLowerCase();
  if (lower.startsWith('мая') || lower.startsWith('май')) return 5;
  for (const [stem, num] of Object.entries(MONTHS)) {
    if (stem !== 'ма' && lower.startsWith(stem)) return num;
  }
  return undefined;
}

function iso(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (year < 1000 || year > 2999) return undefined;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Разбирает дату в формах, встречающихся в текстах НПА:
 *   «27.07.2006», «27.7.2006», «27 июля 2006 года», «27 июля 2006 г.».
 * Возвращает ISO-дату (YYYY-MM-DD) либо `undefined`.
 */
export function parseRussianDate(input: string): string | undefined {
  const value = input.trim();

  const numeric = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/u.exec(value);
  if (numeric) {
    return iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  }

  const isoLike = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (isoLike) {
    return iso(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]));
  }

  const verbal = new RegExp(`^(\\d{1,2})\\s+${MONTH_PATTERN}\\s+(\\d{4})`, 'iu').exec(value);
  if (verbal) {
    const month = monthFromName(verbal[2]!);
    if (month === undefined) return undefined;
    return iso(Number(verbal[3]), month, Number(verbal[1]));
  }

  return undefined;
}

/** Форматирует ISO-дату в принятую в НПА словесную форму: «27 июля 2006 года». */
export function formatRussianDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (!match) throw new Error(`Некорректная ISO-дата: «${isoDate}»`);
  const month = MONTH_NAMES_GENITIVE[Number(match[2]) - 1];
  if (!month) throw new Error(`Некорректный месяц в дате: «${isoDate}»`);
  return `${Number(match[3])} ${month} ${match[1]} года`;
}
