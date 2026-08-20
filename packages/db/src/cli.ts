#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { migrate } from './migrate.js';

const HELP = `doomatel-db — управление схемой базы данных

Команды:
  migrate    Применить миграции из каталога migrations

Параметры:
  --url <строка>   Строка подключения (по умолчанию DIRECT_URL или DATABASE_URL)
  --dir <путь>     Каталог миграций
  --force          Игнорировать расхождение контрольных сумм
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      dir: { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help || positionals[0] !== 'migrate') {
    console.log(HELP);
    return;
  }

  const url = values.url ?? process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
  if (!url) {
    console.error('Не задана строка подключения: укажите --url или DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const dir = values.dir ? resolve(values.dir) : join(here, '..', 'migrations');

  const applied = await migrate({
    dir,
    url,
    allowChecksumMismatch: values.force ?? false,
    onProgress: (message) => console.log(message),
  });

  console.log(
    applied.length === 0 ? 'Новых миграций нет.' : `Применено миграций: ${applied.length}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
