import snowball from 'snowball-stemmers';

/**
 * Лексический слой для русских правовых текстов.
 *
 * Зачем он нужен: чисто векторный поиск систематически промахивается по
 * точным реквизитам — «149-ФЗ», «статья 15.1», «части 3». Для законотворчества
 * это неприемлемо: депутат ищет конкретную норму, а не «что-то похожее».
 * Поэтому лексическая ветвь поиска обязательна, а не опциональна.
 *
 * Реализовано: нормализация, токенизация с сохранением реквизитов,
 * стемминг Snowball и разрежённые векторы BM25 для гибридного поиска Qdrant.
 */

// Пакет опубликован в формате CommonJS. Импорт по умолчанию работает
// и в ESM-, и в CommonJS-сборке пакета; `createRequire(import.meta.url)`
// в CommonJS-сборке недоступен, поэтому здесь его использовать нельзя.
const { newStemmer } = snowball as unknown as {
  newStemmer: (language: string) => { stem: (word: string) => string };
};

const stemmer = newStemmer('russian');

/**
 * Стоп-слова.
 *
 * Помимо общеязыковых, исключены служебные слова юридических текстов:
 * «статья», «пункт», «часть» встречаются почти в каждом документе корпуса
 * и не несут различающей силы. Сами **номера** при этом сохраняются —
 * именно они и различают нормы.
 */
export const RUSSIAN_STOPWORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она',
  'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее',
  'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда',
  'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до',
  'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей',
  'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем',
  'была', 'сам', 'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет',
  'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним',
  'здесь', 'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'были', 'куда', 'зачем',
  'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об', 'другой', 'хоть', 'после',
  'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них', 'какая', 'много',
  'разве', 'три', 'эту', 'моя', 'впрочем', 'свою', 'этой', 'перед', 'иногда', 'лучше',
  'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно', 'всю', 'между',
  // Служебная лексика правовых актов.
  'статья', 'статьи', 'статье', 'статью', 'статьей', 'статьёй', 'статей', 'статьям',
  'пункт', 'пункта', 'пункту', 'пунктом', 'пункте', 'пункты', 'пунктов',
  'подпункт', 'подпункта', 'подпункте', 'подпунктом',
  'часть', 'части', 'частью', 'частей', 'частям',
  'абзац', 'абзаца', 'абзацем', 'абзацы',
  'глава', 'главы', 'главе', 'главой',
  'раздел', 'раздела', 'разделе',
  'настоящий', 'настоящего', 'настоящему', 'настоящим', 'настоящем', 'настоящая',
  'настоящей', 'настоящую',
  'соответствии', 'соответствие', 'также', 'иные', 'иных', 'иным',
]);

/** Токен с информацией, нужной для взвешивания. */
export interface LexToken {
  /** Нормализованная форма, попадающая в индекс. */
  term: string;
  /** Исходная подстрока. */
  raw: string;
  /** Позиция в тексте: [start, end). */
  span: [number, number];
  /**
   * Реквизит: номер акта, номер структурной единицы, дата.
   * Такие токены не стеммируются и не отбрасываются как стоп-слова.
   */
  isRequisite: boolean;
}

// Номера актов: «149-ФЗ», «1-ФКЗ», «195-фз».
// Выражение привязано к границам токена: `\b` здесь неприменим, так как
// это ASCII-граница слова и после кириллической буквы не срабатывает.
const ACT_NUMBER_RE = /^\d+[-–—]?[А-ЯЁа-яё]{2,4}$/u;
// Номера структурных единиц и дат: «15.1», «27.07.2006», «2006».
const NUMERIC_RE = /^\d+(?:[.\-–/]\d+)*$/u;

/**
 * Разбивает текст на токены.
 *
 * Реквизиты («149-ФЗ», «15.1») сохраняются целиком: разрезание их на части
 * лишило бы поиск возможности найти норму по точной ссылке.
 */
export function tokenize(text: string): LexToken[] {
  const tokens: LexToken[] = [];
  const wordRe = /[\p{L}\p{N}][\p{L}\p{N}.\-–—/]*/gu;
  let match: RegExpExecArray | null;

  while ((match = wordRe.exec(text)) !== null) {
    const raw = match[0].replace(/[.\-–—/]+$/u, '');
    if (!raw) continue;
    const lower = raw.toLowerCase().replace(/ё/gu, 'е');
    const span: [number, number] = [match.index, match.index + raw.length];

    if (ACT_NUMBER_RE.test(raw) || NUMERIC_RE.test(lower)) {
      tokens.push({ term: normalizeRequisite(lower), raw, span, isRequisite: true });
      continue;
    }

    if (lower.length < 2 || RUSSIAN_STOPWORDS.has(lower)) continue;
    tokens.push({ term: stemmer.stem(lower), raw, span, isRequisite: false });
  }

  return tokens;
}

