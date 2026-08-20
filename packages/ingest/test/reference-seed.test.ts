import { describe, expect, it } from 'vitest';
import {
  PHASE_SEED,
  STAGE_SEED,
  eventKey,
  normalizePhaseName,
  readingNumber,
} from '../src/duma-api/reference-seed.js';

describe('справочник стадий и фаз', () => {
  it('идентификаторы стадий уникальны', () => {
    const ids = STAGE_SEED.map((stage) => stage.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('каждая фаза относится к известной стадии', () => {
    const stageIds = new Set(STAGE_SEED.map((stage) => stage.id));
    for (const phase of PHASE_SEED) {
      expect(stageIds.has(phase.stageId), `фаза ${phase.id}`).toBe(true);
    }
  });

  it('наименования фаз НЕ уникальны — это свойство источника, а не ошибка', () => {
    // Три чтения имеют одинаковое название фазы. Тест закрепляет факт:
    // если он однажды перестанет выполняться, значит источник изменился,
    // и сопоставление событий нужно пересмотреть осознанно.
    const names = PHASE_SEED.map((phase) => normalizePhaseName(phase.name));
    expect(new Set(names).size).toBeLessThan(names.length);

    const duplicated = names.filter(
      (name) => names.filter((other) => other === name).length > 1,
    );
    expect(duplicated[0]).toContain('рассмотрение законопроекта государственной думой');
  });

  it('пара «стадия и фаза» различает три чтения', () => {
    expect(readingNumber(3, 8)).toBe(1);
    expect(readingNumber(4, 11)).toBe(2);
    expect(readingNumber(5, 14)).toBe(3);
    expect(readingNumber(1, 1)).toBeUndefined();
  });

  it('ключ события строится из пары идентификаторов', () => {
    expect(eventKey(3, 8)).toBe('3.8');
    expect(eventKey(null, undefined)).toBe('null.null');
  });

  it('нормализация убирает двойные пробелы и точки источника', () => {
    expect(normalizePhaseName('Принятие  решения о представлении.')).toBe(
      'принятие решения о представлении',
    );
  });
});
