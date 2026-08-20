import {
  flattenAct,
  formatUnitLabel,
  parseAct,
  unitPathToString,
  type ActRef,
  type FlatUnit,
  type ParseActOptions,
  type UnitKind,
} from '@doomatel/legal';

/**
 * Разбиение правовых текстов на фрагменты для поиска.
 *
 * Ключевое решение: границы фрагментов совпадают с границами структурных
 * единиц, а не с окном фиксированной длины. Причина в том, что ответ
 * законодательного помощника обязан содержать точную ссылку («часть 3
 * статьи 15»), а ссылка на «фрагмент, начинающийся с 4200-го символа»
 * бессмысленна. Фрагмент, разрезающий статью посередине, к тому же теряет
 * условие или исключение, из-за чего норма читается неверно.
 *
 * Слишком короткие единицы объединяются с соседями, слишком длинные —
 * делятся по абзацам с перекрытием и помечаются как части одной единицы.
 */

export type ChunkDocKind =
  | 'law'
  | 'code'
  | 'constitution'
  | 'decree'
  | 'regulation'
  | 'bill'
  | 'bill_explanatory'
  | 'bill_feo'
  | 'bill_conclusion'
  | 'bill_review'
  | 'bill_amendments'
  | 'bill_repeal_list'
  | 'transcript'
  | 'draft'
  | 'uploaded';

export interface LegalChunk {
  /** Порядковый номер фрагмента в документе. */
  chunkIndex: number;
  docKind: ChunkDocKind;
  /** Вид структурной единицы, из которой получен фрагмент. */
  kind: UnitKind;
  /** Сериализованный путь: `ch_1/st_15/p_3`. */
  path: string;
  /** Подпись единицы: «Статья 15». */
  label: string;
  heading?: string;
  /** Дословный текст фрагмента. */
  text: string;
  /**
   * Строка, подаваемая на эмбеддинг: заголовок акта, путь и текст.
   * Хранится отдельно, потому что при смене шаблона нужно переиндексировать
   * ровно те фрагменты, у которых изменился вход модели.
   */
  embedInput: string;
  /** Готовая короткая ссылка для цитирования. */
  citationShort: string;
  /** Готовая полная ссылка. */
  citationFull: string;
  charStart: number;
  charEnd: number;
  /** Путь родительской единицы — для стратегии parent-document retrieval. */
  parentPath?: string;
  /** Фрагмент является частью длинной единицы. */
  isPartial: boolean;
  partIndex: number;
  partTotal: number;
  /** Оценка длины в токенах. */
  approxTokens: number;
}

export interface ChunkOptions extends ParseActOptions {
  docKind?: ChunkDocKind;
  /** Реквизиты акта — используются в ссылках и во входе эмбеддинга. */
  act?: ActRef;
  /** Целевой размер фрагмента в токенах. */
  targetTokens?: number;
  /** Верхняя граница: единицы длиннее делятся на части. */
  maxTokens?: number;
  /** Единицы короче объединяются с соседними. */
  minTokens?: number;
  /** Перекрытие между частями длинной единицы, в токенах. */
  overlapTokens?: number;
  /**
   * Виды единиц, становящиеся самостоятельными фрагментами.
   * По умолчанию — статья: это естественная единица цитирования.
   */
  chunkAtKinds?: UnitKind[];
}

const DEFAULTS = {
  docKind: 'law' as ChunkDocKind,
  targetTokens: 800,
  maxTokens: 1800,
  minTokens: 80,
  overlapTokens: 60,
  chunkAtKinds: ['article', 'preamble', 'appendix', 'note'] as UnitKind[],
};

/**
 * Оценка числа токенов.
 *
 * Точный подсчёт требовал бы токенизатора модели; для решения о разбиении
 * достаточно оценки. Для русского текста отношение символов к токенам
 * у моделей семейства XLM-R близко к 3,2.
 */
export function approxTokenCount(text: string): number {
  return Math.ceil(text.length / 3.2);
}

