import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';

/**
 * Применение миграций.
 *
 * Используется собственный исполнитель, а не `drizzle-kit migrate`, потому что
 * часть миграций написана вручную (политики RLS, функции, расширения) и должна
 * применяться вперемежку со сгенерированными в строгом лексическом порядке
 * имён файлов. Журнал drizzle-kit такого не допускает.
 *
 * Каждая миграция применяется в отдельной транзакции; контрольная сумма файла
 * сохраняется, чтобы изменение уже применённой миграции обнаруживалось сразу,
 * а не приводило к расхождению схем между средами.
 */

export interface MigrateOptions {
  /** Каталог с файлами `*.sql`. */
  dir: string;
  url: string;
  /** Сообщать о ходе применения. */
  onProgress?: (message: string) => void;
  /**
   * Разрешить расхождение контрольных сумм. По умолчанию расхождение —
   * ошибка: изменённая миграция означает, что среды разъехались.
   */
  allowChecksumMismatch?: boolean;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  appliedAt: Date;
  durationMs: number;
}

const JOURNAL_TABLE = '__doomatel_migrations';

/** Разбивает файл на отдельные запросы по маркеру drizzle-kit. */
export function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^(--[^\n]*\n?)*$/u.test(statement));
}

export async function migrate(options: MigrateOptions): Promise<AppliedMigration[]> {
  const log = options.onProgress ?? (() => undefined);
  const sql = postgres(options.url, { max: 1, onnotice: () => undefined });

  try {
    await sql.unsafe(`
      create table if not exists ${JOURNAL_TABLE} (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now(),
        duration_ms integer not null
      )
    `);

    const files = (await readdir(options.dir))
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en'));

    const existing = new Map<string, { checksum: string }>(
      (
        await sql<{ name: string; checksum: string }[]>`
          select name, checksum from ${sql(JOURNAL_TABLE)}
        `
      ).map((row) => [row.name, { checksum: row.checksum }]),
    );

    const applied: AppliedMigration[] = [];

    for (const file of files) {
      const content = await readFile(join(options.dir, file), 'utf8');
      const checksum = createHash('sha256').update(content).digest('hex');
      const previous = existing.get(file);

      if (previous) {
        if (previous.checksum !== checksum && !options.allowChecksumMismatch) {
          throw new Error(
            `Миграция «${file}» изменилась после применения. ` +
              'Создайте новую миграцию вместо правки применённой ' +
              '(или запустите с allowChecksumMismatch, если база пересоздаётся).',
          );
        }
        log(`= ${file} (уже применена)`);
        continue;
      }

      const statements = splitStatements(content);
      const startedAt = Date.now();

      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        const durationMs = Date.now() - startedAt;
        await tx`
          insert into ${tx(JOURNAL_TABLE)} (name, checksum, duration_ms)
          values (${file}, ${checksum}, ${durationMs})
        `;
      });

      const durationMs = Date.now() - startedAt;
      log(`+ ${file} (${statements.length} запросов, ${durationMs} мс)`);
      applied.push({ name: file, checksum, appliedAt: new Date(), durationMs });
    }

    return applied;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
