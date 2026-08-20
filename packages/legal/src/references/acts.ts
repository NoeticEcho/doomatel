import type { ActRef, ActType } from '../identifiers/types.js';
import { CODE_CATALOGUE, type CodeEntry } from './codes.js';
import { MONTH_PATTERN, parseRussianDate } from './dates.js';

const RF = '(?:Российской\\s+Федерации|России|РФ)';

const ADJECTIVE_ENDINGS = [
  'ыми',
  'ими',
  'ого',
  'его',
  'ому',
  'ему',
  'ых',
  'их',
  'ый',
  'ий',
  'ым',
  'им',
  'ом',
  'ем',
  'ая',
  'яя',
  'ой',
  'ей',
  'ую',
  'юю',
  'ое',
  'ее',
  'ые',
  'ие',
];

const ADJECTIVE_SUFFIX_ALTERNATION = '(?:ый|ий|ого|его|ому|ему|ым|им|ом|ем|ая|ой|ую|ое|ые|ых|ыми)';

/** Снимает падежное окончание прилагательного, оставляя основу. */
export function stripAdjectiveEnding(word: string): string {
  for (const ending of ADJECTIVE_ENDINGS) {
    if (word.length > ending.length + 2 && word.toLowerCase().endsWith(ending)) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

const NOUN_KODEKS = 'кодекс(?:ами|ах|ам|ов|ом|у|а|е|ы)?';

/**
 * Строит регулярное выражение для наименования кодекса во всех падежах,
 * исходя из его наименования в родительном падеже.
 */
export function buildCodePattern(entry: CodeEntry): string {
  const genitive = entry.genitiveTitle;
  const words = genitive.split(/\s+/u);
  const first = words[0] ?? '';

  // Наименования, где существительное «Кодекс» стоит первым:
  // «Кодекса Российской Федерации об административных правонарушениях»,
  // «Кодекса административного судопроизводства Российской Федерации».
  if (/^кодекс/iu.test(first)) {
    const tail = words
      .slice(1)
      .join(' ')
      .replace(/Российской\s+Федерации/giu, RF)
      .replace(/\s+/gu, '\\s+');
    return `[Кк]${NOUN_KODEKS.slice(1)}\\s+${tail}`;
  }

  const stem = stripAdjectiveEnding(first);
  const rest = words
    .slice(1)
    .join(' ')
    .replace(/кодекса/giu, NOUN_KODEKS)
    .replace(/Российской\s+Федерации/giu, RF)
    .replace(/\s+/gu, '\\s+');
  return `${escapeRegex(stem)}${ADJECTIVE_SUFFIX_ALTERNATION}\\s+${rest}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

interface AnchorPattern {
  type: ActType;
  pattern: string;
  /** Запись каталога кодексов, если якорь распознаёт конкретный кодекс. */
  code?: CodeEntry;
  /** Базовая уверенность для якоря без реквизитов. */
  baseConfidence: number;
}

const NAMED_PATTERNS: AnchorPattern[] = [
  {
    type: 'constitution',
    pattern: `Конституци(?:я|и|ю|ей|ею|е)\\s+${RF}`,
    baseConfidence: 0.97,
  },
  {
    type: 'constitutional-law',
    pattern:
      'Федеральн(?:ый|ого|ому|ым|ом|ые|ых|ыми)\\s+конституционн(?:ый|ого|ому|ым|ом|ые|ых|ыми)\\s+закон(?:ами|ах|ам|ов|ом|у|а|е|ы)?',
    baseConfidence: 0.9,
  },
  {
    type: 'federal-law',
    pattern: 'Федеральн(?:ый|ого|ому|ым|ом|ые|ых|ыми)\\s+закон(?:ами|ах|ам|ов|ом|у|а|е|ы)?',
    baseConfidence: 0.9,
  },
  {
    type: 'law-rf',
    pattern: `Закон(?:ами|ах|ам|ов|ом|у|а|е|ы)?\\s+(?:${RF}|РСФСР)`,
    baseConfidence: 0.85,
  },
  {
    type: 'presidential-decree',
    pattern: `Указ(?:ами|ах|ам|ов|ом|у|а|е|ы)?\\s+Президент(?:а|ом|у|е)\\s+${RF}`,
    baseConfidence: 0.92,
  },
  {
    type: 'presidential-order',
    pattern: `Распоряжени(?:ями|ях|ям|ем|й|и|я|е)\\s+Президент(?:а|ом|у|е)\\s+${RF}`,
    baseConfidence: 0.92,
  },
  {
    type: 'government-resolution',
    pattern: `Постановлени(?:ями|ях|ям|ем|й|и|я|е)\\s+Правительств(?:а|ом|у|е)\\s+${RF}`,
    baseConfidence: 0.92,
  },
  {
    type: 'government-order',
    pattern: `Распоряжени(?:ями|ях|ям|ем|й|и|я|е)\\s+Правительств(?:а|ом|у|е)\\s+${RF}`,
    baseConfidence: 0.92,
  },
  {
    type: 'duma-resolution',
    pattern:
      'Постановлени(?:ями|ях|ям|ем|й|и|я|е)\\s+Государственн(?:ой|ая)\\s+Дум(?:ы|а|е|ой)',
    baseConfidence: 0.9,
  },
  {
    type: 'council-resolution',
    pattern: 'Постановлени(?:ями|ях|ям|ем|й|и|я|е)\\s+Совета\\s+Федерации',
    baseConfidence: 0.9,
  },
];

/** Все шаблоны якорей: именованные акты, кодексы (полные и сокращённые). */
export function buildAnchorPatterns(): AnchorPattern[] {
  const codeFull: AnchorPattern[] = CODE_CATALOGUE.map((entry) => ({
    type: 'code' as const,
    pattern: buildCodePattern(entry),
    code: entry,
    baseConfidence: 0.95,
  }));

  const codeAbbr: AnchorPattern[] = CODE_CATALOGUE.flatMap((entry) =>
    entry.abbreviations
      .filter((a) => /^[А-ЯЁA-Z]{2,5}(\s+РФ)?$/u.test(a))
      .map((a) => ({
        type: 'code' as const,
        pattern: `${escapeRegex(a).replace(/\s+/gu, '\\s+')}(?![а-яёА-ЯЁ])`,
        code: entry,
        baseConfidence: 0.93,
      })),
  );

  return [...NAMED_PATTERNS, ...codeFull, ...codeAbbr];
}

export interface ActAnchor {
  ref: ActRef;
  /** Позиция наименования акта (без реквизитов) в тексте. */
  nameSpan: [number, number];
  /** Позиция всего якоря вместе с реквизитами и наименованием в кавычках. */
  span: [number, number];
  raw: string;
  /** Якорь вида «настоящего Федерального закона» — ссылка на сам документ. */
  isSelf: boolean;
  confidence: number;
}

const DATE_PATTERN = `(?:\\d{1,2}[.\\-/]\\d{1,2}[.\\-/]\\d{4}|\\d{1,2}\\s+${MONTH_PATTERN}\\s+\\d{4}(?:\\s*(?:года|г\\.|г))?)`;
const NUMBER_PATTERN = '\\d+(?:[.\\-–—/][\\p{L}\\d.]+)*';
const SELF_PATTERN = 'настоящ(?:ий|его|ему|им|ем|ая|ей|ую)\\s+';

const REQUISITES_RE = new RegExp(
  `^\\s*(?:от\\s+(${DATE_PATTERN}))?\\s*(?:(?:№|N|No|#)\\s*(${NUMBER_PATTERN}))?\\s*(?:[«"„]([^»"“]{2,400})[»"“])?`,
  'iu',
);

/** Находит все упоминания актов в тексте вместе с реквизитами. */
export function findActAnchors(text: string): ActAnchor[] {
  const patterns = buildAnchorPatterns();
  const combined = new RegExp(
    `(${SELF_PATTERN})?(${patterns.map((p) => `(?:${p.pattern})`).join('|')})`,
    'giu',
  );

  const anchors: ActAnchor[] = [];
  let match: RegExpExecArray | null;
  while ((match = combined.exec(text)) !== null) {
    const selfPrefix = match[1];
    const name = match[2];
    if (!name) continue;
    const nameStart = match.index + (selfPrefix?.length ?? 0);
    const nameEnd = nameStart + name.length;

    const pattern = patterns.find((p) => new RegExp(`^(?:${p.pattern})$`, 'iu').test(name));
    if (!pattern) continue;

    const tail = text.slice(nameEnd, nameEnd + 500);
    const req = REQUISITES_RE.exec(tail);
    const rawDate = req?.[1];
    const number = req?.[3];
    const title = req?.[4];
    const requisitesLength = req && req[0].trim().length > 0 ? req[0].length : 0;

    const ref: ActRef = { type: pattern.type };
    if (pattern.code) {
      ref.shortName = pattern.code.shortName;
      ref.title = pattern.code.title;
      ref.date = pattern.code.date;
      ref.number = pattern.code.number;
    }
    if (rawDate) {
      const isoDate = parseRussianDate(rawDate.replace(/\s*(?:года|г\.|г)$/iu, '').trim());
      if (isoDate) ref.date = isoDate;
    }
    if (number) ref.number = number;
    if (title) ref.title = title;

    let confidence = pattern.baseConfidence;
    if (rawDate && number) confidence = Math.min(0.99, confidence + 0.07);
    else if (!rawDate && !number && !pattern.code) confidence -= 0.2;

    anchors.push({
      ref,
      nameSpan: [nameStart, nameEnd],
      span: [match.index, nameEnd + requisitesLength],
      raw: text.slice(match.index, nameEnd + requisitesLength),
      isSelf: Boolean(selfPrefix),
      confidence,
    });
    combined.lastIndex = Math.max(combined.lastIndex, nameEnd + requisitesLength);
  }
  return anchors;
}
