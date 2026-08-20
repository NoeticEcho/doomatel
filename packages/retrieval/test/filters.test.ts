import { describe, expect, it } from 'vitest';
import { applyAccessScope, searchFilterSchema, toQdrantFilter } from '../src/filters/dsl.js';

describe('язык фильтров', () => {
  it('отвергает неизвестные поля', () => {
    // Схема строгая намеренно: агент, придумавший поле, должен получить
    // ошибку, а не молча получить нефильтрованную выдачу.
    expect(() => searchFilterSchema.parse({ придуманноеПоле: 1 })).toThrow();
  });

  it('переводит перечисления в условие any', () => {
    const filter = toQdrantFilter({ docKinds: ['law', 'code'] });
    expect(filter?.must).toContainEqual({ key: 'doc_kind', match: { any: ['law', 'code'] } });
  });

  it('переводит дату действия в двустороннее условие', () => {
    const filter = toQdrantFilter({ inForceOn: '2026-01-01' });
    expect(filter?.must).toContainEqual({ key: 'valid_from', range: { lte: '2026-01-01' } });
    expect(filter?.must).toContainEqual({ key: 'valid_to', range: { gt: '2026-01-01' } });
  });

  it('переводит диапазон дат принятия', () => {
    const filter = toQdrantFilter({ actDateFrom: '2020-01-01', actDateTo: '2021-01-01' });
    expect(filter?.must).toContainEqual({
      key: 'act_date',
      range: { gte: '2020-01-01', lte: '2021-01-01' },
    });
  });

  it('пустой фильтр не превращается в пустой объект', () => {
    // Qdrant отвергает фильтр без условий.
    expect(toQdrantFilter({})).toBeUndefined();
  });
});

describe('ограничение прав доступа', () => {
  const scope = { userId: 'u1', projectIds: ['p1', 'p2'], tenantIds: ['fraction-a'] };

  it('добавляет условие доступа даже к пустому фильтру', () => {
    const filter = applyAccessScope(undefined, scope);
    expect(filter.must).toHaveLength(1);
    const access = filter.must![0] as { should: unknown[] };
    expect(access.should).toContainEqual({ key: 'visibility', match: { value: 'public' } });
    expect(access.should).toContainEqual({ key: 'owner_user_id', match: { value: 'u1' } });
    expect(access.should).toContainEqual({ key: 'project_id', match: { any: ['p1', 'p2'] } });
  });

  it('сохраняет исходные условия и добавляет своё', () => {
    const base = toQdrantFilter({ docKinds: ['law'] });
    const filter = applyAccessScope(base, scope);
    expect(filter.must).toHaveLength(2);
    expect(filter.must![0]).toEqual({ key: 'doc_kind', match: { any: ['law'] } });
  });

  it('пользователь без проектов видит только публичное и своё', () => {
    const filter = applyAccessScope(undefined, { userId: 'u2', projectIds: [], tenantIds: [] });
    const access = filter.must![0] as { should: unknown[] };
    expect(access.should).toHaveLength(2);
  });
});