/** Формирует короткую ссылку: «ч. 3 ст. 15 ФЗ-149». */
export function buildCitationShort(path: string, act?: ActRef): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const [slug, number] = segment.split('_');
      const short: Record<string, string> = {
        pt: 'ч.',
        sec: 'разд.',
        subsec: 'подразд.',
        ch: 'гл.',
        par: '§',
        st: 'ст.',
        p: 'ч.',
        i: 'п.',
        si: 'подп.',
        abz: 'абз.',
        app: 'прил.',
        preamb: 'преамбула',
        note: 'прим.',
      };
      const label = short[slug ?? ''] ?? slug ?? '';
      return number ? `${label} ${number}` : label;
    })
    .reverse()
    .join(' ');

  const actPart = act?.shortName ?? (act?.number ? `ФЗ-${act.number.replace(/-ФЗ$/iu, '')}` : '');
  return [parts, actPart].filter(Boolean).join(' ');
}

/** Формирует полную ссылку с реквизитами акта. */
export function buildCitationFull(path: string, act?: ActRef): string {
  const structural = buildCitationShort(path, undefined);
  if (!act) return structural;

  const requisites = [
    act.title ? `${act.shortName ? '' : ''}` : '',
    act.date ? `от ${act.date.split('-').reverse().join('.')}` : '',
    act.number ? `№ ${act.number}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const name = act.title ? ` «${act.title}»` : '';
  const actLabel = act.shortName ?? 'Федерального закона';
  return [structural, `${actLabel} ${requisites}${name}`.replace(/\s+/gu, ' ').trim()]
    .filter(Boolean)
    .join(' ');
}

/** Разбивает текст акта на фрагменты, уважая его структуру. */
export function chunkAct(text: string, options: ChunkOptions = {}): LegalChunk[] {
  const config = { ...DEFAULTS, ...options };
  const act = parseAct(text, options);
  const flat = flattenAct(act);

  const chunkAt = new Set(config.chunkAtKinds);
  const candidates = flat.filter((unit) => chunkAt.has(unit.kind));

  // Преамбула сама по себе структурой не является: у документа без статей
  // (пояснительная записка, отзыв, стенограмма) весь текст попадает в неё,
  // и единственный «структурный» фрагмент оказался бы всем документом.
  // Такие документы режем по абзацам — цитируемость обеспечивают смещения.
  const hasRealStructure = candidates.some((unit) => unit.kind !== 'preamble');
  if (!hasRealStructure) {
    return chunkPlainText(text, config);
  }

  const chunks: LegalChunk[] = [];
  let index = 0;
  let pending: FlatUnit[] = [];
  let pendingTokens = 0;

  const flushPending = () => {
    if (pending.length === 0) return;
    const merged = pending.map((unit) => unit.fullText).join('\n\n');
    const first = pending[0]!;
    const last = pending[pending.length - 1]!;
    chunks.push(
      makeChunk({
        index: index++,
        config,
        unit: first,
        text: merged,
        charStart: first.span[0],
        charEnd: last.span[1],
        isPartial: false,
        partIndex: 0,
        partTotal: 1,
        // Объединённые единицы перечисляются в ссылке, чтобы цитата
        // указывала на все включённые статьи, а не только на первую.
        coveredPaths: pending.map((unit) => unit.pathString),
      }),
    );
    pending = [];
    pendingTokens = 0;
  };

  for (const unit of candidates) {
    const tokens = approxTokenCount(unit.fullText);

    if (tokens > config.maxTokens) {
      flushPending();
      chunks.push(...splitLongUnit(unit, config, () => index++));
      continue;
    }

    if (tokens < config.minTokens) {
      pending.push(unit);
      pendingTokens += tokens;
      if (pendingTokens >= config.targetTokens) flushPending();
      continue;
    }

    flushPending();
    chunks.push(
      makeChunk({
        index: index++,
        config,
        unit,
        text: unit.fullText,
        charStart: unit.span[0],
        charEnd: unit.span[1],
        isPartial: false,
        partIndex: 0,
        partTotal: 1,
      }),
    );
  }

  flushPending();
  return chunks;
}

interface MakeChunkArgs {
  index: number;
  config: ChunkOptions & typeof DEFAULTS;
  unit: FlatUnit;
  text: string;
  charStart: number;
  charEnd: number;
  isPartial: boolean;
  partIndex: number;
  partTotal: number;
  coveredPaths?: string[];
}

function makeChunk(args: MakeChunkArgs): LegalChunk {
  const { config, unit } = args;
  const label = formatUnitLabel({
    kind: unit.kind,
    ...(unit.number ? { number: unit.number } : {}),
  });
  const parentPath = unitPathToString(unit.path.slice(0, -1));
  const citationShort = buildCitationShort(unit.pathString, config.act);
  const citationFull = buildCitationFull(unit.pathString, config.act);

  const header = [
    config.act?.title ? `Акт: ${config.act.title}` : '',
    config.act?.number ? `Реквизиты: ${config.act.number}` : '',
    `Расположение: ${citationShort}`,
    unit.heading ? `Заголовок: ${unit.heading}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const chunk: LegalChunk = {
    chunkIndex: args.index,
    docKind: config.docKind,
    kind: unit.kind,
    path: args.coveredPaths ? args.coveredPaths.join('+') : unit.pathString,
    label,
    text: args.text,
    embedInput: `${header}\n\n${args.text}`,
    citationShort,
    citationFull,
    charStart: args.charStart,
    charEnd: args.charEnd,
    isPartial: args.isPartial,
    partIndex: args.partIndex,
    partTotal: args.partTotal,
    approxTokens: approxTokenCount(args.text),
  };
  if (unit.heading) chunk.heading = unit.heading;
  if (parentPath) chunk.parentPath = parentPath;
  return chunk;
}

/** Делит слишком длинную единицу на части по абзацам с перекрытием. */
function splitLongUnit(
  unit: FlatUnit,
  config: ChunkOptions & typeof DEFAULTS,
  nextIndex: () => number,
): LegalChunk[] {
  const paragraphs = unit.fullText.split(/\n+/u).filter((line) => line.trim().length > 0);
  const parts: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const paragraph of paragraphs) {
    const tokens = approxTokenCount(paragraph);
    if (currentTokens + tokens > config.targetTokens && current.length > 0) {
      parts.push(current.join('\n'));
      // Перекрытие: последний абзац предыдущей части переносится в следующую,
      // чтобы условие, разорванное границей, не потерялось.
      const overlap: string[] = [];
      let overlapTokens = 0;
      for (let i = current.length - 1; i >= 0 && overlapTokens < config.overlapTokens; i -= 1) {
        overlap.unshift(current[i]!);
        overlapTokens += approxTokenCount(current[i]!);
      }
      current = [...overlap];
      currentTokens = overlapTokens;
    }
    current.push(paragraph);
    currentTokens += tokens;
  }
  if (current.length > 0) parts.push(current.join('\n'));

  return parts.map((text, partIndex) =>
    makeChunk({
      index: nextIndex(),
      config,
      unit,
      text,
      charStart: unit.span[0],
      charEnd: unit.span[1],
      isPartial: true,
      partIndex,
      partTotal: parts.length,
    }),
  );
}

