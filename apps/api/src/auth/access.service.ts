import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../common/database.service.js';

/**
 * Вычисление прав пользователя.
 *
 * Права берутся из базы теми же функциями, что использует разграничение
 * доступа на уровне строк. Это существенно: если бы прикладной слой считал
 * права по своим правилам, они рано или поздно разошлись бы с политиками базы,
 * и одно из двух представлений оказалось бы неверным. Здесь источник один.
 */

export type MemberRole = 'owner' | 'admin' | 'editor' | 'contributor' | 'reviewer' | 'viewer';

const ROLE_WEIGHT: Record<MemberRole, number> = {
  owner: 60,
  admin: 50,
  editor: 40,
  contributor: 30,
  reviewer: 20,
  viewer: 10,
};

export interface AccessScope {
  userId: string;
  /** Проекты, доступные пользователю по любому основанию. */
  projectIds: string[];
  /** Организации, в которых пользователь состоит, включая дочерние. */
  organizationIds: string[];
  /** Идентификаторы арендаторов для фильтрации поиска. */
  tenantIds: string[];
}

@Injectable()
export class AccessService {
  constructor(private readonly db: DatabaseService) {}

  /** Роль пользователя в проекте либо `undefined`, если доступа нет. */
  async projectRole(userId: string, projectId: string): Promise<MemberRole | undefined> {
    const rows = await this.db.drizzle.execute(
      sql`select public.project_role(${projectId}::uuid, ${userId}::uuid) as role`,
    );
    const role = (rows as unknown as Array<{ role: MemberRole | null }>)[0]?.role;
    return role ?? undefined;
  }

  /** Проверяет, что роль не ниже требуемой; иначе выбрасывает исключение. */
  async requireProjectRole(
    userId: string,
    projectId: string,
    minimum: MemberRole,
  ): Promise<MemberRole> {
    const role = await this.projectRole(userId, projectId);
    if (!role) {
      // Отсутствие доступа и отсутствие проекта намеренно неразличимы снаружи:
      // иначе перебором идентификаторов можно было бы узнать, какие проекты
      // существуют у других фракций.
      throw new NotFoundException('Проект не найден');
    }
    if (ROLE_WEIGHT[role] < ROLE_WEIGHT[minimum]) {
      throw new ForbiddenException(
        `Требуется роль не ниже «${minimum}», текущая роль — «${role}»`,
      );
    }
    return role;
  }

  /** Полный перечень прав пользователя — используется для фильтрации поиска. */
  async scope(userId: string): Promise<AccessScope> {
    const organizations = await this.db.drizzle.execute(
      sql`select organization_id::text as id from public.user_organization_ids(${userId}::uuid)`,
    );
    const organizationIds = (organizations as unknown as Array<{ id: string }>).map(
      (row) => row.id,
    );

    const projects = await this.db.drizzle.execute(sql`
      select p.id::text as id
      from public.project p
      where public.project_role(p.id, ${userId}::uuid) is not null
    `);
    const projectIds = (projects as unknown as Array<{ id: string }>).map((row) => row.id);

    return {
      userId,
      projectIds,
      organizationIds,
      // Публичный корпус доступен всем аутентифицированным пользователям.
      tenantIds: ['public', ...organizationIds],
    };
  }
}
