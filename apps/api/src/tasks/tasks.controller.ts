import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodBody } from '../common/zod.pipe.js';
import { TasksService } from './tasks.service.js';

const createTaskSchema = z.object({
  projectId: z.string().uuid().optional(),
  workgroupId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  title: z.string().min(3).max(500),
  description: z.string().max(20000).optional(),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  sourceTranscriptId: z.string().uuid().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(3).max(500).optional(),
  description: z.string().max(20000).optional(),
  status: z
    .enum(['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'])
    .optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  ordinal: z.number().optional(),
});

@ApiTags('Задачи')
@Controller('api/tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Мои задачи' })
  listMine(@CurrentUser() user: AuthenticatedUser, @Query('projectId') projectId?: string) {
    return projectId
      ? this.tasks.listByProject(user.id, projectId)
      : this.tasks.listMine(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать задачу' })
  create(
    @ZodBody(createTaskSchema) body: z.infer<typeof createTaskSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.create(user.id, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить задачу' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateTaskSchema) body: z.infer<typeof updateTaskSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.update(user.id, id, body);
  }
}
