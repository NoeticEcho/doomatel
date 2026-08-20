import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FetchError, type FetchRequest, type FetchResponse, type SourceFetcher } from './types.js';

export type FixtureMode = 'replay' | 'record' | 'auto';

export interface FixtureFetcherOptions {
  /** Каталог с фикстурами. */
  dir: string;
  /**
   * `replay` — только из фикстур (для тестов и CI без сети);
   * `record` — всегда ходить в сеть и перезаписывать фикстуру;
   * `auto`   — брать из фикстуры, при промахе идти в сеть и записывать.
   */
  mode: FixtureMode;
  /** Транспорт, используемый при записи. */
  upstream?: SourceFetcher;
}

interface StoredFixture {
  request: { url: string; method: string; requiresJs?: boolean };
  response: {
    status: number;
    headers: Record<string, string>;
    body: string;
    via: string;
    capturedAt: string;
  };
}

/**
 * Транспорт «запись/воспроизведение».
 *
 * Ключевой элемент стратегии разработки: источники СОЗД и pravo.gov.ru
 * недоступны из части сред, поэтому парсеры разрабатываются и тестируются
 * против зафиксированных снимков страниц, снятых из среды с доступом
 * (`doomatel-ingest capture`). Это делает парсеры воспроизводимо проверяемыми.
 */
export class FixtureFetcher implements SourceFetcher {
  readonly name = 'fixture';

  constructor(private readonly options: FixtureFetcherOptions) {}

  supports(): boolean {
    return true;
  }

  /** Путь к файлу фикстуры для запроса. */
  fixturePath(request: FetchRequest): string {
    const key = `${request.method ?? 'GET'} ${request.url}${request.requiresJs ? ' +js' : ''}`;
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
    const host = safeSegment(new URL(request.url).host);
    const slug = safeSegment(new URL(request.url).pathname).slice(0, 60) || 'root';
    return join(this.options.dir, host, `${slug}.${hash}.json`);
  }

  async fetch(request: FetchRequest): Promise<FetchResponse> {
    const path = this.fixturePath(request);

    if (this.options.mode !== 'record') {
      const stored = await readFixture(path);
      if (stored) {
        return {
          url: request.url,
          status: stored.response.status,
          headers: stored.response.headers,
          body: stored.response.body,
          via: `${this.name}:${stored.response.via}`,
          durationMs: 0,
        };
      }
      if (this.options.mode === 'replay') {
        throw new FetchError(
          `Фикстура не найдена: ${path}. Снимите её командой «doomatel-ingest capture» из среды с доступом к источнику.`,
          request.url,
          undefined,
          this.name,
        );
      }
    }

    const upstream = this.options.upstream;
    if (!upstream) {
      throw new FetchError(
        `Режим «${this.options.mode}» требует upstream-транспорта`,
        request.url,
        undefined,
        this.name,
      );
    }

    const response = await upstream.fetch(request);
    await this.save(path, request, response);
    return response;
  }

  private async save(
    path: string,
    request: FetchRequest,
    response: FetchResponse,
  ): Promise<void> {
    const payload: StoredFixture = {
      request: {
        url: request.url,
        method: request.method ?? 'GET',
        ...(request.requiresJs ? { requiresJs: true } : {}),
      },
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        via: response.via,
        capturedAt: new Date().toISOString(),
      },
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
  }
}

async function readFixture(path: string): Promise<StoredFixture | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as StoredFixture;
  } catch {
    return undefined;
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '');
}
