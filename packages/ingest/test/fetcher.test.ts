import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixtureFetcher } from '../src/fetcher/fixture.js';
import { FallbackFetcher, PolitePolicyFetcher } from '../src/fetcher/policy.js';
import { decodeBody } from '../src/fetcher/http.js';
import { FetchError, type FetchRequest, type FetchResponse, type SourceFetcher } from '../src/fetcher/types.js';

function stub(
  name: string,
  handler: (request: FetchRequest) => Promise<FetchResponse> | FetchResponse,
  supports: (request: FetchRequest) => boolean = () => true,
): SourceFetcher {
  return { name, supports, fetch: async (request) => handler(request) };
}

function ok(url: string, body = 'ok', via = 'stub'): FetchResponse {
  return { url, status: 200, headers: {}, body, via, durationMs: 0 };
}

describe('decodeBody', () => {
  it('декодирует UTF-8 по умолчанию', () => {
    expect(decodeBody(Buffer.from('Государственная Дума', 'utf8'))).toBe('Государственная Дума');
  });

  it('уважает charset из Content-Type', () => {
    const cp1251 = Buffer.from([0xc4, 0xf3, 0xec, 0xe0]); // «Дума» в windows-1251
    expect(decodeBody(cp1251, 'text/html; charset=windows-1251')).toBe('Дума');
  });

  it('распознаёт windows-1251 без заголовка по битым символам', () => {
    const cp1251 = Buffer.from(
      'Государственная Дума Федерального Собрания'
        .split('')
        .map((ch) => {
          const code = ch.charCodeAt(0);
          if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
          if (code === 0x451) return 0xb8;
          return code;
        }),
    );
    expect(decodeBody(cp1251)).toContain('Государственная Дума');
  });
});

describe('FallbackFetcher', () => {
  it('берёт первый успешный транспорт', async () => {
    const fetcher = new FallbackFetcher([
      stub('a', () => {
        throw new FetchError('нет доступа', 'x');
      }),
      stub('b', (request) => ok(request.url, 'из b', 'b')),
    ]);
    const response = await fetcher.fetch({ url: 'https://example.test/page' });
    expect(response.body).toBe('из b');
  });

  it('пропускает транспорты, не поддерживающие запрос', async () => {
    const fetcher = new FallbackFetcher([
      stub('no-js', (request) => ok(request.url, 'без js'), (request) => !request.requiresJs),
      stub('browser', (request) => ok(request.url, 'с js')),
    ]);
    const response = await fetcher.fetch({ url: 'https://example.test/', requiresJs: true });
    expect(response.body).toBe('с js');
  });

  it('считает 4xx неуспехом и идёт дальше', async () => {
    const fetcher = new FallbackFetcher([
      stub('a', (request) => ({ ...ok(request.url), status: 403 })),
      stub('b', (request) => ok(request.url, 'из b')),
    ]);
    expect((await fetcher.fetch({ url: 'https://example.test/' })).body).toBe('из b');
  });

  it('сообщает обо всех отказах, когда не сработал ни один транспорт', async () => {
    const fetcher = new FallbackFetcher([
      stub('a', () => {
        throw new Error('сеть недоступна');
      }),
      stub('b', (request) => ({ ...ok(request.url), status: 503 })),
    ]);
    await expect(fetcher.fetch({ url: 'https://example.test/' })).rejects.toThrow(
      /сеть недоступна[\s\S]*503/u,
    );
  });
});

describe('PolitePolicyFetcher', () => {
  it('повторяет запрос при временном статусе', async () => {
    let attempts = 0;
    const fetcher = new PolitePolicyFetcher(
      stub('flaky', (request) => {
        attempts += 1;
        return attempts < 3 ? { ...ok(request.url), status: 503 } : ok(request.url, 'наконец-то');
      }),
      { retryBaseMs: 1, minIntervalMs: 0 },
    );
    const response = await fetcher.fetch({ url: 'https://example.test/' });
    expect(response.body).toBe('наконец-то');
    expect(attempts).toBe(3);
  });

  it('не повторяет при 404', async () => {
    let attempts = 0;
    const fetcher = new PolitePolicyFetcher(
      stub('missing', (request) => {
        attempts += 1;
        return { ...ok(request.url), status: 404 };
      }),
      { retryBaseMs: 1, minIntervalMs: 0 },
    );
    expect((await fetcher.fetch({ url: 'https://example.test/' })).status).toBe(404);
    expect(attempts).toBe(1);
  });

  it('выдерживает минимальный интервал между запросами к одному хосту', async () => {
    const timestamps: number[] = [];
    const fetcher = new PolitePolicyFetcher(
      stub('timed', (request) => {
        timestamps.push(Date.now());
        return ok(request.url);
      }),
      { minIntervalMs: 60, retries: 0 },
    );
    await fetcher.fetch({ url: 'https://example.test/a' });
    await fetcher.fetch({ url: 'https://example.test/b' });
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(50);
  });
});

describe('FixtureFetcher', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'doomatel-fixtures-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('в режиме replay падает с понятным сообщением при промахе', async () => {
    const fetcher = new FixtureFetcher({ dir, mode: 'replay' });
    await expect(fetcher.fetch({ url: 'https://sozd.duma.gov.ru/bill/1-8' })).rejects.toThrow(
      /Фикстура не найдена[\s\S]*capture/u,
    );
  });

  it('в режиме auto записывает и затем воспроизводит', async () => {
    let upstreamCalls = 0;
    const upstream = stub('upstream', (request) => {
      upstreamCalls += 1;
      return ok(request.url, '<html>карточка</html>', 'upstream');
    });

    const recorder = new FixtureFetcher({ dir, mode: 'auto', upstream });
    const first = await recorder.fetch({ url: 'https://sozd.duma.gov.ru/bill/149922-8' });
    expect(first.body).toBe('<html>карточка</html>');
    expect(upstreamCalls).toBe(1);

    const replayer = new FixtureFetcher({ dir, mode: 'replay' });
    const second = await replayer.fetch({ url: 'https://sozd.duma.gov.ru/bill/149922-8' });
    expect(second.body).toBe('<html>карточка</html>');
    expect(second.via).toContain('fixture');
    expect(upstreamCalls).toBe(1);
  });

  it('различает запросы с рендерингом и без него', async () => {
    const upstream = stub('upstream', (request) =>
      ok(request.url, request.requiresJs ? 'после js' : 'без js', 'upstream'),
    );
    const fetcher = new FixtureFetcher({ dir, mode: 'auto', upstream });
    const plain = await fetcher.fetch({ url: 'https://sozd.duma.gov.ru/oz' });
    const rendered = await fetcher.fetch({ url: 'https://sozd.duma.gov.ru/oz', requiresJs: true });
    expect(plain.body).toBe('без js');
    expect(rendered.body).toBe('после js');
  });
});
