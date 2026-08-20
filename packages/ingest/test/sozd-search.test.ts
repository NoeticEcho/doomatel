import { describe, expect, it } from 'vitest';
import {
  BILL_CLASS_GUID,
  buildSearchUrl,
  detectPaginationStall,
  pageParamName,
  parseSearchPage,
} from '../src/sozd/search.js';

describe('построение запроса к списку СОЗД', () => {
  it('в компактной форме параметр страницы называется page', () => {
    expect(pageParamName()).toBe('page');
    const url = buildSearchUrl({ convocations: [8] }, { page: 3 });
    expect(url).toContain('page=3');
  });

  it('в расширенной форме параметр страницы содержит GUID класса', () => {
    // Самая дорогая ошибка при обходе СОЗД: обычный «page» здесь молча
    // игнорируется, и обход бесконечно собирает первую страницу.
    expect(pageParamName({ extendedForm: true })).toBe(`page_${BILL_CLASS_GUID}`);
    const url = buildSearchUrl({}, { page: 2, extendedForm: true });
    expect(url).toContain(`page_${BILL_CLASS_GUID}=2`);
    expect(url).not.toMatch(/[?&]page=/u);
  });

  it('первая страница не добавляет параметр страницы', () => {
    expect(buildSearchUrl({}, { page: 1 })).not.toContain('page');
  });

  it('запрашивает увеличенный размер страницы', () => {
    expect(buildSearchUrl({})).toContain('count_items=250');
    expect(buildSearchUrl({}, { pageSize: 50 })).toContain('count_items=50');
  });

  it('передаёт созывы повторяющимся параметром', () => {
    const url = buildSearchUrl({ convocations: [7, 8] });
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('b[Convocation][]=7');
    expect(decoded).toContain('b[Convocation][]=8');
  });

  it('переводит даты периода в формат СОЗД', () => {
    const url = decodeURIComponent(
      buildSearchUrl({ introducedFrom: '2022-06-23', introducedTo: '2022-12-31' }),
    );
    expect(url).toContain('date_period_from_IntroducedDate=23.06.2022');
    expect(url).toContain('date_period_to_IntroducedDate=31.12.2022');
  });

  it('допускает односторонний период', () => {
    const url = decodeURIComponent(buildSearchUrl({ introducedFrom: '2026-01-01' }));
    expect(url).toContain('date_period_from_IntroducedDate=01.01.2026');
    expect(url).not.toContain('date_period_to_IntroducedDate');
  });
});

const LIST_HTML = `
<table>
  <tr class="o_top" data-law_number="149922-8">
    <td><div class="fw500">О внесении изменений в Федеральный закон "Об образовании"</div></td>
    <td>23.06.2022</td>
  </tr>
  <tr class="o_top" data-law_number="792837-7">
    <td><div class="fw500">О внесении изменения в статью 5 Федерального закона</div></td>
    <td>15.09.2019</td>
  </tr>
</table>`;

describe('разбор страницы списка', () => {
  const page = parseSearchPage(LIST_HTML);

  it('извлекает номера и наименования', () => {
    expect(page.rows.map((row) => row.number)).toEqual(['149922-8', '792837-7']);
    expect(page.rows[0]!.name).toContain('Об образовании');
  });

  it('извлекает дату регистрации', () => {
    expect(page.rows[0]!.registrationDate).toBe('2022-06-23');
  });

  it('строит адрес карточки', () => {
    expect(page.rows[0]!.url).toBe('https://sozd.duma.gov.ru/bill/149922-8');
  });

  it('на пустой странице предупреждает о возможной причине', () => {
    const empty = parseSearchPage('<html><body></body></html>');
    expect(empty.rows).toEqual([]);
    expect(empty.warnings.join(' ')).toContain('data-law_number');
    expect(empty.warnings.join(' ')).toContain('параметр страницы');
  });
});

describe('обнаружение зацикливания обхода', () => {
  const rows = (numbers: string[]) =>
    numbers.map((number) => ({ number, name: '', url: '' }));

  it('замечает повтор той же страницы', () => {
    expect(detectPaginationStall(rows(['1-8', '2-8']), rows(['1-8', '2-8']))).toBe(true);
  });

  it('не срабатывает на новой странице', () => {
    expect(detectPaginationStall(rows(['1-8', '2-8']), rows(['3-8', '4-8']))).toBe(false);
  });

  it('не срабатывает на пустых наборах', () => {
    expect(detectPaginationStall([], rows(['1-8']))).toBe(false);
  });
});
