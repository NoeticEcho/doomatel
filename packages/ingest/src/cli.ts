#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { FixtureFetcher } from './fetcher/fixture.js';
import { HttpFetcher } from './fetcher/http.js';
import { JinaFetcher } from './fetcher/jina.js';
import { FallbackFetcher, PolitePolicyFetcher } from './fetcher/policy.js';
import type { SourceFetcher } from './fetcher/types.js';
import { billCardUrl, parseBillCard } from './sozd/bill-card.js';
import { DumaApiClient } from './duma-api/client.js';
import { PravoClient } from './pravo/client.js';

const HELP = `doomatel-ingest — утилиты ингеста законодательных источников

Команды:
  probe                     Проверить доступность источников из текущей сети
  capture --bill <номер>    Снять фикстуры карточек законопроектов СОЗД
  parse --file <путь>       Разобрать сохранённый HTML карточки и вывести JSON

Общие параметры:
  --out <каталог>           Каталог фикстур (по умолчанию ./fixtures)
  --proxy <url>             HTTP(S)-прокси (например, российский выходной узел)
  --jina                    Использовать Jina Reader как запасной транспорт
  --jina-key <ключ>         API-ключ Jina Reader
  --interval <мс>           Минимальный интервал между запросами к хосту (по умолчанию 1000)

Переменные окружения:
  DUMA_API_KEY, DUMA_APP_TOKEN   Ключи ИС «Законотворчество» (http://api.duma.gov.ru/key-request)
  INGEST_PROXY_URL               То же, что --proxy
  JINA_API_KEY                   То же, что --jina-key
`;

interface CliOptions {
  out: string;
  proxyUrl?: string;
  useJina: boolean;
  jinaKey?: string;
  intervalMs: number;
}

function buildFetcher(options: CliOptions, mode: 'record' | 'auto' | 'replay'): SourceFetcher {
  const direct = new HttpFetcher({
    ...(options.proxyUrl ? { proxyUrl: options.proxyUrl } : {}),
  });
  const chain: SourceFetcher[] = [direct];
  if (options.useJina) {
    chain.push(
      new JinaFetcher({
        ...(options.jinaKey ? { apiKey: options.jinaKey } : {}),
        ...(options.proxyUrl ? { proxyUrl: options.proxyUrl } : {}),
      }),
    );
  }
  const upstream = new PolitePolicyFetcher(
    chain.length === 1 ? chain[0]! : new FallbackFetcher(chain),
    { minIntervalMs: options.intervalMs },
  );
  return new FixtureFetcher({ dir: options.out, mode, upstream });
}

const PROBE_TARGETS = [
  { name: 'api.duma.gov.ru', url: 'http://api.duma.gov.ru/' },
  { name: 'sozd.duma.gov.ru', url: 'https://sozd.duma.gov.ru/oz' },
  { name: 'sozd.parlament.gov.ru', url: 'https://sozd.parlament.gov.ru/oz' },
  { name: 'duma.gov.ru', url: 'http://duma.gov.ru/' },
  { name: 'publication.pravo.gov.ru', url: 'http://publication.pravo.gov.ru/api/DocumentTypes' },
  { name: 'pravo.gov.ru', url: 'http://pravo.gov.ru/' },
];

