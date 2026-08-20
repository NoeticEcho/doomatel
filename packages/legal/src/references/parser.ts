import type { ActRef, LegalReference, UnitRef } from '../identifiers/types.js';
import { findActAnchors, type ActAnchor } from './acts.js';
import { findUnitMentions, normalizeChainOrder, type UnitMention } from './units.js';

export interface ExtractOptions {
  /**
   * Акт, внутри текста которого выполняется разбор. Используется для
   * разрешения ссылок вида «настоящего Федерального закона» и для внутренних
   * ссылок без указания акта («в соответствии со статьёй 5»).
   */
  selfAct?: ActRef;
  /** Отбрасывать ссылки с уверенностью ниже порога. По умолчанию 0.5. */
  minConfidence?: number;
  /** Ограничение на число ссылок, порождаемых одним перечислением. */
  maxExpansion?: number;
}

/** Максимальный «зазор» между звеньями цепочки: только пробелы и запятые. */
const GAP_RE = /^[\s,]*$/u;

/**
 * Заголовок структурной единицы: «Статья 1. Предмет регулирования».
 *
 * Заголовок объявляет структуру документа, а не ссылается на неё, поэтому
 * ссылкой не является. Без этой проверки разбор любого закона выдаёт по
 * ложной ссылке на каждую статью, и настоящие ссылки тонут в шуме.
 */
const HEADING_RE =
  /^(?:стать[яи]|глав[аы]|раздел|подраздел|часть|§|приложение)\s+[\dIVXLC][\d.\-–IVXLC]*\s*[.:]/iu;

/** Начинается ли позиция с начала строки (допускаются пробелы). */
function isAtLineStart(text: string, position: number): boolean {
  for (let i = position - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === '\n') return true;
    if (char !== ' ' && char !== '\t') return false;
  }
  return true;
}

/** Является ли фрагмент заголовком структурной единицы, а не ссылкой. */
function looksLikeHeading(text: string, start: number, end: number): boolean {
  if (!isAtLineStart(text, start)) return false;
  // Заголовок распознаётся вместе с последующей точкой или двоеточием.
  return HEADING_RE.test(text.slice(start, Math.min(text.length, end + 2)));
}

function isAdjacent(text: string, from: number, to: number): boolean {
  if (to < from) return false;
  if (to - from > 3) return false;
  return GAP_RE.test(text.slice(from, to));
}

/**
 * Собирает цепочку структурных единиц, непосредственно предшествующих позиции
 * `before`, и возвращает её в порядке следования в тексте.
 * Приведение к порядку «от внешней к внутренней» выполняет `normalizeChainOrder`.
 */
function collectChainBefore(
  text: string,
  mentions: UnitMention[],
  before: number,
  consumed: Set<number>,
): { chain: UnitMention[]; startsAt: number } {
  const chain: UnitMention[] = [];
  let boundary = before;

  for (;;) {
    let bestIndex = -1;
    for (let i = mentions.length - 1; i >= 0; i -= 1) {
      if (consumed.has(i)) continue;
      const mention = mentions[i]!;
      if (mention.span[1] > boundary) continue;
      if (!isAdjacent(text, mention.span[1], boundary)) continue;
      bestIndex = i;
      break;
    }
    if (bestIndex === -1) break;
    const mention = mentions[bestIndex]!;
    consumed.add(bestIndex);
    chain.push(mention);
    boundary = mention.span[0];
  }

  chain.reverse();
  return { chain, startsAt: boundary };
}

/** Раскрывает перечисления в цепочке в набор конкретных путей. */
function expandChain(chain: UnitMention[], maxExpansion: number): UnitRef[][] {
  let paths: UnitRef[][] = [[]];
  for (const mention of chain) {
    const next: UnitRef[][] = [];
    for (const path of paths) {
      for (const number of mention.numbers) {
        if (next.length >= maxExpansion) break;
        next.push([...path, { kind: mention.kind, number }]);
      }
    }
    paths = next;
    if (paths.length === 0) return [];
  }
  return paths;
}

