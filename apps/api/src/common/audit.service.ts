import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from './database.service.js';

export interface AuditEntry {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string;
  organizationId?: string;
  projectId?: string;
  ipAddress?: string;
  userAgent?: string;
  payload?: Record<string, unknown>;
}

/**
 * Журнал действий.
 *
 * Ведётся для всех операций, изменяющих данные или раскрывающих сведения.
 * Для государственного контура это не опция: должно быть видно, кто и когда
 * получил доступ к материалам законопроекта до его внесения.
 *
 * Сбой записи в журнал не отменяет операцию, но обязательно логируется:
 * молчаливая потеря записи журнала хуже, чем шумная.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.drizzle.execute(sql`
        insert into public.audit_log
          (actor_id, action, entity_type, entity_id, organization_id, project_id,
           ip_address, user_agent, payload)
        values (
          ${entry.actorId}::uuid, ${entry.action}, ${entry.entityType},
          ${entry.entityId ?? null}, ${entry.organizationId ?? null}::uuid,
          ${entry.projectId ?? null}::uuid, ${entry.ipAddress ?? null},
          ${entry.userAgent ?? null}, ${JSON.stringify(entry.payload ?? {})}::jsonb
        )
      `);
    } catch (error) {
      this.logger.error(
        `Не удалось записать в журнал действие «${entry.action}» пользователя ${entry.actorId}: ${
          (error as Error).message
        }`,
      );
    }
  }
}
