import { describe, expect, it } from 'vitest';
import {
  CORRUPTION_FACTORS,
  CORRUPTION_FACTOR_BY_CODE,
  findCorruptionMarkers,
} from '../src/expertise/anticorruption.js';

describe('перечень коррупциогенных факторов', () => {
  it('содержит все двенадцать факторов методики', () => {
    expect(CORRUPTION_FACTORS).toHaveLength(12);
    expect(CORRUPTION_FACTORS.filter((f) => f.group === 'discretion')).toHaveLength(9);
    expect(CORRUPTION_FACTORS.filter((f) => f.group === 'requirements')).toHaveLength(3);
  });

  it('коды факторов уникальны и индексируются', () => {
    const codes = CORRUPTION_FACTORS.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(CORRUPTION_FACTOR_BY_CODE.get('discretion.b')?.name).toContain('вправе');
  });

  it('у каждого фактора есть определение и проверочный вопрос', () => {
    for (const factor of CORRUPTION_FACTORS) {
      expect(factor.definition.length, factor.code).toBeGreaterThan(20);
      expect(factor.checkQuestion.length, factor.code).toBeGreaterThan(20);
      expect(factor.clause, factor.code).toMatch(/пункта [34]/u);
    }
  });
});

describe('findCorruptionMarkers', () => {
  it('находит формулу «вправе»', () => {
    const hits = findCorruptionMarkers(
      'Уполномоченный орган вправе принять решение о предоставлении субсидии.',
    );
    expect(hits.some((h) => h.factorCode === 'discretion.b' && h.marker === 'вправе')).toBe(true);
  });

  it('находит оценочные категории', () => {
    const hits = findCorruptionMarkers('Заявление рассматривается в разумный срок.');
    const codes = hits.map((h) => h.factorCode);
    expect(codes).toContain('discretion.a');
    expect(codes).toContain('requirements.c');
  });

  it('находит открытый перечень документов', () => {
    const hits = findCorruptionMarkers(
      'Заявитель представляет заявление, паспорт и иные документы по требованию уполномоченного органа.',
    );
    expect(hits.filter((h) => h.factorCode === 'requirements.a').length).toBeGreaterThanOrEqual(2);
  });

  it('не зависит от регистра и буквы «ё»', () => {
    expect(findCorruptionMarkers('ВПРАВЕ').length).toBeGreaterThan(0);
  });

  it('возвращает позиции и контекст', () => {
    const text = 'Норма первая. Орган вправе отказать. Норма третья.';
    const hit = findCorruptionMarkers(text).find((h) => h.marker === 'вправе')!;
    expect(text.slice(hit.span[0], hit.span[1])).toBe('вправе');
    expect(hit.context).toContain('Орган вправе отказать');
  });

  it('на нейтральном тексте ничего не находит', () => {
    expect(findCorruptionMarkers('Закон вступает в силу с 1 января 2027 года.')).toEqual([]);
  });

  it('возвращает совпадения в порядке появления в тексте', () => {
    const hits = findCorruptionMarkers('иные документы, затем вправе, затем существенный');
    const positions = hits.map((h) => h.span[0]);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
