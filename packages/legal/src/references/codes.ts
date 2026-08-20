import type { ActRef } from '../identifiers/types.js';

/**
 * Каталог кодексов и иных актов, на которые обычно ссылаются сокращённо.
 *
 * ВАЖНО: реквизиты приведены по общеизвестным данным и должны валидироваться
 * против загруженного корпуса при старте приложения
 * (см. `validateCodeCatalogue` в пакете `@doomatel/ingest`).
 * Каталог нужен, чтобы сокращение «ГК РФ» разрешалось в устойчивый идентификатор.
 */
export interface CodeEntry extends ActRef {
  /** Все написания сокращения, встречающиеся в текстах. */
  abbreviations: string[];
  /** Полное наименование в родительном падеже (для сопоставления в тексте). */
  genitiveTitle: string;
  /** Кодекс состоит из нескольких частей, принятых отдельными законами. */
  parts?: Array<{ part: string; date: string; number: string }>;
}

export const CODE_CATALOGUE: CodeEntry[] = [
  {
    type: 'code',
    shortName: 'ГК РФ',
    abbreviations: ['ГК РФ', 'ГК', 'Гражданский кодекс РФ'],
    title: 'Гражданский кодекс Российской Федерации',
    genitiveTitle: 'Гражданского кодекса Российской Федерации',
    date: '1994-11-30',
    number: '51-ФЗ',
    parts: [
      { part: 'первая', date: '1994-11-30', number: '51-ФЗ' },
      { part: 'вторая', date: '1996-01-26', number: '14-ФЗ' },
      { part: 'третья', date: '2001-11-26', number: '146-ФЗ' },
      { part: 'четвёртая', date: '2006-12-18', number: '230-ФЗ' },
    ],
  },
  {
    type: 'code',
    shortName: 'УК РФ',
    abbreviations: ['УК РФ', 'УК', 'Уголовный кодекс РФ'],
    title: 'Уголовный кодекс Российской Федерации',
    genitiveTitle: 'Уголовного кодекса Российской Федерации',
    date: '1996-06-13',
    number: '63-ФЗ',
  },
  {
    type: 'code',
    shortName: 'УПК РФ',
    abbreviations: ['УПК РФ', 'УПК'],
    title: 'Уголовно-процессуальный кодекс Российской Федерации',
    genitiveTitle: 'Уголовно-процессуального кодекса Российской Федерации',
    date: '2001-12-18',
    number: '174-ФЗ',
  },
  {
    type: 'code',
    shortName: 'УИК РФ',
    abbreviations: ['УИК РФ', 'УИК'],
    title: 'Уголовно-исполнительный кодекс Российской Федерации',
    genitiveTitle: 'Уголовно-исполнительного кодекса Российской Федерации',
    date: '1997-01-08',
    number: '1-ФЗ',
  },
  {
    type: 'code',
    shortName: 'КоАП РФ',
    abbreviations: ['КоАП РФ', 'КоАП', 'Кодекс РФ об административных правонарушениях'],
    title: 'Кодекс Российской Федерации об административных правонарушениях',
    genitiveTitle: 'Кодекса Российской Федерации об административных правонарушениях',
    date: '2001-12-30',
    number: '195-ФЗ',
  },
  {
    type: 'code',
    shortName: 'НК РФ',
    abbreviations: ['НК РФ', 'НК', 'Налоговый кодекс РФ'],
    title: 'Налоговый кодекс Российской Федерации',
    genitiveTitle: 'Налогового кодекса Российской Федерации',
    date: '1998-07-31',
    number: '146-ФЗ',
    parts: [
      { part: 'первая', date: '1998-07-31', number: '146-ФЗ' },
      { part: 'вторая', date: '2000-08-05', number: '117-ФЗ' },
    ],
  },
  {
    type: 'code',
    shortName: 'БК РФ',
    abbreviations: ['БК РФ', 'БК', 'Бюджетный кодекс РФ'],
    title: 'Бюджетный кодекс Российской Федерации',
    genitiveTitle: 'Бюджетного кодекса Российской Федерации',
    date: '1998-07-31',
    number: '145-ФЗ',
  },
  {
    type: 'code',
    shortName: 'ТК РФ',
    abbreviations: ['ТК РФ', 'Трудовой кодекс РФ'],
    title: 'Трудовой кодекс Российской Федерации',
    genitiveTitle: 'Трудового кодекса Российской Федерации',
    date: '2001-12-30',
    number: '197-ФЗ',
  },
  {
    type: 'code',
    shortName: 'СК РФ',
    abbreviations: ['СК РФ', 'Семейный кодекс РФ'],
    title: 'Семейный кодекс Российской Федерации',
    genitiveTitle: 'Семейного кодекса Российской Федерации',
    date: '1995-12-29',
    number: '223-ФЗ',
  },
  {
    type: 'code',
    shortName: 'ЖК РФ',
    abbreviations: ['ЖК РФ', 'Жилищный кодекс РФ'],
    title: 'Жилищный кодекс Российской Федерации',
    genitiveTitle: 'Жилищного кодекса Российской Федерации',
    date: '2004-12-29',
    number: '188-ФЗ',
  },
  {
    type: 'code',
    shortName: 'ЗК РФ',
    abbreviations: ['ЗК РФ', 'Земельный кодекс РФ'],
    title: 'Земельный кодекс Российской Федерации',
    genitiveTitle: 'Земельного кодекса Российской Федерации',
    date: '2001-10-25',
    number: '136-ФЗ',
  },
  {
    type: 'code',
    shortName: 'ГрК РФ',
    abbreviations: ['ГрК РФ', 'Градостроительный кодекс РФ'],
    title: 'Градостроительный кодекс Российской Федерации',
    genitiveTitle: 'Градостроительного кодекса Российской Федерации',
    date: '2004-12-29',
    number: '190-ФЗ',
  },
  {
    type: 'code',
    shortName: 'ГПК РФ',
    abbreviations: ['ГПК РФ', 'ГПК'],
    title: 'Гражданский процессуальный кодекс Российской Федерации',
    genitiveTitle: 'Гражданского процессуального кодекса Российской Федерации',
    date: '2002-11-14',
    number: '138-ФЗ',
  },
  {
    type: 'code',
    shortName: 'АПК РФ',
    abbreviations: ['АПК РФ', 'АПК'],
    title: 'Арбитражный процессуальный кодекс Российской Федерации',
    genitiveTitle: 'Арбитражного процессуального кодекса Российской Федерации',
    date: '2002-07-24',
    number: '95-ФЗ',
  },
  {
    type: 'code',
    shortName: 'КАС РФ',
    abbreviations: ['КАС РФ', 'КАС'],
    title: 'Кодекс административного судопроизводства Российской Федерации',
    genitiveTitle: 'Кодекса административного судопроизводства Российской Федерации',
    date: '2015-03-08',
    number: '21-ФЗ',
  },
  {
    type: 'code',
    shortName: 'ЛК РФ',
    abbreviations: ['ЛК РФ', 'Лесной кодекс РФ'],
    title: 'Лесной кодекс Российской Федерации',
    genitiveTitle: 'Лесного кодекса Российской Федерации',
    date: '2006-12-04',
    number: '200-ФЗ',
  },
  {
    type: 'code',
    shortName: 'ВК РФ',
    abbreviations: ['ВК РФ', 'Водный кодекс РФ'],
    title: 'Водный кодекс Российской Федерации',
    genitiveTitle: 'Водного кодекса Российской Федерации',
    date: '2006-06-03',
    number: '74-ФЗ',
  },
  {
    type: 'code',
    shortName: 'ВзК РФ',
    abbreviations: ['Воздушный кодекс РФ'],
    title: 'Воздушный кодекс Российской Федерации',
    genitiveTitle: 'Воздушного кодекса Российской Федерации',
    date: '1997-03-19',
    number: '60-ФЗ',
  },
  {
    type: 'code',
    shortName: 'КТМ РФ',
    abbreviations: ['КТМ РФ', 'КТМ'],
    title: 'Кодекс торгового мореплавания Российской Федерации',
    genitiveTitle: 'Кодекса торгового мореплавания Российской Федерации',
    date: '1999-04-30',
    number: '81-ФЗ',
  },
];

/** Индекс сокращений → запись каталога (ключи в нижнем регистре, без лишних пробелов). */
export const CODE_BY_ABBREVIATION = new Map<string, CodeEntry>(
  CODE_CATALOGUE.flatMap((entry) => [
    ...entry.abbreviations.map((a) => [normalizeKey(a), entry] as const),
    [normalizeKey(entry.title ?? ''), entry] as const,
    [normalizeKey(entry.genitiveTitle), entry] as const,
  ]),
);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();
}

export { normalizeKey as normalizeCodeKey };
