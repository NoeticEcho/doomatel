import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodBody } from '../common/zod.pipe.js';
import { ProjectsService } from './projects.service.js';

const createProjectSchema = z.object({
  scope: z.enum(['organization', 'faction', 'workgroup', 'personal']),
  name: z.string().min(3).max(300),
  description: z.string().max(5000).optional(),
  organizationId: z.string().uuid().optional(),
  workgroupId: z.string().uuid().optional(),
  billNumber: z.string().regex(/^\d+-\d+$/u).optional(),
});

const addMemberSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(['editor', 'contributor', 'reviewer', 'viewer']),
});

const shareSchema = z.object({
  organizationId: z.string().uuid().optional(),
  workgroupId: z.string().uuid().optional(),
  role: z.enum(['editor', 'contributor', 'reviewer', 'viewer']),
  expiresAt: z.string().datetime().optional(),
});

@ApiTags('Проекты')
@Controller('api/projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'Проекты, доступные пользователю' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка проекта с участниками' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.get(user.id, id);
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'Сводка по проекту' })
  summary(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.summary(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать проект' })
  create(
    @ZodBody(createProjectSchema) body: z.infer<typeof createProjectSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.create(user.id, body);
  }

  @Post(':id/members')
  @ApiOperation({
    summary: 'Пригласить участника',
    description: 'Участник может быть из другой партии — доступ выдаётся только к этому проекту.',
  })
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(addMemberSchema) body: z.infer<typeof addMemberSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.addMember(user.id, id, body);
  }

  @Post(':id/shares')
  @ApiOperation({ summary: 'Открыть доступ организации или рабочей группе' })
  share(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(shareSchema) body: z.infer<typeof shareSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.share(user.id, id, body);
  }
}
