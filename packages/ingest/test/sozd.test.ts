import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  billCardUrl,
  downloadUrl,
  extensionFromContentDisposition,
  formatFromIconClass,
  parseBillCard,
  toIsoDate,
} from '../src/sozd/bill-card.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'sozd');
const synthetic = readFileSync(join(FIXTURES, 'bill-card.synthetic.html'), 'utf8');

describe('вспомогательные функции разбора СОЗД', () => {
  it('приводит дату к ISO', () => {
    expect(toIsoDate('23.06.2022 Текст внесенного законопроекта')).toBe('2022-06-23');
    expect(toIsoDate('без даты')).toBeUndefined();
    expect(toIsoDate(undefined)).toBeUndefined();
  });

  it('определяет формат по CSS-классу иконки', () => {
    expect(formatFromIconClass('ic_file ic_file-docx')).toBe('docx');
    expect(formatFromIconClass('ic_file ic_file-pdf')).toBe('pdf');
    expect(formatFromIconClass('ic_file')).toBe('unknown');
    expect(formatFromIconClass(undefined)).toBe('unknown');
  });

  it('извлекает расширение из Content-Disposition', () => {
    expect(extensionFromContentDisposition('attachment; filename="текст.docx"')).toBe('docx');
    expect(extensionFromContentDisposition("attachment; filename*=UTF-8''%D0%B0.pdf")).toBe('pdf');
    expect(extensionFromContentDisposition(undefined)).toBeUndefined();
  });

  it('строит адреса карточки и скачивания', () => {
    expect(billCardUrl('149922-8')).toBe('https://sozd.duma.gov.ru/bill/149922-8');
    expect(downloadUrl('ABC-123')).toBe('https://sozd.duma.gov.ru/download/ABC-123');
  });
});

describe('parseBillCard (синтетическая фикстура)', () => {
  const card = parseBillCard(synthetic);

  it('извлекает основные реквизиты', () => {
    expect(card.number).toBe('149922-8');
    expect(card.convocation).toBe(8);
    expect(card.status).toBe('Рассмотрение завершено');
    expect(card.name).toContain('Об образовании в Российской Федерации');
  });

  it('извлекает паспорт законопроекта', () => {
    expect(card.passport.initiator).toBe('Правительство Российской Федерации');
    expect(card.passport.lawForm).toBe('Федеральный закон');
    expect(card.passport.responsibleCommittee).toContain('науке и высшему образованию');
    expect(card.passport.profileCommittee).toContain('просвещению');
    expect(card.passport.amendmentDeadline).toBe('15.09.2022');
  });

  it('сохраняет незнакомые поля паспорта, а не теряет их', () => {
    expect(card.passport.extra['Неизвестное новое поле']).toBe('Значение нового поля');
  });

  it('извлекает хронологию рассмотрения', () => {
    expect(card.events.map((e) => e.eventNum)).toEqual(['1.1', '8.1', '11.1']);
    const first = card.events[0]!;
    expect(first.title).toContain('Внесение законопроекта');
    expect(first.date).toBe('2022-06-23');
    const firstReading = card.events[1]!;
    expect(firstReading.solution).toBe('Принять законопроект в первом чтении');
  });

  it('привязывает документы к событиям и определяет их формат', () => {
    const introduction = card.events[0]!;
    expect(introduction.attachments).toHaveLength(2);
    expect(introduction.attachments[0]!.name).toBe('Текст внесенного законопроекта');
    expect(introduction.attachments[0]!.format).toBe('docx');
    expect(introduction.attachments[0]!.guid).toBe('9E5B1F00-1111-4A2B-9C3D-000000000001');
    expect(introduction.attachments[0]!.url).toBe(
      'https://sozd.duma.gov.ru/download/9E5B1F00-1111-4A2B-9C3D-000000000001',
    );
    expect(introduction.attachments[1]!.format).toBe('pdf');
  });

  it('собирает полный список вложений карточки', () => {
    expect(card.attachments).toHaveLength(3);
    expect(card.attachments.map((a) => a.format)).toEqual(['docx', 'pdf', 'rtf']);
  });

  it('не выдаёт предупреждений на корректной карточке', () => {
    expect(card.warnings).toEqual([]);
  });
});

describe('parseBillCard (устойчивость)', () => {
  it('не падает на пустом документе, а сообщает о проблемах', () => {
    const card = parseBillCard('<html><body></body></html>');
    expect(card.number).toBeUndefined();
    expect(card.warnings.length).toBeGreaterThan(0);
    expect(card.warnings.join(' ')).toContain('номер законопроекта');
  });

  it('не падает на карточке без хронологии', () => {
    const card = parseBillCard('<html><body><span id="number_oz_id">1-9</span></body></html>');
    expect(card.number).toBe('1-9');
    expect(card.convocation).toBe(9);
    expect(card.events).toEqual([]);
  });
});

/**
 * Проверка на настоящих снимках страниц. Пропускается, пока фикстуры
 * не сняты из среды с доступом к СОЗД (см. fixtures/sozd/README.md).
 */
describe('parseBillCard (реальные фикстуры)', () => {
  const realFixtures = readdirSync(FIXTURES).filter((file) => file.endsWith('.json'));

  it.skipIf(realFixtures.length === 0)('разбирает реальные карточки без предупреждений', () => {
    for (const file of realFixtures) {
      const stored = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as {
        response: { body: string };
      };
      const card = parseBillCard(stored.response.body);
      expect(card.number, `фикстура ${file}`).toBeDefined();
      expect(card.name, `фикстура ${file}`).toBeDefined();
      expect(card.events.length, `фикстура ${file}`).toBeGreaterThan(0);
    }
  });
});
