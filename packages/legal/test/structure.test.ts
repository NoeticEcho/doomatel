import { describe, expect, it } from 'vitest';
import { findUnit, flattenAct, formatUnitLabel, parseAct } from '../src/structure/parser.js';

const FEDERAL_LAW = `РОССИЙСКАЯ ФЕДЕРАЦИЯ

ФЕДЕРАЛЬНЫЙ ЗАКОН

О внесении изменений в отдельные законодательные акты Российской Федерации

Принят Государственной Думой 12 июля 2022 года
Одобрен Советом Федерации 13 июля 2022 года

Настоящий Федеральный закон определяет правовые основы регулирования
отношений в сфере, указанной в статье 1 настоящего Федерального закона.

Глава 1. Общие положения

Статья 1. Предмет регулирования настоящего Федерального закона

1. Настоящий Федеральный закон регулирует отношения, возникающие при:
1) осуществлении права на поиск информации;
2) применении информационных технологий;
2. Положения настоящего Федерального закона не распространяются на отношения,
возникающие при охране результатов интеллектуальной деятельности.

Статья 2. Основные понятия, используемые в настоящем Федеральном законе

В настоящем Федеральном законе используются следующие основные понятия:
1) информация — сведения независимо от формы их представления;
2) обладатель информации — лицо, самостоятельно создавшее информацию.

Глава 2. Заключительные положения

Статья 3. Вступление в силу настоящего Федерального закона

Настоящий Федеральный закон вступает в силу с 1 января 2023 года.
`;

describe('parseAct', () => {
  const act = parseAct(FEDERAL_LAW);

  it('распознаёт вид и наименование акта', () => {
    expect(act.actTypeLabel).toBe('ФЕДЕРАЛЬНЫЙ ЗАКОН');
    expect(act.title).toContain('О внесении изменений в отдельные законодательные акты');
  });

  it('выделяет преамбулу', () => {
    expect(act.preamble?.text).toContain('определяет правовые основы');
  });

  it('строит дерево глав и статей', () => {
    expect(act.units).toHaveLength(2);
    const [chapter1, chapter2] = act.units;
    expect(chapter1!.kind).toBe('chapter');
    expect(chapter1!.number).toBe('1');
    expect(chapter1!.heading).toBe('Общие положения');
    expect(chapter1!.children.map((c) => c.number)).toEqual(['1', '2']);
    expect(chapter2!.children).toHaveLength(1);
  });

  it('делит статью федерального закона на части, а пункты вкладывает в часть', () => {
    const article1 = act.units[0]!.children[0]!;
    expect(article1.kind).toBe('article');
    expect(article1.heading).toContain('Предмет регулирования');
    expect(article1.children.map((c) => c.kind)).toEqual(['clause', 'clause']);
    expect(article1.children[0]!.number).toBe('1');

    // Пункты «1)», «2)» относятся к части 1, а не к статье напрямую.
    const clause1 = article1.children[0]!;
    expect(clause1.children.map((c) => c.kind)).toEqual(['item', 'item']);
    expect(clause1.children[0]!.text).toContain('права на поиск информации');
    expect(clause1.children[0]!.path).toEqual([
      { kind: 'chapter', number: '1' },
      { kind: 'article', number: '1' },
      { kind: 'clause', number: '1' },
      { kind: 'item', number: '1' },
    ]);
  });

  it('строит корректные пути к единицам', () => {
    const article1 = act.units[0]!.children[0]!;
    expect(article1.path).toEqual([
      { kind: 'chapter', number: '1' },
      { kind: 'article', number: '1' },
    ]);
  });

  it('не выдаёт предупреждений на корректном тексте', () => {
    expect(act.warnings).toEqual([]);
  });
});

describe('parseAct для кодексов', () => {
  it('делит статью на пункты, если указан articleChildKind', () => {
    const code = `Статья 128. Объекты гражданских прав

1. К объектам гражданских прав относятся вещи.
2. Иное имущество относится к объектам гражданских прав.
`;
    const act = parseAct(code, { articleChildKind: 'item' });
    const article = act.units[0]!;
    expect(article.children.map((c) => c.kind)).toEqual(['item', 'item']);
  });
});

