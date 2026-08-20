import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.guard.js';
import { DatabaseService } from './database.service.js';
import { QdrantService } from './qdrant.service.js';

/**
 * Проверка готовности.
 *
 * Проверяются именно зависимости, без которых сервис бесполезен: база и
 * векторное хранилище. Ответ «сервис жив» при неработающем поиске ввёл бы
 * в заблуждение и балансировщик, и дежурного.
 */
@ApiTags('Служебное')
@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly qdrant: QdrantService,
  ) {}

  @Public()
  @Get('healthz')
  @ApiOperation({ summary: 'Живость процесса' })
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  @ApiOperation({ summary: 'Готовность вместе с зависимостями' })
  async ready() {
    const checks: Record<string, { ok: boolean; error?: string }> = {};

    try {
      await this.db.drizzle.execute(sql`select 1`);
      checks['database'] = { ok: true };
    } catch (error) {
      checks['database'] = { ok: false, error: (error as Error).message };
    }

    try {
      await this.qdrant.client.getCollections();
      checks['qdrant'] = { ok: true };
    } catch (error) {
      checks['qdrant'] = { ok: false, error: (error as Error).message };
    }

    const ok = Object.values(checks).every((check) => check.ok);
    return { status: ok ? 'ok' : 'degraded', checks };
  }
}
