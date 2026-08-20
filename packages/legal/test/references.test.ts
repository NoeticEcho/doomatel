import { describe, expect, it } from 'vitest';
import { extractReferences } from '../src/references/parser.js';
import { findActAnchors } from '../src/references/acts.js';
import { findUnitMentions } from '../src/references/units.js';
import { actUri, unitPathToString } from '../src/identifiers/uri.js';

function firstOf(text: string, options?: Parameters<typeof extractReferences>[1]) {
  const refs = extractReferences(text, options);
  expect(refs.length).toBeGreaterThan(0);
  return refs[0]!;
}

describe('findUnitMentions', () => {
  it('находит одиночные структурные единицы', () => {
    const mentions = findUnitMentions('в статье 15 сказано');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.kind).toBe('article');
    expect(mentions[0]!.numbers).toEqual(['15']);
  });

  it('различает пункт и подпункт', () => {
    const mentions = findUnitMentions('подпункт 2 пункта 3');
    expect(mentions.map((m) => m.kind)).toEqual(['subitem', 'item']);
  });

  it('понимает сокращения', () => {
    const mentions = findUnitMentions('ст. 15, ч. 2, п. 4');
    expect(mentions.map((m) => m.kind)).toEqual(['article', 'clause', 'item']);
  });

  it('раскрывает перечисления', () => {
    const mentions = findUnitMentions('статьями 5 и 7');
    expect(mentions[0]!.numbers).toEqual(['5', '7']);
  });

  it('раскрывает диапазоны', () => {
    const mentions = findUnitMentions('статей 5 - 8');
    expect(mentions[0]!.numbers).toEqual(['5', '6', '7', '8']);
  });

  it('понимает порядковые числительные в абзацах', () => {
    const mentions = findUnitMentions('абзац первый пункта 2');
    expect(mentions[0]!.kind).toBe('indent');
    expect(mentions[0]!.numbers).toEqual(['1']);
  });

  it('понимает буквенные подпункты', () => {
    const mentions = findUnitMentions('подпунктом «а» пункта 1');
    expect(mentions[0]!.kind).toBe('subitem');
    expect(mentions[0]!.numbers).toEqual(['а']);
  });
});

describe('findActAnchors', () => {
  it('находит федеральный закон с реквизитами', () => {
    const anchors = findActAnchors(
      'Федерального закона от 27 июля 2006 года № 149-ФЗ «Об информации, информационных технологиях и о защите информации»',
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.ref.type).toBe('federal-law');
    expect(anchors[0]!.ref.date).toBe('2006-07-27');
    expect(anchors[0]!.ref.number).toBe('149-ФЗ');
    expect(anchors[0]!.ref.title).toContain('Об информации');
  });

  it('находит числовую форму даты', () => {
    const anchors = findActAnchors('Федеральный закон от 27.07.2006 № 149-ФЗ');
    expect(anchors[0]!.ref.date).toBe('2006-07-27');
    expect(anchors[0]!.ref.number).toBe('149-ФЗ');
  });

  it('находит Конституцию', () => {
    const anchors = findActAnchors('статьёй 104 Конституции Российской Федерации');
    expect(anchors[0]!.ref.type).toBe('constitution');
  });

  it('находит кодекс по сокращению', () => {
    const anchors = findActAnchors('в силу статьи 128 ГК РФ');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.ref.shortName).toBe('ГК РФ');
    expect(anchors[0]!.ref.number).toBe('51-ФЗ');
  });

  it('находит кодекс по полному наименованию в родительном падеже', () => {
    const anchors = findActAnchors('статьи 12 Гражданского кодекса Российской Федерации');
    expect(anchors[0]!.ref.shortName).toBe('ГК РФ');
  });

  it('различает УК и УПК', () => {
    const uk = findActAnchors('Уголовного кодекса Российской Федерации');
    const upk = findActAnchors('Уголовно-процессуального кодекса Российской Федерации');
    expect(uk[0]!.ref.shortName).toBe('УК РФ');
    expect(upk[0]!.ref.shortName).toBe('УПК РФ');
  });

  it('находит КоАП по полному наименованию', () => {
    const anchors = findActAnchors(
      'Кодекса Российской Федерации об административных правонарушениях',
    );
    expect(anchors[0]!.ref.shortName).toBe('КоАП РФ');
  });

  it('находит постановление Правительства', () => {
    const anchors = findActAnchors('постановлением Правительства Российской Федерации от 26.02.2010 № 96');
    expect(anchors[0]!.ref.type).toBe('government-resolution');
    expect(anchors[0]!.ref.date).toBe('2010-02-26');
    expect(anchors[0]!.ref.number).toBe('96');
  });

  it('распознаёт ссылку на сам акт', () => {
    const anchors = findActAnchors('в соответствии с настоящим Федеральным законом');
    expect(anchors[0]!.isSelf).toBe(true);
  });
});

