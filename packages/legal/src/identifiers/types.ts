/**
 * Типы нормативных правовых актов Российской Федерации.
 *
 * Порядок и наименования согласованы с Классификатором правовых актов
 * (утв. Указом Президента РФ от 15.03.2000 № 511) и практикой СОЗД.
 */
export const ACT_TYPES = [
  'constitution', // Конституция Российской Федерации
  'constitutional-law', // Федеральный конституционный закон
  'federal-law', // Федеральный закон
  'code', // Кодекс (форма федерального закона, выделена отдельно для удобства ссылок)
  'law-rf', // Закон Российской Федерации (до 1994 г.)
  'presidential-decree', // Указ Президента Российской Федерации
  'presidential-order', // Распоряжение Президента Российской Федерации
  'government-resolution', // Постановление Правительства Российской Федерации
  'government-order', // Распоряжение Правительства Российской Федерации
  'ministerial-act', // Акт федерального органа исполнительной власти (приказ и т. п.)
  'duma-resolution', // Постановление Государственной Думы
  'council-resolution', // Постановление Совета Федерации
  'constitutional-court', // Постановление/определение Конституционного Суда
  'supreme-court', // Постановление Пленума Верховного Суда
  'international-treaty', // Международный договор
  'regional-act', // Акт субъекта Российской Федерации
  'municipal-act', // Муниципальный правовой акт
  'draft-law', // Законопроект (ещё не акт, но участвует в тех же связях)
  'other',
] as const;

export type ActType = (typeof ACT_TYPES)[number];

export const ACT_TYPE_LABELS: Record<ActType, string> = {
  constitution: 'Конституция Российской Федерации',
  'constitutional-law': 'Федеральный конституционный закон',
  'federal-law': 'Федеральный закон',
  code: 'Кодекс',
  'law-rf': 'Закон Российской Федерации',
  'presidential-decree': 'Указ Президента Российской Федерации',
  'presidential-order': 'Распоряжение Президента Российской Федерации',
  'government-resolution': 'Постановление Правительства Российской Федерации',
  'government-order': 'Распоряжение Правительства Российской Федерации',
  'ministerial-act': 'Акт федерального органа исполнительной власти',
  'duma-resolution': 'Постановление Государственной Думы',
  'council-resolution': 'Постановление Совета Федерации',
  'constitutional-court': 'Акт Конституционного Суда Российской Федерации',
  'supreme-court': 'Акт Верховного Суда Российской Федерации',
  'international-treaty': 'Международный договор Российской Федерации',
  'regional-act': 'Нормативный правовой акт субъекта Российской Федерации',
  'municipal-act': 'Муниципальный правовой акт',
  'draft-law': 'Законопроект',
  other: 'Иной акт',
};

/**
 * Виды структурных единиц нормативного правового акта.
 *
 * Иерархия по «Методическим рекомендациям по юридико-техническому оформлению
 * законопроектов» (Аппарат ГД / ГПУ Президента РФ):
 *   раздел → глава → параграф → статья → часть → пункт → подпункт → абзац.
 * В кодексах вместо «части» может использоваться «пункт» (ГК РФ), поэтому
 * иерархия хранится как список, а не как жёсткая вложенность.
 */
export const UNIT_KINDS = [
  'preamble', // преамбула
  'part', // часть (крупная — как «часть первая ГК РФ»)
  'section', // раздел
  'subsection', // подраздел
  'chapter', // глава
  'paragraph-sign', // параграф (§)
  'article', // статья
  'clause', // часть статьи
  'item', // пункт
  'subitem', // подпункт
  'indent', // абзац
  'note', // примечание
  'appendix', // приложение
] as const;

export type UnitKind = (typeof UNIT_KINDS)[number];

/** Короткие обозначения структурных единиц для компактных идентификаторов. */
export const UNIT_KIND_SLUGS: Record<UnitKind, string> = {
  preamble: 'preamb',
  part: 'pt',
  section: 'sec',
  subsection: 'subsec',
  chapter: 'ch',
  'paragraph-sign': 'par',
  article: 'st',
  clause: 'p',
  item: 'i',
  subitem: 'si',
  indent: 'abz',
  note: 'note',
  appendix: 'app',
};

export const UNIT_KIND_LABELS: Record<UnitKind, { nominative: string; genitive: string }> = {
  preamble: { nominative: 'преамбула', genitive: 'преамбулы' },
  part: { nominative: 'часть', genitive: 'части' },
  section: { nominative: 'раздел', genitive: 'раздела' },
  subsection: { nominative: 'подраздел', genitive: 'подраздела' },
  chapter: { nominative: 'глава', genitive: 'главы' },
  'paragraph-sign': { nominative: 'параграф', genitive: 'параграфа' },
  article: { nominative: 'статья', genitive: 'статьи' },
  clause: { nominative: 'часть', genitive: 'части' },
  item: { nominative: 'пункт', genitive: 'пункта' },
  subitem: { nominative: 'подпункт', genitive: 'подпункта' },
  indent: { nominative: 'абзац', genitive: 'абзаца' },
  note: { nominative: 'примечание', genitive: 'примечания' },
  appendix: { nominative: 'приложение', genitive: 'приложения' },
};

/** Один шаг пути к структурной единице: вид + номер (номер может быть «15.1», «2-1», «а»). */
export interface UnitRef {
  kind: UnitKind;
  number?: string;
}

/**
 * Ссылка на акт (уровень Work по FRBR) — без привязки к редакции.
 */
export interface ActRef {
  type: ActType;
  /** Номер акта в исходном виде: «149-ФЗ», «511», «1-ФКЗ». */
  number?: string;
  /** Дата принятия/подписания в формате ISO (YYYY-MM-DD). */
  date?: string;
  /** Наименование акта, если извлечено. */
  title?: string;
  /** Общеупотребимое сокращение: «ГК РФ», «КоАП РФ». */
  shortName?: string;
}

/** Полная ссылка: акт + путь к структурной единице + (опционально) дата редакции. */
export interface LegalReference extends ActRef {
  /** Путь к структурной единице, от внешней к внутренней. */
  path: UnitRef[];
  /** Дата редакции (уровень Expression по FRBR), ISO. */
  asOf?: string;
  /** Исходная подстрока, из которой распознана ссылка. */
  raw: string;
  /** Позиция исходной подстроки в тексте: [start, end). */
  span: [number, number];
  /** Уверенность распознавания, 0..1. */
  confidence: number;
}
