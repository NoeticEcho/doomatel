import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { schema } from '@doomatel/db';
import { AccessService } from '../auth/access.service.js';
import { AuditService } from '../common/audit.service.js';
import { DatabaseService } from '../common/database.service.js';

export interface CreateTaskInput {
  projectId?: string;
  workgroupId?: string;
  organizationId?: string;
  title: string;
  description?: string;
  assigneeId?: string;
  dueDate?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  sourceTranscriptId?: string;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Задачи пользователя: назначенные ему и созданные им. */
  async listMine(userId: string) {
    return this.db.drizzle
      .select()
      .from(schema.task)
      .where(or(eq(schema.task.assigneeId, userId), eq(schema.task.createdBy, userId)))
      .orderBy(asc(schema.task.dueDate), desc(schema.task.updatedAt))
      .limit(200);
  }

  async listByProject(userId: string, projectId: string) {
    await this.access.requireProjectRole(userId, projectId, 'viewer');
    return this.db.drizzle
      .select()
      .from(schema.task)
      .where(eq(schema.task.projectId, projectId))
      .orderBy(asc(schema.task.ordinal), desc(schema.task.createdAt));
  }

  async create(userId: string, input: CreateTaskInput) {
    if (input.projectId) {
      await this.access.requireProjectRole(userId, input.projectId, 'contributor');
    }

    const [task] = await this.db.drizzle
      .insert(schema.task)
      .values({
        projectId: input.projectId ?? null,
        workgroupId: input.workgroupId ?? null,
        organizationId: input.organizationId ?? null,
        title: input.title,
        description: input.description ?? null,
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        priority: input.priority,
        sourceTranscriptId: input.sourceTranscriptId ?? null,
        createdBy: userId,
      })
      .returning();

    if (!task) throw new Error('Не удалось создать задачу');

    await this.audit.record({
      actorId: userId,
      action: 'task.create',
      entityType: 'task',
      entityId: task.id,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      payload: { title: input.title, assigneeId: input.assigneeId },
    });

    return { taskId: task.id, created: true };
  }

  async update(
    userId: string,
    taskId: string,
    input: Partial<{
      title: string;
      description: string;
      status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'cancelled';
      priority: 'low' | 'normal' | 'high' | 'urgent';
      assigneeId: string | null;
      dueDate: string | null;
      ordinal: number;
    }>,
  ) {
    const [task] = await this.db.drizzle
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, taskId))
      .limit(1);
    if (!task) throw new NotFoundException('Задача не найдена');

    if (task.projectId) {
      await this.access.requireProjectRole(userId, task.projectId, 'contributor');
    } else if (task.createdBy !== userId && task.assigneeId !== userId) {
      throw new NotFoundException('Задача не найдена');
    }

    const values: Record<string, unknown> = {};
    if (input.title !== undefined) values['title'] = input.title;
    if (input.description !== undefined) values['description'] = input.description;
    if (input.status !== undefined) {
      values['status'] = input.status;
      values['completedAt'] = input.status === 'done' ? new Date() : null;
    }
    if (input.priority !== undefined) values['priority'] = input.priority;
    if (input.assigneeId !== undefined) values['assigneeId'] = input.assigneeId;
    if (input.dueDate !== undefined) {
      values['dueDate'] = input.dueDate ? new Date(input.dueDate) : null;
    }
    if (input.ordinal !== undefined) values['ordinal'] = input.ordinal;

    if (Object.keys(values).length === 0) return { updated: false };

    await this.db.drizzle.update(schema.task).set(values).where(eq(schema.task.id, taskId));

    await this.audit.record({
      actorId: userId,
      action: 'task.update',
      entityType: 'task',
      entityId: taskId,
      ...(task.projectId ? { projectId: task.projectId } : {}),
      payload: values,
    });

    return { updated: true };
  }
}
