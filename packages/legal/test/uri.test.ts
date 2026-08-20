import { describe, expect, it } from 'vitest';
import {
  actUri,
  expressionUri,
  normalizeActNumber,
  normalizeUnitNumber,
  parseBillNumber,
  parseUri,
  unitPathFromString,
  unitPathToString,
  unitUri,
} from '../src/identifiers/uri.js';

describe('идентификаторы актов', () => {
  const fz149 = { type: 'federal-law' as const, date: '2006-07-27', number: '149-ФЗ' };

  it('строит идентификатор уровня Work', () => {
    expect(actUri(fz149)).toBe('eli:rf:federal-law:2006-07-27:149-fz');
  });

  it('строит идентификатор редакции', () => {
    expect(expressionUri(fz149, '2024-08-08')).toBe(
      'eli:rf:federal-law:2006-07-27:149-fz@2024-08-08',
    );
  });

  it('строит идентификатор структурной единицы', () => {
    const uri = unitUri(
      fz149,
      [
        { kind: 'article', number: '15' },
        { kind: 'clause', number: '3' },
        { kind: 'item', number: '2' },
      ],
      '2024-08-08',
    );
    expect(uri).toBe('eli:rf:federal-law:2006-07-27:149-fz@2024-08-08#st_15/p_3/i_2');
  });

  it('разбирает идентификатор обратно', () => {
    const parsed = parseUri('eli:rf:federal-law:2006-07-27:149-fz@2024-08-08#st_15/p_3');
    expect(parsed.type).toBe('federal-law');
    expect(parsed.date).toBe('2006-07-27');
    expect(parsed.number).toBe('149-fz');
    expect(parsed.asOf).toBe('2024-08-08');
    expect(parsed.path).toEqual([
      { kind: 'article', number: '15' },
      { kind: 'clause', number: '3' },
    ]);
  });

  it('нормализует номера актов', () => {
    expect(normalizeActNumber('149-ФЗ')).toBe('149-fz');
    expect(normalizeActNumber('№ 1-ФКЗ')).toBe('1-fkz');
    expect(normalizeActNumber('511')).toBe('511');
  });

  it('нормализует номера структурных единиц с надстрочными знаками', () => {
    expect(normalizeUnitNumber('15¹')).toBe('15.1');
    expect(normalizeUnitNumber('15.1')).toBe('15.1');
    expect(normalizeUnitNumber('2-1')).toBe('2-1');
  });

  it('сериализует и разбирает путь', () => {
    const path = [
      { kind: 'chapter' as const, number: 'IV' },
      { kind: 'article' as const, number: '15' },
    ];
    const serialized = unitPathToString(path);
    expect(serialized).toBe('ch_iv/st_15');
    expect(unitPathFromString(serialized)).toEqual([
      { kind: 'chapter', number: 'iv' },
      { kind: 'article', number: '15' },
    ]);
  });

  it('разбирает номер законопроекта', () => {
    expect(parseBillNumber('1234567-8')).toEqual({ serial: '1234567', convocation: 8 });
    expect(() => parseBillNumber('плохой')).toThrow();
  });
});