async function probe(options: CliOptions): Promise<void> {
  const direct = new PolitePolicyFetcher(
    new HttpFetcher({ ...(options.proxyUrl ? { proxyUrl: options.proxyUrl } : {}) }),
    { minIntervalMs: options.intervalMs, retries: 0 },
  );
  const jina = options.useJina
    ? new PolitePolicyFetcher(
        new JinaFetcher({ ...(options.jinaKey ? { apiKey: options.jinaKey } : {}) }),
        { minIntervalMs: options.intervalMs, retries: 0 },
      )
    : undefined;

  console.log('Проверка доступности источников\n');
  for (const target of PROBE_TARGETS) {
    const results: string[] = [];
    for (const [label, fetcher] of [
      ['напрямую', direct],
      ['через jina', jina],
    ] as const) {
      if (!fetcher) continue;
      try {
        const response = await fetcher.fetch({ url: target.url, timeoutMs: 30_000 });
        results.push(`${label}: HTTP ${response.status} (${response.body.length} байт)`);
      } catch (error) {
        results.push(`${label}: ✗ ${(error as Error).message.split('\n')[0]}`);
      }
    }
    console.log(`${target.name.padEnd(28)} ${results.join(' | ')}`);
  }

  const apiKey = process.env['DUMA_API_KEY'];
  const appToken = process.env['DUMA_APP_TOKEN'];
  if (apiKey && appToken) {
    console.log('\nПроверка ИС «Законотворчество» с предоставленными ключами…');
    const client = new DumaApiClient({ apiKey, appToken, fetcher: direct });
    try {
      const result = await client.search({ limit: 1 });
      console.log(`  ✓ /search вернул count=${result.count}, законопроектов на странице: ${result.laws.length}`);
    } catch (error) {
      console.log(`  ✗ ${(error as Error).message}`);
    }
  } else {
    console.log('\nDUMA_API_KEY / DUMA_APP_TOKEN не заданы — проверка API пропущена.');
  }

  console.log('\nПроверка publication.pravo.gov.ru…');
  const pravo = new PravoClient({ fetcher: direct });
  try {
    const documents = await pravo.documents({ PageSize: 10, Index: 1 });
    console.log(`  ✓ /api/Documents вернул ${documents.items.length} записей из ${documents.itemsTotalCount ?? '?'}`);
  } catch (error) {
    console.log(`  ✗ ${(error as Error).message}`);
  }
}

async function capture(bills: string[], options: CliOptions): Promise<void> {
  if (bills.length === 0) {
    console.error('Укажите хотя бы один законопроект: --bill 149922-8');
    process.exitCode = 1;
    return;
  }
  const fetcher = buildFetcher(options, 'record');
  console.log(`Снятие фикстур в ${options.out}\n`);

  for (const bill of bills) {
    const url = billCardUrl(bill);
    try {
      const response = await fetcher.fetch({
        url,
        requiresJs: true,
        waitForSelector: '#oz_name',
        timeoutMs: 90_000,
      });
      const card = parseBillCard(response.body);
      const status = card.warnings.length === 0 ? '✓' : '⚠';
      console.log(
        `${status} ${bill}: ${response.body.length} байт, событий: ${card.events.length}, документов: ${card.attachments.length}`,
      );
      for (const warning of card.warnings) console.log(`    ⚠ ${warning}`);
    } catch (error) {
      console.log(`✗ ${bill}: ${(error as Error).message.split('\n')[0]}`);
    }
  }
}

async function parseFile(file: string): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(file, 'utf8');
  const html = file.endsWith('.json')
    ? (JSON.parse(raw) as { response: { body: string } }).response.body
    : raw;
  console.log(JSON.stringify(parseBillCard(html), null, 2));
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: 'string', default: './fixtures' },
      bill: { type: 'string', multiple: true, default: [] },
      file: { type: 'string' },
      proxy: { type: 'string' },
      jina: { type: 'boolean', default: false },
      'jina-key': { type: 'string' },
      interval: { type: 'string', default: '1000' },
      help: { type: 'boolean', default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  const proxyUrl = values.proxy ?? process.env['INGEST_PROXY_URL'];
  const jinaKey = values['jina-key'] ?? process.env['JINA_API_KEY'];
  const options: CliOptions = {
    out: values.out ?? './fixtures',
    useJina: values.jina ?? false,
    intervalMs: Number(values.interval ?? '1000'),
    ...(proxyUrl ? { proxyUrl } : {}),
    ...(jinaKey ? { jinaKey } : {}),
  };

  switch (command) {
    case 'probe':
      await probe(options);
      break;
    case 'capture':
      await capture(values.bill ?? [], options);
      break;
    case 'parse':
      if (!values.file) {
        console.error('Укажите --file <путь>');
        process.exitCode = 1;
        return;
      }
      await parseFile(values.file);
      break;
    default:
      console.error(`Неизвестная команда: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