describe('extractReferences', () => {
  it('собирает полную цепочку структурных единиц перед актом', () => {
    const ref = firstOf(
      'в соответствии с пунктом 2 части 3 статьи 15 Федерального закона от 27.07.2006 № 149-ФЗ',
    );
    expect(ref.type).toBe('federal-law');
    expect(ref.number).toBe('149-ФЗ');
    expect(unitPathToString(ref.path)).toBe('st_15/p_3/i_2');
    expect(ref.confidence).toBeGreaterThan(0.9);
  });

  it('строит устойчивый идентификатор из результата', () => {
    const ref = firstOf('статьи 128 Гражданского кодекса Российской Федерации');
    expect(actUri(ref)).toBe('eli:rf:code:1994-11-30:51-fz');
  });

  it('раскрывает перечисление статей в несколько ссылок', () => {
    const refs = extractReferences('статьями 5 и 7 Федерального закона от 27.07.2006 № 149-ФЗ');
    const paths = refs.map((r) => unitPathToString(r.path));
    expect(paths).toContain('st_5');
    expect(paths).toContain('st_7');
  });

  it('разрешает «настоящего Федерального закона» через selfAct', () => {
    const selfAct = { type: 'federal-law' as const, date: '2020-01-01', number: '1-ФЗ' };
    const ref = firstOf('согласно части 2 статьи 7 настоящего Федерального закона', { selfAct });
    expect(ref.number).toBe('1-ФЗ');
    expect(unitPathToString(ref.path)).toBe('st_7/p_2');
  });

  it('помечает внутренние ссылки без указания акта', () => {
    const selfAct = { type: 'federal-law' as const, date: '2020-01-01', number: '1-ФЗ' };
    const refs = extractReferences('Порядок, установленный частью 2 статьи 7, применяется...', {
      selfAct,
    });
    expect(refs).toHaveLength(1);
    expect(unitPathToString(refs[0]!.path)).toBe('st_7/p_2');
    expect(refs[0]!.number).toBe('1-ФЗ');
  });

  it('находит несколько разных актов в одном предложении', () => {
    const refs = extractReferences(
      'Согласно статье 128 ГК РФ и части 1 статьи 2 Федерального закона от 27.07.2006 № 149-ФЗ, ...',
    );
    const shortNames = refs.map((r) => r.shortName ?? r.number);
    expect(shortNames).toContain('ГК РФ');
    expect(shortNames).toContain('149-ФЗ');
  });

  it('не путает соседние независимые ссылки', () => {
    const refs = extractReferences(
      'В статье 5 Федерального закона от 27.07.2006 № 149-ФЗ и в статье 9 Федерального закона от 27.07.2006 № 152-ФЗ',
    );
    const pairs = refs.map((r) => `${r.number}:${unitPathToString(r.path)}`);
    expect(pairs).toContain('149-ФЗ:st_5');
    expect(pairs).toContain('152-ФЗ:st_9');
  });

  it('возвращает корректные позиции в тексте', () => {
    const text = 'Текст. В силу статьи 15 Федерального закона от 27.07.2006 № 149-ФЗ далее.';
    const ref = firstOf(text);
    expect(text.slice(ref.span[0], ref.span[1])).toBe(ref.raw);
    expect(ref.raw).toContain('статьи 15');
    expect(ref.raw).toContain('149-ФЗ');
  });

  it('на тексте без ссылок возвращает пустой результат', () => {
    expect(extractReferences('Обычный текст без правовых ссылок.')).toEqual([]);
  });
});
