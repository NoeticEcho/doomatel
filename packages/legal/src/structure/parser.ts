import type { UnitKind, UnitRef } from '../identifiers/types.js';
import { unitPathToString } from '../identifiers/uri.js';
import type { FlatUnit, ParsedAct, StructuralUnit } from './types.js';

/**
 * Разбор текста нормативного правового акта на структурные единицы.
 *
 * Иерархия по «Методическим рекомендациям по юридико-техническому оформлению
 * законопроектов»: раздел → глава → параграф → статья → часть → пункт →
 * подпункт → абзац.
 *
 * Важная особенность российской юридической техники: статья федерального
 * закона делится на **части** («1.», «2.»), а статья кодекса — на **пункты**
 * с той же нумерацией («1.», «2.»). Различить их по синтаксису невозможно,
 * поэтому вид дочерней единицы статьи задаётся параметром `articleChildKind`.
 */

export interface ParseActOptions {
  /**
   * Вид единицы, на которые делится статья:
   *  - `clause` (часть) — для федеральных законов, ФКЗ (по умолчанию);
   *  - `item` (пункт) — для кодексов (ГК РФ, НК РФ и др.).
   */
  articleChildKind?: Extract<UnitKind, 'clause' | 'item'>;
  /** Разбивать ли текст единиц на абзацы отдельными узлами. */
  splitIndents?: boolean;
}

interface LineMatcher {
  kind: UnitKind;
  /** Уровень в иерархии: меньше — «внешнее». */
  level: number;
  regex: RegExp;
}

/**
 * Заголовочные конструкции. Проверяются по началу строки в указанном порядке,
 * поэтому «Подраздел» должен идти раньше «Раздел».
 */
const HEADING_MATCHERS: LineMatcher[] = [
  {
    kind: 'part',
    level: 0,
    regex: /^ЧАСТЬ\s+([IVXLC]+|[А-ЯЁ]+|\d+)\.?\s*(.*)$/u,
  },
  {
    kind: 'subsection',
    level: 2,
    regex: /^Подраздел\s+([IVXLC\d]+(?:\.\d+)*)\.?\s*(.*)$/iu,
  },
  {
    kind: 'section',
    level: 1,
    regex: /^Раздел\s+([IVXLC\d]+(?:\.\d+)*)\.?\s*(.*)$/iu,
  },
  {
    kind: 'chapter',
    level: 3,
    regex: /^Глава\s+([IVXLC\d]+(?:[.\-–]\d+)*)\.?\s*(.*)$/iu,
  },
  {
    kind: 'paragraph-sign',
    level: 4,
    regex: /^§\s*(\d+(?:\.\d+)*)\.?\s*(.*)$/u,
  },
  {
    kind: 'article',
    level: 5,
    regex: /^Стать[яи]\s+(\d+(?:[.\-–]\d+)*[¹²³⁴⁵⁶⁷⁸⁹]*)\.?\s*(.*)$/iu,
  },
  {
    kind: 'appendix',
    level: 0,
    regex: /^Приложение\s*(?:№\s*)?(\d+)?\s*(.*)$/iu,
  },
];

/** Нумерованные единицы внутри статьи. */
const CLAUSE_RE = /^(\d+(?:[.\-–]\d+)*[¹²³⁴⁵⁶⁷⁸⁹]*)\.\s+(.*)$/u;
const ITEM_RE = /^(\d+(?:[.\-–]\d+)*)\)\s+(.*)$/u;
const SUBITEM_RE = /^([а-яё])\)\s+(.*)$/u;

const LEVEL_BY_KIND: Record<string, number> = {
  part: 0,
  appendix: 0,
  section: 1,
  subsection: 2,
  chapter: 3,
  'paragraph-sign': 4,
  article: 5,
  clause: 6,
  item: 7,
  subitem: 8,
  indent: 9,
  preamble: 5,
  note: 9,
};

interface StackEntry {
  unit: StructuralUnit;
  level: number;
}