describe('parseAct: подпункты и абзацы', () => {
  it('распознаёт буквенные подпункты', () => {
    const text = `Статья 5. Требования

1. Требования включают:
1) первое требование, состоящее из:
а) первой части;
б) второй части;
`;
    const act = parseAct(text);
    const article = act.units[0]!;
    const clause = article.children.find((c) => c.kind === 'clause')!;
    expect(clause.number).toBe('1');
    const item = clause.children.find((c) => c.kind === 'item')!;
    expect(item.children.map((c) => c.number)).toEqual(['а', 'б']);
  });

  it('по требованию выделяет абзацы отдельными узлами', () => {
    const text = `Статья 1. Заголовок

Первый абзац текста.
Второй абзац текста.
`;
    const act = parseAct(text, { splitIndents: true });
    const article = act.units[0]!;
    expect(article.children.map((c) => c.kind)).toEqual(['indent', 'indent']);
    expect(article.children[1]!.number).toBe('2');
  });

  it('без splitIndents склеивает абзацы в текст единицы', () => {
    const text = `Статья 1. Заголовок

Первый абзац текста.
Второй абзац текста.
`;
    const act = parseAct(text);
    expect(act.units[0]!.text).toBe('Первый абзац текста.\nВторой абзац текста.');
  });
});

describe('flattenAct', () => {
  const act = parseAct(FEDERAL_LAW);
  const flat = flattenAct(act);

  it('разворачивает дерево в плоский список с путями', () => {
    const paths = flat.map((unit) => unit.pathString);
    expect(paths).toContain('ch_1/st_1');
    expect(paths).toContain('ch_1/st_1/p_1');
    expect(paths).toContain('ch_2/st_3');
  });

  it('в fullText узла содержится текст потомков', () => {
    const article1 = flat.find((unit) => unit.pathString === 'ch_1/st_1')!;
    expect(article1.fullText).toContain('Статья 1');
    expect(article1.fullText).toContain('осуществлении права на поиск информации');
  });

  it('ownText содержит только собственный текст узла', () => {
    const article1 = flat.find((unit) => unit.pathString === 'ch_1/st_1')!;
    expect(article1.ownText).not.toContain('осуществлении права');
  });

  it('проставляет глубину', () => {
    expect(flat.find((u) => u.pathString === 'ch_1')!.depth).toBe(0);
    expect(flat.find((u) => u.pathString === 'ch_1/st_1')!.depth).toBe(1);
    expect(flat.find((u) => u.pathString === 'ch_1/st_1/p_1')!.depth).toBe(2);
  });
});

describe('findUnit и formatUnitLabel', () => {
  const act = parseAct(FEDERAL_LAW);

  it('находит узел по пути', () => {
    const unit = findUnit(act, [
      { kind: 'chapter', number: '1' },
      { kind: 'article', number: '2' },
    ]);
    expect(unit?.heading).toContain('Основные понятия');
  });

  it('возвращает undefined для несуществующего пути', () => {
    expect(findUnit(act, [{ kind: 'article', number: '99' }])).toBeUndefined();
  });

  it('формирует подпись единицы', () => {
    expect(formatUnitLabel({ kind: 'article', number: '15' })).toBe('Статья 15');
    expect(formatUnitLabel({ kind: 'chapter', number: 'IV' })).toBe('Глава IV');
    expect(formatUnitLabel({ kind: 'item', number: '2' })).toBe('2)');
  });
});

describe('parseAct: устойчивость', () => {
  it('сообщает о тексте без структуры', () => {
    const act = parseAct('Просто текст без статей.');
    expect(act.units).toEqual([]);
    expect(act.warnings.join(' ')).toContain('не найдено ни одной структурной единицы');
  });

  it('обрабатывает статьи с составными номерами', () => {
    const act = parseAct('Статья 15.1. Дополнительная статья\n\nТекст.');
    expect(act.units[0]!.number).toBe('15.1');
  });
});
