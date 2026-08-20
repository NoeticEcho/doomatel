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

  /**
   * Полный перечень прав пользователя.
   *
   * Берётся из тех же функций базы, что использует разграничение доступа
   * на уровне строк: `visible_project_ids` и `visible_tenant_ids`. Это и есть
   * тот единственный источник, которым ограничивается выдача векторного
   * поиска. Считать видимость здесь по собственным правилам нельзя: два
   * независимых вычисления рано или поздно разойдутся, и расхождение
   * означало бы утечку материалов между фракциями, которую ничто
   * не обнаружит.
   */
  async scope(userId: string): Promise<AccessScope> {
    const rows = await this.db.drizzle.execute(sql`
      select
        public.visible_project_ids(${userId}::uuid) as project_ids,
        public.visible_tenant_ids(${userId}::uuid) as tenant_ids,
        (select coalesce(array_agg(organization_id::text), array[]::text[])
           from public.user_organization_ids(${userId}::uuid)) as organization_ids
    `);

    const row = (rows as unknown as Array<{
      project_ids: string[] | null;
      tenant_ids: string[] | null;
      organization_ids: string[] | null;
    }>)[0];

    return {
      userId,
      projectIds: row?.project_ids ?? [],
      organizationIds: row?.organization_ids ?? [],
      tenantIds: row?.tenant_ids ?? ['public'],
    };
  }
}
