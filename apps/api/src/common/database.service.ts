import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase, type Database } from '@doomatel/db';
import type postgres from 'postgres';

/**
 * Подключение к базе.
 *
 * Сервис подключается сервисной ролью, обходящей разграничение на уровне
 * строк, и сам отвечает за проверку прав. Такой выбор сделан осознанно:
 * тяжёлые операции (ингест, переиндексация, обход графа) с политиками
 * на каждой строке работают в разы медленнее. Политики при этом остаются
 * включёнными и защищают прямые обращения из браузера через PostgREST.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly drizzle: Database;
  readonly sql: postgres.Sql;
  private readonly closeConnection: () => Promise<void>;

  constructor(config: ConfigService) {
    const url = config.get<string>('DATABASE_URL');
    if (!url) throw new Error('Не задана переменная окружения DATABASE_URL');

    const { db, sql, close } = createDatabase({
      url,
      max: Number(config.get<string>('DATABASE_POOL_SIZE') ?? 10),
      role: 'service',
    });
    this.drizzle = db;
    this.sql = sql;
    this.closeConnection = close;
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeConnection();
  }
}
