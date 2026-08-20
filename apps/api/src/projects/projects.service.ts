import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@doomatel/db';
import { AccessService } from '../auth/access.service.js';
import { AuditService } from '../common/audit.service.js';
import { DatabaseService } from '../common/database.service.js';

export interface CreateProjectInput {
  scope: 'organization' | 'faction' | 'workgroup' | 'personal';
  name: string;
  description?: string;
  organizationId?: string;
  workgroupId?: string;
  billNumber?: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Проекты, доступные пользователю по любому основанию. */
  async list(userId: string) {
    const scope = await this.access.scope(userId);
    if (scope.projectIds.length === 0) return [];

    return this.db.drizzle
      .select()
      .from(schema.project)
      .where(
        and(
          inArray(schema.project.id, scope.projectIds),
          isNull(schema.project.archivedAt),
        ),
      )
      .orderBy(desc(schema.project.updatedAt));
  }

  async get(userId: string, projectId: string) {
    await this.access.requireProjectRole(userId, projectId, 'viewer');
    const [project] = await this.db.drizzle
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException('Проект не найден');

    const members = await this.db.drizzle
      .select({
        userId: schema.projectMember.userId,
        role: schema.projectMember.role,
        isExternal: schema.projectMember.isExternal,
        fullName: schema.profile.fullName,
        position: schema.profile.position,
      })
      .from(schema.projectMember)
      .innerJoin(schema.profile, eq(schema.profile.id, schema.projectMember.userId))
      .where(eq(schema.projectMember.projectId, projectId));

    return { project, members };
  }

  async create(userId: string, input: CreateProjectInput) {
    const [project] = await this.db.drizzle
      .insert(schema.project)
      .values({
        scope: input.scope,
        name: input.name,
        description: input.description ?? null,
        organizationId: input.organizationId ?? null,
        workgroupId: input.workgroupId ?? null,
        billNumber: input.billNumber ?? null,
        ownerId: userId,
      })
      .returning();

    if (!project) throw new Error('Не удалось создать проект');

    await this.audit.record({
      actorId: userId,
      action: 'project.create',
      entityType: 'project',
      entityId: project.id,
      projectId: project.id,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      payload: { scope: input.scope, name: input.name },
    });

    return project;
  }

  /**
   * Приглашение участника, в том числе из другой партии.
   *
   * Это одна из ключевых возможностей продукта: работа над законопроектом
   * часто ведётся межфракционно, и участник из другой фракции получает доступ
   * именно к этому проекту, не получая доступа ни к чему другому.
   */
  async addMember(
    userId: string,
    projectId: string,
    input: { memberId: string; role: 'editor' | 'contributor' | 'reviewer' | 'viewer' },
  ) {
    await this.access.requireProjectRole(userId, projectId, 'admin');

    const inviterScope = await this.access.scope(userId);
    const inviteeScope = await this.access.scope(input.memberId);
    const isExternal = !inviteeScope.organizationIds.some((organizationId) =>
      inviterScope.organizationIds.includes(organizationId),
    );

    await this.db.drizzle
      .insert(schema.projectMember)
      .values({
        projectId,
        userId: input.memberId,
        role: input.role,
        isExternal,
        addedBy: userId,
      })
      .onConflictDoUpdate({
        target: [schema.projectMember.projectId, schema.projectMember.userId],
        set: { role: input.role },
      });

    await this.audit.record({
      actorId: userId,
      action: 'project.member_add',
      entityType: 'project_member',
      entityId: `${projectId}:${input.memberId}`,
      projectId,
      payload: { role: input.role, isExternal },
    });

    return { added: true, isExternal };
  }

  /** Выдача доступа к проекту целой организации или рабочей группе. */
  async share(
    userId: string,
    projectId: string,
    input: {
      organizationId?: string;
      workgroupId?: string;
      role: 'editor' | 'contributor' | 'reviewer' | 'viewer';
      expiresAt?: string;
    },
  ) {
    await this.access.requireProjectRole(userId, projectId, 'admin');
    if (!input.organizationId && !input.workgroupId) {
      throw new NotFoundException('Укажите организацию или рабочую группу');
    }

    const [share] = await this.db.drizzle
      .insert(schema.projectShare)
      .values({
        projectId,
        organizationId: input.organizationId ?? null,
        workgroupId: input.workgroupId ?? null,
        role: input.role,
        grantedBy: userId,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning();

    await this.audit.record({
      actorId: userId,
      action: 'project.share',
      entityType: 'project_share',
      entityId: share?.id,
      projectId,
      payload: { ...input },
    });

    return share;
  }

  /** Статистика по проекту для сводной карточки. */
  async summary(userId: string, projectId: string) {
    await this.access.requireProjectRole(userId, projectId, 'viewer');
    const rows = await this.db.drizzle.execute(sql`
      select
        (select count(*) from public.draft where project_id = ${projectId}::uuid) as drafts,
        (select count(*) from public.task where project_id = ${projectId}::uuid
           and status not in ('done','cancelled')) as open_tasks,
        (select count(*) from public.draft_suggestion s
           join public.draft d on d.id = s.draft_id
          where d.project_id = ${projectId}::uuid and s.status = 'open') as open_suggestions,
        (select count(*) from public.meeting where project_id = ${projectId}::uuid) as meetings
    `);
    return (rows as unknown as Array<Record<string, number>>)[0] ?? {};
  }
}
