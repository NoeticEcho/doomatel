import { describe, expect, it } from 'vitest';
import { formatRussianDate, parseRussianDate } from '../src/references/dates.js';

describe('parseRussianDate', () => {
  it('разбирает числовую форму', () => {
    expect(parseRussianDate('27.07.2006')).toBe('2006-07-27');
    expect(parseRussianDate('1.1.2020')).toBe('2020-01-01');
  });

  it('разбирает словесную форму', () => {
    expect(parseRussianDate('27 июля 2006 года')).toBe('2006-07-27');
    expect(parseRussianDate('8 марта 2015')).toBe('2015-03-08');
    expect(parseRussianDate('1 мая 1999 г.')).toBe('1999-05-01');
  });

  it('разбирает ISO', () => {
    expect(parseRussianDate('2006-07-27')).toBe('2006-07-27');
  });

  it('отвергает несуществующие даты', () => {
    expect(parseRussianDate('31.02.2020')).toBeUndefined();
    expect(parseRussianDate('не дата')).toBeUndefined();
  });

  it('форматирует обратно', () => {
    expect(formatRussianDate('2006-07-27')).toBe('27 июля 2006 года');
    expect(formatRussianDate('2015-03-08')).toBe('8 марта 2015 года');
  });
});
