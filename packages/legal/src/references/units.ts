import type { UnitKind } from '../identifiers/types.js';

/** Порядковые числительные, встречающиеся в формулировках вида «абзац первый». */
const ORDINALS: Record<string, string> = {
  перв: '1',
  втор: '2',
  трет: '3',
  четверт: '4',
  пят: '5',
  шест: '6',
  седьм: '7',
  восьм: '8',
  девят: '9',
  десят: '10',
  одиннадцат: '11',
  двенадцат: '12',
  тринадцат: '13',
  четырнадцат: '14',
  пятнадцат: '15',
  шестнадцат: '16',
  семнадцат: '17',
  восемнадцат: '18',
  девятнадцат: '19',
  двадцат: '20',
};

const ORDINAL_PATTERN = Object.keys(ORDINALS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Преобразует порядковое числительное («первый», «второго») в цифру. */
export function ordinalToNumber(word: string): string | undefined {
  const lower = word.toLowerCase().replace(/ё/gu, 'е');
  for (const stem of Object.keys(ORDINALS).sort((a, b) => b.length - a.length)) {
    if (lower.startsWith(stem)) return ORDINALS[stem];
  }
  return undefined;
}

interface UnitPattern {
  kind: UnitKind;
  /** Регулярное выражение для слова-указателя (без якорей и групп). */
  word: string;
}

/**
 * Слова-указатели структурных единиц во всех падежах и числах, а также
 * общепринятые сокращения. Порядок важен: более длинные варианты идут раньше,
 * чтобы «подпункт» не поглощался паттерном «пункт».
 */
export const UNIT_PATTERNS: UnitPattern[] = [
  { kind: 'subitem', word: 'подпункт(?:ами|ах|ам|ов|ом|ы|а|у|е)?|подп\\.|пп\\.' },
  { kind: 'item', word: 'пункт(?:ами|ах|ам|ов|ом|ы|а|у|е)?|п\\.' },
  { kind: 'clause', word: 'част(?:ями|ях|ям|ей|ью|и|ь)|ч\\.' },
  { kind: 'article', word: 'стат(?:ьями|ьях|ьям|ьей|ьёй|ьи|ье|ью|ья|ей)|ст\\.' },
  { kind: 'indent', word: 'абзац(?:ами|ах|ам|ев|ем|ы|а|у|е)?|абз\\.' },
  { kind: 'subsection', word: 'подраздел(?:ами|ах|ам|ов|ом|ы|а|у|е)?' },
  { kind: 'section', word: 'раздел(?:ами|ах|ам|ов|ом|ы|а|у|е)?|разд\\.' },
  { kind: 'chapter', word: 'глав(?:ами|ах|ам|ой|ою|ы|у|е|а)|гл\\.' },
  { kind: 'paragraph-sign', word: 'параграф(?:ами|ах|ам|ов|ом|ы|а|у|е)?|§' },
  { kind: 'note', word: 'примечани(?:ями|ях|ям|ем|й|и|я|е)' },
  { kind: 'appendix', word: 'приложени(?:ями|ях|ям|ем|й|и|я|е)|прил\\.' },
];

/**
 * Номер структурной единицы. Поддерживаются:
 *  - арабские номера с уточнениями: `15`, `15.1`, `15-1`, `15¹`;
 *  - буквенные обозначения подпунктов: `«а»`, `"б"`, `в)`;
 *  - римские номера разделов и глав: `IV`;
 *  - порядковые числительные: `первый`, `второго`.
 */
const NUMBER_TOKEN = [
  '\\d+(?:[.\\-–—]\\d+)*[¹²³⁴⁵⁶⁷⁸⁹⁰]*',
  '[«"„][а-яёa-z][»"“]',
  '[а-яёa-z]\\)',
  '[IVXLC]{1,6}(?![а-яё])',
  `(?:${ORDINAL_PATTERN})(?:ый|ого|ому|ым|ом|ая|ой|ую|ое|ые|ых|им|ий|ье|ья)`,
].join('|');

/** Разделитель перечислений: «5, 7 и 9», «5 - 7». */
const ENUM_SEPARATOR = '\\s*(?:,|и|или|—|–|-)\\s*';

/** Полный токен списка номеров: `5`, `5 и 7`, `5, 7 и 9`, `5 - 7`. */
export const NUMBER_LIST = `(?:${NUMBER_TOKEN})(?:${ENUM_SEPARATOR}(?:${NUMBER_TOKEN}))*`;

export interface UnitMention {
  kind: UnitKind;
  /** Номера, перечисленные при одном слове-указателе. */
  numbers: string[];
  /** Позиция всего упоминания в исходном тексте. */
  span: [number, number];
  raw: string;
}

const RANGE_RE = /^(\d+)\s*[-–—]\s*(\d+)$/u;

/** Нормализует один номер: снимает кавычки, скобки, переводит порядковые в цифры. */
export function normalizeNumberToken(token: string): string {
  const trimmed = token.trim();
  const quoted = /^[«"„]([а-яёa-z])[»"“]$/iu.exec(trimmed);
  if (quoted) return quoted[1]!.toLowerCase();
  const lettered = /^([а-яёa-z])\)$/iu.exec(trimmed);
  if (lettered) return lettered[1]!.toLowerCase();
  const ordinal = ordinalToNumber(trimmed);
  if (ordinal && /^[а-яё]/iu.test(trimmed)) return ordinal;
  return trimmed.toLowerCase();
}

