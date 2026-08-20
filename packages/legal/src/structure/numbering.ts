/**
 * Правила нумерации структурных единиц при внесении изменений.
 *
 * Ключевое правило юридической техники: **менять существующую нумерацию
 * недопустимо**. Все ссылки на статью 15 в других актах указывают именно
 * на статью 15; перенумеровав её в 16, законодатель разом сделает неверными
 * все эти ссылки. Поэтому новая единица, вставляемая между существующими,
 * получает дробный номер: между статьями 15 и 16 появляется статья 15.1.
 *
 * Отсюда следует, что автоматическая перенумерация документа при вставке —
 * не удобство, а ошибка, и здесь её нет.
 */

/** Разбирает номер вида «15.1» в набор чисел. Возвращает `null`, если номер не числовой. */
export function parseNumber(value: string): number[] | null {
  const parts = value.trim().split('.');
  const numbers = parts.map((part) => Number(part));
  if (numbers.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return numbers;
}

/** Сравнивает номера по правилам нумерации: 15 < 15.1 < 15.2 < 16. */
export function compareNumbers(a: string, b: string): number {
  const left = parseNumber(a);
  const right = parseNumber(b);
  if (!left || !right) return a.localeCompare(b, 'ru');

  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Предлагает номер для единицы, вставляемой после `previous` и перед `next`.
 *
 * @example nextNumberBetween(undefined, undefined) // '1'   — первая единица
 * @example nextNumberBetween('15', undefined)      // '16'  — в конец перечня
 * @example nextNumberBetween('15', '16')           // '15.1' — между
 * @example nextNumberBetween('15.1', '16')         // '15.2' — рядом со вставленной
 * @example nextNumberBetween('15.1', '15.2')       // '15.1.1' — глубже
 */
export function nextNumberBetween(
  previous?: string | null,
  next?: string | null,
): string {
  if (!previous) {
    // Вставка в начало: перед существующей первой единицей поставить
    // номер меньше единицы нельзя, поэтому это допустимо только тогда,
    // когда перечень пуст.
    return next ? `${next}.0` : '1';
  }

  const previousParts = parseNumber(previous);
  if (!previousParts) return `${previous}.1`;

  const increment = (parts: number[]): string => {
    const head = parts.slice(0, -1);
    const tail = parts[parts.length - 1] ?? 0;
    return [...head, tail + 1].join('.');
  };

  // В конец перечня — обычный следующий номер того же уровня.
  if (!next) return increment(previousParts);

  const nextParts = parseNumber(next);
  if (!nextParts) return `${previous}.1`;

  // Если увеличение последнего разряда всё ещё меньше следующего номера —
  // берём его: «15.1» между «15.1» и «16» становится «15.2».
  const incremented = increment(previousParts);
  if (compareNumbers(incremented, next) < 0) return incremented;

  // Иначе уходим на уровень глубже: между «15» и «16» — «15.1»,
  // между «15.1» и «15.2» — «15.1.1».
  return `${previous}.1`;
}

/**
 * Проверяет, что перечень номеров упорядочен и не содержит повторов.
 * Нарушение означает ошибку в тексте проекта, а не в редакторе.
 */
export function validateNumbering(numbers: readonly string[]): {
  valid: boolean;
  problems: string[];
} {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < numbers.length; i += 1) {
    const current = numbers[i]!;
    if (seen.has(current)) problems.push(`Номер «${current}» встречается дважды`);
    seen.add(current);

    const previous = numbers[i - 1];
    if (previous && compareNumbers(previous, current) >= 0) {
      problems.push(`Номер «${current}» стоит после «${previous}», но не больше него`);
    }
  }

  return { valid: problems.length === 0, problems };
}
