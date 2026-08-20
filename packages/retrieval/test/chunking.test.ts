import { describe, expect, it } from 'vitest';
import {
  approxTokenCount,
  buildCitationFull,
  buildCitationShort,
  chunkAct,
} from '../src/chunking/legal-chunker.js';

const ACT = {
  type: 'federal-law' as const,
  number: '149-ФЗ',
  date: '2006-07-27',
  title: 'Об информации, информационных технологиях и о защите информации',
};

const LAW_TEXT = `РОССИЙСКАЯ ФЕДЕРАЦИЯ

ФЕДЕРАЛЬНЫЙ ЗАКОН

Об информации, информационных технологиях и о защите информации

Глава 1. Общие положения

Статья 1. Сфера действия настоящего Федерального закона

1. Настоящий Федеральный закон регулирует отношения, возникающие при осуществлении права на поиск, получение, передачу, производство и распространение информации, а также при применении информационных технологий и обеспечении защиты информации.
2. Положения настоящего Федерального закона не распространяются на отношения, возникающие при правовой охране результатов интеллектуальной деятельности и приравненных к ним средств индивидуализации.

Статья 2. Основные понятия, используемые в настоящем Федеральном законе

В настоящем Федеральном законе используются следующие основные понятия:
1) информация — сведения (сообщения, данные) независимо от формы их представления;
2) информационные технологии — процессы, методы поиска, сбора, хранения, обработки, предоставления, распространения информации и способы осуществления таких процессов и методов;
3) информационная система — совокупность содержащейся в базах данных информации и обеспечивающих её обработку информационных технологий и технических средств.

Статья 3. Краткая

Текст.

Статья 4. Тоже краткая

Текст.
`;

describe('chunkAct', () => {
  const chunks = chunkAct(LAW_TEXT, { act: ACT, docKind: 'law' });

  it('режет по границам статей, а не по окну фиксированной длины', () => {
    const paths = chunks.map((chunk) => chunk.path);
    expect(paths.some((path) => path.includes('st_1'))).toBe(true);
    expect(paths.some((path) => path.includes('st_2'))).toBe(true);
  });

  it('фрагмент статьи содержит все её части', () => {
    const article1 = chunks.find((chunk) => chunk.path === 'ch_1/st_1')!;
    expect(article1.text).toContain('регулирует отношения');
    expect(article1.text).toContain('не распространяются');
  });

  it('готовит короткую и полную ссылку заранее', () => {
    const article1 = chunks.find((chunk) => chunk.path === 'ch_1/st_1')!;
    expect(article1.citationShort).toContain('ст. 1');
    expect(article1.citationFull).toContain('149-ФЗ');
    expect(article1.citationFull).toContain('27.07.2006');
  });

  it('во вход эмбеддинга добавляет реквизиты акта и расположение', () => {
    const article1 = chunks.find((chunk) => chunk.path === 'ch_1/st_1')!;
    expect(article1.embedInput).toContain('149-ФЗ');
    expect(article1.embedInput).toContain('Расположение:');
    expect(article1.embedInput).toContain(article1.text);
  });

  it('сохраняет путь к родительской единице', () => {
    const article1 = chunks.find((chunk) => chunk.path === 'ch_1/st_1')!;
    expect(article1.parentPath).toBe('ch_1');
  });

  it('объединяет короткие статьи в один фрагмент', () => {
    const merged = chunks.find((chunk) => chunk.path.includes('+'));
    expect(merged).toBeDefined();
    expect(merged!.path).toContain('st_3');
    expect(merged!.path).toContain('st_4');
  });

  it('нумерует фрагменты подряд', () => {
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it('смещения символов указывают внутрь исходного текста', () => {
    for (const chunk of chunks) {
      expect(chunk.charStart).toBeGreaterThanOrEqual(0);
      expect(chunk.charEnd).toBeLessThanOrEqual(LAW_TEXT.length);
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
    }
  });
});

describe('chunkAct: длинные статьи', () => {
  it('делит слишком длинную статью на части с перекрытием', () => {
    const long = `Статья 1. Длинная\n\n${Array.from(
      { length: 40 },
      (_, i) => `${i + 1}. Положение номер ${i + 1}. ${'Текст положения. '.repeat(20)}`,
    ).join('\n')}`;

    const chunks = chunkAct(long, { targetTokens: 300, maxTokens: 500 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.isPartial)).toBe(true);
    expect(chunks[0]!.partTotal).toBe(chunks.length);

    // Перекрытие: последний абзац первой части повторяется во второй,
    // иначе условие, разорванное границей, потерялось бы.
    const tail = chunks[0]!.text.split('\n').at(-1)!;
    expect(chunks[1]!.text).toContain(tail.slice(0, 40));
  });
});

describe('chunkAct: неструктурированные документы', () => {
  it('пояснительную записку режет по абзацам', () => {
    const note = `Пояснительная записка к проекту федерального закона.

${'Первый абзац обоснования. '.repeat(30)}

${'Второй абзац обоснования. '.repeat(30)}`;

    const chunks = chunkAct(note, { docKind: 'bill_explanatory', targetTokens: 150 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.docKind === 'bill_explanatory')).toBe(true);
    expect(chunks[0]!.text.length).toBeGreaterThan(0);
  });
});

describe('вспомогательные функции', () => {
  it('оценивает число токенов', () => {
    expect(approxTokenCount('Федеральный закон')).toBeGreaterThan(3);
    expect(approxTokenCount('')).toBe(0);
  });

  it('строит короткую ссылку от внутренней единицы к внешней', () => {
    expect(buildCitationShort('ch_1/st_15/p_3', ACT)).toBe('ч. 3 ст. 15 гл. 1 ФЗ-149');
  });

  it('строит полную ссылку с наименованием акта', () => {
    const citation = buildCitationFull('st_15/p_3', ACT);
    expect(citation).toContain('ч. 3 ст. 15');
    expect(citation).toContain('№ 149-ФЗ');
    expect(citation).toContain('Об информации');
  });

  it('без реквизитов акта строит только структурную часть', () => {
    expect(buildCitationShort('st_15')).toBe('ст. 15');
  });
});