/** Раскрывает перечисление «5, 7 и 9» и диапазон «5 - 7» в список номеров. */
export function expandNumberList(raw: string): string[] {
  const range = RANGE_RE.exec(raw.trim());
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from && to - from <= 200) {
      return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
    }
  }
  return raw
    .split(/\s*(?:,|(?<![\p{L}])(?:и|или)(?![\p{L}]))\s*/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeNumberToken);
}

/**
 * Единый регэксп для поиска упоминаний структурных единиц.
 * Группа 1 — слово-указатель, группа 2 — список номеров.
 */
export function buildUnitRegex(): RegExp {
  const words = UNIT_PATTERNS.map((p) => `(?:${p.word})`).join('|');
  // `\b` не работает с кириллицей (это ASCII-граница слова), поэтому
  // используем явную проверку на отсутствие буквы/цифры слева.
  return new RegExp(`(?<![\\p{L}\\p{N}])(${words})\\s*(${NUMBER_LIST})`, 'giu');
}

const KIND_BY_WORD_CACHE = new Map<string, UnitKind>();

/** Определяет вид структурной единицы по найденному слову-указателю. */
export function kindFromWord(word: string): UnitKind | undefined {
  const key = word.toLowerCase().replace(/ё/gu, 'е');
  const cached = KIND_BY_WORD_CACHE.get(key);
  if (cached) return cached;
  for (const pattern of UNIT_PATTERNS) {
    if (new RegExp(`^(?:${pattern.word})$`, 'iu').test(word)) {
      KIND_BY_WORD_CACHE.set(key, pattern.kind);
      return pattern.kind;
    }
  }
  return undefined;
}

/** Находит все упоминания структурных единиц в тексте. */
export function findUnitMentions(text: string): UnitMention[] {
  const regex = buildUnitRegex();
  const out: UnitMention[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const kind = kindFromWord(match[1]!);
    if (!kind) continue;
    const numbers = expandNumberList(match[2]!);
    if (numbers.length === 0) continue;
    out.push({
      kind,
      numbers,
      span: [match.index, match.index + match[0].length],
      raw: match[0],
    });
  }
  return out;
}

/** Иерархический вес вида структурной единицы: чем меньше, тем «внешнее». */
export const KIND_DEPTH: Record<UnitKind, number> = {
  preamble: 0,
  part: 0,
  section: 1,
  subsection: 2,
  chapter: 3,
  'paragraph-sign': 4,
  article: 5,
  clause: 6,
  item: 7,
  subitem: 8,
  indent: 9,
  note: 10,
  appendix: 11,
};

/**
 * Приводит цепочку структурных единиц к порядку «от внешней к внутренней».
 *
 * В русских правовых ссылках цепочка обычно записывается наоборот
 * («пункта 2 части 3 статьи 15»), но встречается и прямой порядок
 * («статья 15, часть 3»), поэтому направление определяется по иерархии видов,
 * а не по позиции в тексте.
 */
export function normalizeChainOrder(chain: UnitMention[]): UnitMention[] {
  if (chain.length < 2) return chain;
  let inversions = 0;
  for (let i = 1; i < chain.length; i += 1) {
    if (KIND_DEPTH[chain[i]!.kind] < KIND_DEPTH[chain[i - 1]!.kind]) inversions += 1;
  }
  return inversions * 2 > chain.length - 1 ? [...chain].reverse() : chain;
}
