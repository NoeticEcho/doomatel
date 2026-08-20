import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  /** Строка подключения. По умолчанию берётся из `DATABASE_URL`. */
  url?: string;
  /** Размер пула соединений. */
  max?: number;
  /** Логировать SQL-запросы. */
  debug?: boolean;
  /**
   * Роль, от имени которой выполняются запросы.
   *
   * `service` — сервисная роль в обход RLS (используется фоновыми задачами
   * ингеста и миграциями). `authenticated` — обычные запросы приложения,
   * для которых политики RLS обязаны выполняться. Разделение делает
   * невозможным случайный обход политик из прикладного кода.
   */
  role?: 'service' | 'authenticated';
}

/** Создаёт подключение к базе. */
export function createDatabase(options: CreateDatabaseOptions = {}): {
  db: Database;
  sql: postgres.Sql;
  close: () => Promise<void>;
} {
  const url = options.url ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'Не задана строка подключения к базе: укажите DATABASE_URL или передайте options.url',
    );
  }

  const sql = postgres(url, {
    max: options.max ?? 10,
    // Кириллические сообщения об ошибках Postgres приходят в UTF-8;
    // явная установка избавляет от искажений в логах.
    connection: { application_name: 'doomatel', client_encoding: 'UTF8' },
    onnotice: options.debug ? undefined : () => undefined,
  });

  const db = drizzle(sql, { schema, logger: options.debug ?? false });

  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

/**
 * Выполняет запросы от имени конкретного пользователя, чтобы политики RLS
 * применялись так же, как при обращении через PostgREST.
 *
 * Используется в тестах политик и в обработчиках, которым нужно
 * гарантировать, что пользователь не увидит лишнего.
 */
export async function withUser<T>(
  sql: postgres.Sql,
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}
