import { describe, expect, it } from 'vitest';
import {
  SOLUTION_DICTIONARY,
  hasSolution,
  parseSolutions,
} from '../src/duma-api/solutions.js';

describe('разбор поля решений', () => {
  it('коды словаря уникальны', () => {
    const codes = SOLUTION_DICTIONARY.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('разбивает составное решение на атомарные', () => {
    const result = parseSolutions(
      'принять законопроект в первом чтении; представить поправки к законопроекту',
    );
    expect(result.matched.map((entry) => entry.code)).toEqual([
      'adopted_first_reading',
      'submit_amendments',
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it('порядок перечисления не влияет на ключ события', () => {
    // Источник не гарантирует порядок, поэтому сравнение строки целиком
    // считало бы одно и то же событие двумя разными.
    const a = parseSolutions('принять законопроект в первом чтении; представить поправки к законопроекту');
    const b = parseSolutions('представить поправки к законопроекту; принять законопроект в первом чтении');
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe('');
  });

  it('не зависит от регистра, буквы «ё» и лишних пробелов', () => {
    expect(parseSolutions('НАЗНАЧИТЬ   ОТВЕТСТВЕННЫЙ КОМИТЕТ').matched[0]?.code).toBe(
      'assign_responsible_committee',
    );
  });

  it('нераспознанное решение не теряется, а возвращается отдельно', () => {
    // Молчаливая потеря нового вида решения означала бы, что часть
    // хронологии перестала отображаться и никто этого не заметил.
    const result = parseSolutions('назначить ответственный комитет; совершенно новое решение');
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toEqual(['совершенно новое решение']);
    expect(result.key).toContain('?совершенно новое решение');
  });

  it('пустое поле даёт пустой результат', () => {
    expect(parseSolutions(null).key).toBe('');
    expect(parseSolutions('   ').matched).toEqual([]);
  });

  it('проверка наличия решения по коду', () => {
    expect(hasSolution('закон подписан', 'signed_by_president')).toBe(true);
    expect(hasSolution('отклонить законопроект', 'signed_by_president')).toBe(false);
  });

  it('распознаёт признак обязательности рассмотрения Советом Федерации', () => {
    expect(
      hasSolution('рассмотрение закона Советом Федерации является обязательным', 'council_review_mandatory'),
    ).toBe(true);
    // Отрицание — отдельное решение, а не то же самое с «не».
    expect(
      hasSolution('рассмотрение закона Советом Федерации не является обязательным', 'council_review_mandatory'),
    ).toBe(false);
  });
});