/**
 * Извлекает из текста ссылки на нормативные правовые акты и их структурные
 * единицы.
 *
 * Алгоритм:
 *  1. находим упоминания структурных единиц («пункта 2 части 3 статьи 15»);
 *  2. находим якоря актов («Федерального закона от 27.07.2006 № 149-ФЗ»);
 *  3. для каждого якоря забираем непосредственно предшествующую ему цепочку
 *     структурных единиц;
 *  4. оставшиеся цепочки считаем внутренними ссылками на `selfAct`.
 */
export function extractReferences(text: string, options: ExtractOptions = {}): LegalReference[] {
  const minConfidence = options.minConfidence ?? 0.5;
  const maxExpansion = options.maxExpansion ?? 64;

  const mentions = findUnitMentions(text);
  const anchors = findActAnchors(text);
  const consumed = new Set<number>();
  const references: LegalReference[] = [];

  const sortedAnchors = [...anchors].sort((a, b) => a.span[0] - b.span[0]);

  for (const anchor of sortedAnchors) {
    const { chain, startsAt } = collectChainBefore(text, mentions, anchor.span[0], consumed);
    const ordered = normalizeChainOrder(chain);
    const paths = ordered.length > 0 ? expandChain(ordered, maxExpansion) : [[]];
    // Ссылка «настоящий Федеральный закон» без указания структурной единицы
    // и без известного акта не несёт сведений: она не адресует ни к чему.
    if (anchor.isSelf && !options.selfAct && ordered.length === 0) {
      continue;
    }

    const ref = resolveAnchorRef(anchor, options.selfAct);
    const spanStart = chain.length > 0 ? startsAt : anchor.span[0];
    const raw = text.slice(spanStart, anchor.span[1]);

    for (const path of paths) {
      references.push({
        ...ref,
        path,
        raw,
        span: [spanStart, anchor.span[1]],
        confidence: anchor.isSelf && !options.selfAct ? anchor.confidence - 0.15 : anchor.confidence,
      });
    }
  }

  // Оставшиеся упоминания — внутренние ссылки на текущий акт.
  const leftover = mentions
    .map((mention, index) => ({ mention, index }))
    .filter(({ index }) => !consumed.has(index));

  const internalChains: UnitMention[][] = [];
  let current: UnitMention[] = [];
  for (let i = 0; i < leftover.length; i += 1) {
    const { mention } = leftover[i]!;
    const previous = current[current.length - 1];
    if (previous && isAdjacent(text, previous.span[1], mention.span[0])) {
      current.push(mention);
    } else {
      if (current.length > 0) internalChains.push(current);
      current = [mention];
    }
  }
  if (current.length > 0) internalChains.push(current);

  for (const chain of internalChains) {
    // Заголовок статьи — не ссылка на неё.
    if (
      chain.length === 1 &&
      looksLikeHeading(text, chain[0]!.span[0], chain[0]!.span[1])
    ) {
      continue;
    }

    const ordered = normalizeChainOrder(chain);
    const paths = expandChain(ordered, maxExpansion);
    const start = chain[0]!.span[0];
    const end = chain[chain.length - 1]!.span[1];
    const base: ActRef = options.selfAct ?? { type: 'other' };
    for (const path of paths) {
      references.push({
        ...base,
        path,
        raw: text.slice(start, end),
        span: [start, end],
        confidence: options.selfAct ? 0.8 : 0.55,
      });
    }
  }

  return references
    .filter((reference) => reference.confidence >= minConfidence)
    .sort((a, b) => a.span[0] - b.span[0] || b.confidence - a.confidence);
}

function resolveAnchorRef(anchor: ActAnchor, selfAct?: ActRef): ActRef {
  if (anchor.isSelf && selfAct) return { ...selfAct };
  return { ...anchor.ref };
}