/** Разбирает текст акта в дерево структурных единиц. */
export function parseAct(text: string, options: ParseActOptions = {}): ParsedAct {
  const articleChildKind = options.articleChildKind ?? 'clause';
  const warnings: string[] = [];
  const lines = splitLines(text);

  const roots: StructuralUnit[] = [];
  const stack: StackEntry[] = [];
  let preambleLines: Array<{ text: string; start: number; end: number }> = [];
  let seenStructure = false;

  const push = (unit: StructuralUnit, level: number) => {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      unit.path = [...parent.unit.path, lastRef(unit)];
      parent.unit.children.push(unit);
    } else {
      unit.path = [lastRef(unit)];
      roots.push(unit);
    }
    stack.push({ unit, level });
    seenStructure = true;
  };

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed) continue;

    const heading = matchHeading(trimmed);
    if (heading) {
      push(
        makeUnit(heading.kind, heading.number, heading.heading, '', [line.start, line.end]),
        heading.level,
      );
      continue;
    }

    if (!seenStructure) {
      preambleLines.push({ text: trimmed, start: line.start, end: line.end });
      continue;
    }

    const inArticle = stack.some((entry) => entry.unit.kind === 'article');

    const subitem = SUBITEM_RE.exec(trimmed);
    if (subitem && inArticle) {
      push(
        makeUnit('subitem', subitem[1], undefined, subitem[2] ?? '', [line.start, line.end]),
        LEVEL_BY_KIND['subitem']!,
      );
      continue;
    }

    const item = ITEM_RE.exec(trimmed);
    if (item && inArticle) {
      push(
        makeUnit('item', item[1], undefined, item[2] ?? '', [line.start, line.end]),
        LEVEL_BY_KIND['item']!,
      );
      continue;
    }

    const clause = CLAUSE_RE.exec(trimmed);
    if (clause && inArticle) {
      push(
        makeUnit(articleChildKind, clause[1], undefined, clause[2] ?? '', [line.start, line.end]),
        LEVEL_BY_KIND[articleChildKind]!,
      );
      continue;
    }

    // Не нумерованная строка — продолжение текущей единицы (абзац).
    const current = stack[stack.length - 1];
    if (!current) {
      preambleLines.push({ text: trimmed, start: line.start, end: line.end });
      continue;
    }

    if (options.splitIndents) {
      const indentNumber = String(
        current.unit.children.filter((child) => child.kind === 'indent').length + 1,
      );
      const indent = makeUnit('indent', indentNumber, undefined, trimmed, [line.start, line.end]);
      indent.path = [...current.unit.path, lastRef(indent)];
      current.unit.children.push(indent);
    } else {
      current.unit.text = current.unit.text ? `${current.unit.text}\n${trimmed}` : trimmed;
    }
    current.unit.span[1] = line.end;
  }

  // Границы узлов: конец узла — конец последнего потомка.
  for (const root of roots) fixSpans(root);

  const header = extractHeader(preambleLines);
  const result: ParsedAct = { units: roots, warnings };
  if (header.title) result.title = header.title;
  if (header.actTypeLabel) result.actTypeLabel = header.actTypeLabel;

  if (header.body.length > 0) {
    const start = header.body[0]!.start;
    const end = header.body[header.body.length - 1]!.end;
    result.preamble = makeUnit(
      'preamble',
      undefined,
      undefined,
      header.body.map((l) => l.text).join('\n'),
      [start, end],
    );
    result.preamble.path = [{ kind: 'preamble' }];
  }

  if (roots.length === 0) warnings.push('В тексте не найдено ни одной структурной единицы');

  return result;
}

function makeUnit(
  kind: UnitKind,
  number: string | undefined,
  heading: string | undefined,
  text: string,
  span: [number, number],
): StructuralUnit {
  const unit: StructuralUnit = { kind, text, path: [], span, children: [] };
  if (number) unit.number = number;
  if (heading) unit.heading = heading;
  return unit;
}

function lastRef(unit: StructuralUnit): UnitRef {
  return unit.number ? { kind: unit.kind, number: unit.number } : { kind: unit.kind };
}

function matchHeading(
  line: string,
): { kind: UnitKind; level: number; number?: string; heading?: string } | undefined {
  for (const matcher of HEADING_MATCHERS) {
    const match = matcher.regex.exec(line);
    if (!match) continue;
    const number = match[1]?.trim();
    const heading = match[2]?.trim();
    return {
      kind: matcher.kind,
      level: matcher.level,
      ...(number ? { number } : {}),
      ...(heading ? { heading } : {}),
    };
  }
  return undefined;
}

function fixSpans(unit: StructuralUnit): void {
  for (const child of unit.children) fixSpans(child);
  const last = unit.children[unit.children.length - 1];
  if (last && last.span[1] > unit.span[1]) unit.span[1] = last.span[1];
}

