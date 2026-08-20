import { describe, expect, it } from 'vitest';
import {
  encodeDocument,
  encodeQuery,
  extractRequisites,
  hashTerm,
  normalizeRequisite,
  terms,
  tokenize,
} from '../src/lexical/russian.js';

describe('токенизация русского правового текста', () => {
  it('приводит словоформы к одной основе', () => {
    expect(terms('законопроект')).toEqual(terms('законопроекта'));
    expect(terms('законопроектами')).toEqual(terms('законопроект'));
  });

  it('отбрасывает общеязыковые стоп-слова', () => {
    expect(terms('в и на с для')).toEqual([]);
  });

  it('отбрасывает служебную лексику правовых актов', () => {
    // «статья» и «часть» есть почти в каждом документе корпуса и не различают
    // документы; номера при этом сохраняются.
    const result = terms('статья 15 часть 3');
    expect(result).toEqual(['15', '3']);
  });

  it('сохраняет номер акта целиком', () => {
    const tokens = tokenize('Федеральный закон 149-ФЗ');
    const requisites = tokens.filter((t) => t.isRequisite).map((t) => t.term);
    expect(requisites).toContain('149-фз');
  });

  it('исправляет опечатку «ф3» вместо «фз»', () => {
    expect(normalizeRequisite('149-ф3')).toBe('149-фз');
  });

  it('сохраняет составные номера статей', () => {
    const tokens = tokenize('статьи 15.1 и 15.2');
    const numbers = tokens.filter((t) => t.isRequisite).map((t) => t.term);
    expect(numbers).toEqual(['15.1', '15.2']);
  });

  it('не различает регистр и букву «ё»', () => {
    expect(terms('ЗАКОНОПРОЕКТ')).toEqual(terms('законопроект'));
    expect(terms('учёт')).toEqual(terms('учет'));
  });

  it('возвращает корректные позиции токенов', () => {
    const text = 'Норма установлена законом.';
    const token = tokenize(text).find((t) => t.raw === 'законом')!;
    expect(text.slice(token.span[0], token.span[1])).toBe('законом');
  });
});

describe('извлечение реквизитов', () => {
  it('находит номера актов в запросе', () => {
    expect(extractRequisites('что говорит 149-ФЗ о реестре')).toContain('149-фз');
  });

  it('на запросе без реквизитов возвращает пустой список', () => {
    expect(extractRequisites('регулирование персональных данных')).toEqual([]);
  });
});

describe('разрежённые векторы BM25', () => {
  it('хеш терма стабилен и укладывается в uint32', () => {
    const a = hashTerm('законопроект');
    expect(a).toBe(hashTerm('законопроект'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(0x7fffffff);
    expect(Number.isInteger(a)).toBe(true);
  });

  it('разные термы дают разные индексы', () => {
    expect(hashTerm('законопроект')).not.toBe(hashTerm('постановление'));
  });

  it('вектор документа содержит по одной записи на уникальный терм', () => {
    const vector = encodeDocument('закон закон закон постановление');
    expect(vector.indices).toHaveLength(2);
    expect(new Set(vector.indices).size).toBe(2);
  });

  it('насыщение по частоте: третье вхождение весит меньше первого', () => {
    const once = encodeDocument('реестр');
    const thrice = encodeDocument('реестр реестр реестр');
    const growth = thrice.values[0]! / once.values[0]!;
    // При k1 = 1.2 троекратный повтор не даёт троекратного веса.
    expect(growth).toBeGreaterThan(1);
    expect(growth).toBeLessThan(3);
  });

  it('реквизит весит больше обычного терма', () => {
    const vector = encodeDocument('реестр 149-ФЗ');
    const tokens = tokenize('реестр 149-ФЗ');
    const requisiteIndex = vector.indices.indexOf(
      hashTerm(tokens.find((t) => t.isRequisite)!.term),
    );
    const plainIndex = vector.indices.indexOf(hashTerm(tokens.find((t) => !t.isRequisite)!.term));
    expect(vector.values[requisiteIndex]!).toBeGreaterThan(vector.values[plainIndex]!);
  });

  it('длинный документ получает меньший вес на терм, чем короткий', () => {
    const short = encodeDocument('реестр операторов');
    const long = encodeDocument(`реестр операторов ${'дополнительный текст '.repeat(60)}`);
    const shortIdx = short.indices.indexOf(hashTerm(terms('реестр')[0]!));
    const longIdx = long.indices.indexOf(hashTerm(terms('реестр')[0]!));
    expect(long.values[longIdx]!).toBeLessThan(short.values[shortIdx]!);
  });

  it('вектор запроса не применяет нормализацию по длине', () => {
    const query = encodeQuery('реестр операторов персональных данных');
    // Все обычные термы весят одинаково — у запроса нет «длины документа».
    const plain = query.values.filter((value) => value === 1);
    expect(plain.length).toBeGreaterThan(0);
  });

  it('пустой текст даёт пустой вектор', () => {
    expect(encodeDocument('   ')).toEqual({ indices: [], values: [] });
  });

  it('запрос и документ пересекаются по индексам при общей лексике', () => {
    const document = encodeDocument('Оператор обязан вести реестр обработки данных.');
    const query = encodeQuery('реестр обработки');
    const overlap = query.indices.filter((index) => document.indices.includes(index));
    expect(overlap.length).toBeGreaterThanOrEqual(2);
  });
});