/** Приводит реквизит к канонической форме: «149-фз», «15.1». */
export function normalizeRequisite(value: string): string {
  return value
    .replace(/ф3/gu, 'фз') // частая опечатка: цифра «3» вместо буквы «з»
    .replace(/[–—]/gu, '-')
    .replace(/\s+/gu, '');
}

/** Возвращает только термы — удобно для тестов и отладки. */
export function terms(text: string): string[] {
  return tokenize(text).map((token) => token.term);
}

/**
 * Разрежённый вектор в формате Qdrant: параллельные массивы индексов и весов.
 */
export interface SparseVector {
  indices: number[];
  values: number[];
}

/**
 * Хеширование терма в индекс разрежённого вектора.
 *
 * Используется хеш-трюк вместо словаря: словарь пришлось бы синхронно
 * поддерживать между сервисом индексации и сервисом поиска, а при дообучении
 * корпуса — перестраивать. Хеш стабилен и не требует состояния.
 * Коллизии при 2^31 корзинах на корпусе в 10^7 чанков практически не влияют
 * на ранжирование.
 */
export function hashTerm(term: string): number {
  // FNV-1a, 32 бита; старший бит сбрасывается, так как Qdrant ожидает uint32.
  let hash = 0x811c9dc5;
  for (let i = 0; i < term.length; i += 1) {
    hash ^= term.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 0x7fffffff;
}

export interface Bm25Options {
  /** Насыщение по частоте терма. */
  k1?: number;
  /** Влияние длины документа. */
  b?: number;
  /** Средняя длина документа в корпусе, в токенах. */
  avgDocLength?: number;
  /**
   * Множитель веса для реквизитов. Точное совпадение номера акта или статьи
   * должно доминировать над лексическим сходством остального текста.
   */
  requisiteBoost?: number;
}

const DEFAULTS: Required<Bm25Options> = {
  k1: 1.2,
  b: 0.75,
  avgDocLength: 220,
  requisiteBoost: 3,
};

/**
 * Строит разрежённый вектор документа для гибридного поиска.
 *
 * Обратная документная частота (IDF) здесь не вычисляется: коллекция Qdrant
 * создаётся с `modifier: "idf"`, и сервер применяет IDF сам, опираясь на
 * статистику всего корпуса. Клиент передаёт только насыщенную частоту терма.
 */
export function encodeDocument(text: string, options: Bm25Options = {}): SparseVector {
  const { k1, b, avgDocLength, requisiteBoost } = { ...DEFAULTS, ...options };
  const tokens = tokenize(text);
  if (tokens.length === 0) return { indices: [], values: [] };

  const counts = new Map<string, { count: number; isRequisite: boolean }>();
  for (const token of tokens) {
    const entry = counts.get(token.term);
    if (entry) entry.count += 1;
    else counts.set(token.term, { count: 1, isRequisite: token.isRequisite });
  }

  const lengthNorm = 1 - b + (b * tokens.length) / avgDocLength;
  const indices: number[] = [];
  const values: number[] = [];

  for (const [term, { count, isRequisite }] of counts) {
    const saturated = (count * (k1 + 1)) / (count + k1 * lengthNorm);
    indices.push(hashTerm(term));
    values.push(isRequisite ? saturated * requisiteBoost : saturated);
  }

  return { indices, values };
}

/**
 * Строит разрежённый вектор запроса.
 *
 * У запроса нет длины документа, поэтому насыщение по частоте не применяется:
 * вес терма равен единице (или множителю для реквизита).
 */
export function encodeQuery(text: string, options: Bm25Options = {}): SparseVector {
  const requisiteBoost = options.requisiteBoost ?? DEFAULTS.requisiteBoost;
  const tokens = tokenize(text);
  const weights = new Map<number, number>();

  for (const token of tokens) {
    const index = hashTerm(token.term);
    const weight = token.isRequisite ? requisiteBoost : 1;
    weights.set(index, Math.max(weights.get(index) ?? 0, weight));
  }

  return {
    indices: [...weights.keys()],
    values: [...weights.values()],
  };
}

/** Извлекает из запроса реквизиты — для точной ветви поиска по цитате. */
export function extractRequisites(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((token) => token.isRequisite)
        .map((token) => token.term),
    ),
  ];
}