/** Разбивает неструктурированный текст по абзацам. */
function chunkPlainText(text: string, config: ChunkOptions & typeof DEFAULTS): LegalChunk[] {
  const chunks: LegalChunk[] = [];
  const paragraphs: Array<{ text: string; start: number; end: number }> = [];

  let offset = 0;
  for (const raw of text.split(/\n{2,}/u)) {
    const start = text.indexOf(raw, offset);
    if (raw.trim().length > 0) {
      paragraphs.push({ text: raw.trim(), start, end: start + raw.length });
    }
    offset = start + raw.length;
  }

  let current: typeof paragraphs = [];
  let currentTokens = 0;
  let index = 0;

  const flush = () => {
    if (current.length === 0) return;
    const body = current.map((p) => p.text).join('\n\n');
    const start = current[0]!.start;
    const end = current[current.length - 1]!.end;
    const citation = config.act?.title ? `${config.act.title}` : 'Документ';
    chunks.push({
      chunkIndex: index++,
      docKind: config.docKind,
      kind: 'indent',
      path: `abz_${index}`,
      label: `Фрагмент ${index}`,
      text: body,
      embedInput: `Документ: ${citation}\n\n${body}`,
      citationShort: `${citation}, фрагмент ${index}`,
      citationFull: `${citation}, символы ${start}–${end}`,
      charStart: start,
      charEnd: end,
      isPartial: false,
      partIndex: 0,
      partTotal: 1,
      approxTokens: approxTokenCount(body),
    });
    current = [];
    currentTokens = 0;
  };

  for (const paragraph of paragraphs) {
    const tokens = approxTokenCount(paragraph.text);
    if (currentTokens + tokens > config.targetTokens && current.length > 0) flush();
    current.push(paragraph);
    currentTokens += tokens;
  }
  flush();

  return chunks;
}
