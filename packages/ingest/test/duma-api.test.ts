import { describe, expect, it } from 'vitest';
import { DumaApiClient } from '../src/duma-api/client.js';
import { dumaSearchResponse } from '../src/duma-api/schemas.js';
import type { FetchRequest, FetchResponse, SourceFetcher } from '../src/fetcher/types.js';

/** Транспорт-заглушка: отдаёт заранее заданные тела по подстроке в URL. */
class StubFetcher implements SourceFetcher {
  readonly name = 'stub';
  readonly calls: string[] = [];

  constructor(private readonly routes: Array<{ match: string; body: unknown; status?: number }>) {}

  supports(): boolean {
    return true;
  }

  async fetch(request: FetchRequest): Promise<FetchResponse> {
    this.calls.push(request.url);
    const route = this.routes.find((r) => request.url.includes(r.match));
    if (!route) throw new Error(`Нет заглушки для ${request.url}`);
    return {
      url: request.url,
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
      body: typeof route.body === 'string' ? route.body : JSON.stringify(route.body),
      via: this.name,
      durationMs: 0,
    };
  }
}

/** Реальная форма ответа `/search.json`, зафиксированная по дампу открытого клиента API. */
const SEARCH_PAGE_1 = {
  count: 3,
  page: 1,
  wording: 'Законопроекты, отсортированные по дате последнего события (по убыванию)',
  laws: [
    {
      id: 34456,
      number: '149922-8',
      name: 'О внесении изменений в Федеральный закон "Об образовании в Российской Федерации"',
      comments: null,
      introductionDate: '2022-06-23',
      url: 'http://sozd.parlament.gov.ru/bill/149922-8',
      transcriptUrl: null,
      lastEvent: {
        stage: { id: 1, name: 'Внесение законопроекта в Государственную Думу' },
        phase: { id: 1, name: 'Регистрация законопроекта и материалов к нему в САДД' },
        solution: null,
        date: '2022-06-23',
        document: null,
      },
      subject: {
        deputies: [],
        departments: [
          {
            id: 6230800,
            name: 'Правительство РФ',
            isCurrent: true,
            startDate: '1994-01-01',
            endDate: null,
          },
        ],
        factions: [],
      },
      committees: { responsible: null, profile: [], soexecutor: [] },
      type: { id: 38, name: 'Федеральный закон' },
    },
  ],
};

const SEARCH_PAGE_2 = { ...SEARCH_PAGE_1, page: 2 };
const SEARCH_PAGE_3 = { ...SEARCH_PAGE_1, page: 3 };
const SEARCH_PAGE_4 = { count: 3, page: 4, laws: [] };

describe('схема ответа /search', () => {
  it('разбирает реальный дамп ответа', () => {
    const parsed = dumaSearchResponse.parse(SEARCH_PAGE_1);
    expect(parsed.count).toBe(3);
    expect(parsed.laws[0]!.number).toBe('149922-8');
    expect(parsed.laws[0]!.subject!.departments[0]!.name).toBe('Правительство РФ');
    expect(parsed.laws[0]!.committees!.responsible).toBeNull();
  });

  it('терпит отсутствие необязательных блоков', () => {
    const parsed = dumaSearchResponse.parse({
      count: 1,
      laws: [{ id: 1, number: '1-9', name: 'Тест' }],
    });
    expect(parsed.laws[0]!.lastEvent).toBeUndefined();
    expect(parsed.laws[0]!.subject).toBeUndefined();
  });
});

describe('DumaApiClient', () => {
  const makeClient = (routes: Array<{ match: string; body: unknown; status?: number }>) => {
    const fetcher = new StubFetcher(routes);
    const client = new DumaApiClient({
      apiKey: 'testkey',
      appToken: 'apptesttoken',
      fetcher,
    });
    return { client, fetcher };
  };

  it('строит URL по официальному шаблону', () => {
    const { client } = makeClient([]);
    const url = client.buildUrl('search', { number: '149922-8', page: 2 });
    expect(url).toBe(
      'http://api.duma.gov.ru/api/testkey/search.json?app_token=apptesttoken&number=149922-8&page=2',
    );
  });

  it('опускает пустые параметры', () => {
    const { client } = makeClient([]);
    const url = client.buildUrl('deputies', { current: 1, position: undefined });
    expect(url).not.toContain('position');
  });

  it('выполняет поиск', async () => {
    const { client } = makeClient([{ match: 'search.json', body: SEARCH_PAGE_1 }]);
    const result = await client.search({ number: '149922-8' });
    expect(result.laws).toHaveLength(1);
  });

  it('сообщает понятную ошибку при HTTP-сбое', async () => {
    const { client } = makeClient([{ match: 'search.json', body: {}, status: 503 }]);
    await expect(client.search()).rejects.toThrow(/HTTP 503/u);
  });

  it('сообщает понятную ошибку при не-JSON ответе', async () => {
    const { client } = makeClient([{ match: 'search.json', body: '<html>gateway</html>' }]);
    await expect(client.search()).rejects.toThrow(/не JSON/u);
  });

  it('сообщает понятную ошибку при расхождении схемы', async () => {
    const { client } = makeClient([{ match: 'search.json', body: { unexpected: true } }]);
    await expect(client.search()).rejects.toThrow(/не соответствует схеме/u);
  });

  it('обходит страницы, вычисляя их число из count', async () => {
    let page = 0;
    const pages = [SEARCH_PAGE_1, SEARCH_PAGE_2, SEARCH_PAGE_3, SEARCH_PAGE_4];
    const fetcher: SourceFetcher = {
      name: 'paged',
      supports: () => true,
      fetch: async (request) => ({
        url: request.url,
        status: 200,
        headers: {},
        body: JSON.stringify(pages[page++] ?? SEARCH_PAGE_4),
        via: 'paged',
        durationMs: 0,
      }),
    };
    const client = new DumaApiClient({ apiKey: 'k', appToken: 'a', fetcher });

    const collected: string[] = [];
    for await (const law of client.searchAll({ limit: 1 })) collected.push(law.number);

    // count=3, по одному объекту на страницу → ровно три страницы.
    expect(collected).toHaveLength(3);
    expect(page).toBe(3);
  });

  it('уважает ограничение на число страниц', async () => {
    const fetcher: SourceFetcher = {
      name: 'infinite',
      supports: () => true,
      fetch: async (request) => ({
        url: request.url,
        status: 200,
        headers: {},
        body: JSON.stringify({ count: 1_000_000, laws: SEARCH_PAGE_1.laws }),
        via: 'infinite',
        durationMs: 0,
      }),
    };
    const client = new DumaApiClient({ apiKey: 'k', appToken: 'a', fetcher });
    const collected: string[] = [];
    for await (const law of client.searchAll({ limit: 1 }, { maxPages: 2 })) {
      collected.push(law.number);
    }
    expect(collected).toHaveLength(2);
  });
});
