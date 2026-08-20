import { describe, expect, it } from 'vitest';
import {
  compareNumbers,
  nextNumberBetween,
  parseNumber,
  validateNumbering,
} from '../src/structure/numbering.js';

describe('сравнение номеров', () => {
  it('дробный номер стоит между целыми', () => {
    expect(compareNumbers('15', '15.1')).toBeLessThan(0);
    expect(compareNumbers('15.1', '16')).toBeLessThan(0);
  });

  it('сравнивает поразрядно, а не как строки', () => {
    // Как строки «10» < «9»; как номера — наоборот.
    expect(compareNumbers('9', '10')).toBeLessThan(0);
    expect(compareNumbers('15.10', '15.9')).toBeGreaterThan(0);
  });

  it('равные номера равны', () => {
    expect(compareNumbers('15.1', '15.1')).toBe(0);
  });

  it('нечисловые номера сравниваются как строки', () => {
    expect(compareNumbers('а', 'б')).toBeLessThan(0);
  });
});

describe('parseNumber', () => {
  it('разбирает составной номер', () => {
    expect(parseNumber('15.1')).toEqual([15, 1]);
  });

  it('отвергает нечисловой номер', () => {
    expect(parseNumber('а')).toBeNull();
    expect(parseNumber('15.а')).toBeNull();
  });
});

describe('нумерация вставляемых единиц', () => {
  it('первая единица получает номер 1', () => {
    expect(nextNumberBetween(undefined, undefined)).toBe('1');
  });

  it('в конец перечня — следующий номер', () => {
    expect(nextNumberBetween('15', undefined)).toBe('16');
  });

  it('между существующими — дробный номер', () => {
    // Перенумеровывать статью 16 в 17 недопустимо: все ссылки на неё
    // в других актах перестали бы указывать туда, куда указывали.
    expect(nextNumberBetween('15', '16')).toBe('15.1');
  });

  it('рядом с ранее вставленной — следующий дробный', () => {
    expect(nextNumberBetween('15.1', '16')).toBe('15.2');
  });

  it('между двумя дробными — уровнем глубже', () => {
    expect(nextNumberBetween('15.1', '15.2')).toBe('15.1.1');
  });

  it('предложенный номер всегда строго между соседями', () => {
    const cases: Array<[string, string]> = [
      ['15', '16'],
      ['15.1', '16'],
      ['15.1', '15.2'],
      ['1', '2'],
      ['9', '10'],
      ['15.1.1', '15.2'],
    ];
    for (const [previous, next] of cases) {
      const proposed = nextNumberBetween(previous, next);
      expect(compareNumbers(previous, proposed), `${previous} < ${proposed}`).toBeLessThan(0);
      expect(compareNumbers(proposed, next), `${proposed} < ${next}`).toBeLessThan(0);
    }
  });

  it('не перенумеровывает существующие единицы', () => {
    // Свойство сформулировано явно: функция возвращает номер новой единицы
    // и не может ничего сообщить об изменении соседних.
    const proposed = nextNumberBetween('15', '16');
    expect(proposed).not.toBe('16');
  });
});

describe('проверка нумерации перечня', () => {
  it('корректный перечень принимается', () => {
    expect(validateNumbering(['1', '2', '2.1', '3']).valid).toBe(true);
  });

  it('находит повтор номера', () => {
    const result = validateNumbering(['1', '2', '2']);
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toContain('дважды');
  });

  it('находит нарушение порядка', () => {
    const result = validateNumbering(['1', '3', '2']);
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toContain('не больше него');
  });
});