interface HeaderLine {
  text: string;
  start: number;
  end: number;
}

const ACT_TYPE_HEADER_RE =
  /^(РОССИЙСКАЯ ФЕДЕРАЦИЯ|ФЕДЕРАЛЬНЫЙ ЗАКОН|ФЕДЕРАЛЬНЫЙ КОНСТИТУЦИОННЫЙ ЗАКОН|ЗАКОН РОССИЙСКОЙ ФЕДЕРАЦИИ|УКАЗ|ПОСТАНОВЛЕНИЕ|КОДЕКС[\s\S]*)$/u;
const ADOPTION_RE = /^(Принят|Одобрен|Утверждён|Утвержден)\s/u;

/**
 * Отделяет шапку акта (вид, наименование, отметки о принятии) от преамбулы.
 * Преамбула — содержательный текст до первой структурной единицы.
 */
function extractHeader(lines: HeaderLine[]): {
  title?: string;
  actTypeLabel?: string;
  body: HeaderLine[];
} {
  let actTypeLabel: string | undefined;
  let title: string | undefined;
  const body: HeaderLine[] = [];

  for (const line of lines) {
    if (!actTypeLabel && ACT_TYPE_HEADER_RE.test(line.text)) {
      if (line.text !== 'РОССИЙСКАЯ ФЕДЕРАЦИЯ') actTypeLabel = line.text;
      continue;
    }
    if (ADOPTION_RE.test(line.text)) continue;
    if (!title && actTypeLabel && /^[«"]?О\s|^[«"]?Об\s|^[«"]?О[бт]\b/u.test(line.text)) {
      title = line.text.replace(/^[«"]|[»"]$/gu, '');
      continue;
    }
    body.push(line);
  }

  return {
    ...(title ? { title } : {}),
    ...(actTypeLabel ? { actTypeLabel } : {}),
    body,
  };
}

function splitLines(text: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text[i] === '\n') {
      out.push({ text: text.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  return out;
}

/** Разворачивает дерево в плоский список — для индексации и хранения. */
export function flattenAct(act: ParsedAct): FlatUnit[] {
  const out: FlatUnit[] = [];

  const walk = (unit: StructuralUnit, depth: number): string => {
    const childTexts = unit.children.map((child) => walk(child, depth + 1));
    const own = unit.text.trim();
    const headingLine = unit.heading
      ? `${formatUnitLabel(unit)} ${unit.heading}`.trim()
      : formatUnitLabel(unit);
    const fullText = [headingLine, own, ...childTexts].filter(Boolean).join('\n');

    const flat: FlatUnit = {
      kind: unit.kind,
      fullText,
      ownText: own,
      path: unit.path,
      pathString: unitPathToString(unit.path),
      span: unit.span,
      depth,
    };
    if (unit.number) flat.number = unit.number;
    if (unit.heading) flat.heading = unit.heading;
    out.push(flat);
    return fullText;
  };

  if (act.preamble) walk(act.preamble, 0);
  for (const unit of act.units) walk(unit, 0);
  return out;
}

const LABEL_BY_KIND: Partial<Record<UnitKind, string>> = {
  part: 'Часть',
  section: 'Раздел',
  subsection: 'Подраздел',
  chapter: 'Глава',
  'paragraph-sign': '§',
  article: 'Статья',
  appendix: 'Приложение',
  preamble: 'Преамбула',
};

/** Формирует человекочитаемую подпись единицы: «Статья 15». */
export function formatUnitLabel(unit: Pick<StructuralUnit, 'kind' | 'number'>): string {
  const label = LABEL_BY_KIND[unit.kind];
  if (!label) return unit.number ? `${unit.number})` : '';
  return unit.number ? `${label} ${unit.number}` : label;
}

/** Находит узел по пути. */
export function findUnit(act: ParsedAct, path: readonly UnitRef[]): StructuralUnit | undefined {
  const target = unitPathToString(path);
  const search = (units: StructuralUnit[]): StructuralUnit | undefined => {
    for (const unit of units) {
      if (unitPathToString(unit.path) === target) return unit;
      const found = search(unit.children);
      if (found) return found;
    }
    return undefined;
  };
  return search(act.preamble ? [act.preamble, ...act.units] : act.units);
}
