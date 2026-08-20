import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodBody } from '../common/zod.pipe.js';
import { DraftsService } from './drafts.service.js';

const draftKinds = [
  'bill',
  'explanatory_note',
  'financial_justification',
  'repeal_list',
  'amendment_table',
  'conclusion',
  'review',
  'speech',
  'presentation',
  'analytical_note',
  'inquiry',
  'other',
] as const;

const createDraftSchema = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(draftKinds),
  title: z.string().min(1).max(500),
  plainText: z.string().optional(),
});

const saveVersionSchema = z.object({
  plainText: z.string(),
  content: z.unknown().optional(),
  label: z.string().max(200).optional(),
});

const suggestionSchema = z.object({
  kind: z.enum(['insert', 'delete', 'replace', 'comment']),
  anchorBlockId: z.string().optional(),
  quotedText: z.string().optional(),
  proposedText: z.string().optional(),
  rationale: z.string().min(1).max(5000),
  parentId: z.string().uuid().optional(),
});

const resolveSchema = z.object({ decision: z.enum(['accepted', 'rejected']) });

@ApiTags('Документы')
@Controller('api/drafts')
@UseGuards(AuthGuard)
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Get()
  @ApiOperation({ summary: 'Документы проекта' })
  list(@Query('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.drafts.listByProject(user.id, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Документ' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.drafts.get(user.id, id);
  }

  @Get(':id/analysis')
  @ApiOperation({
    summary: 'Разбор документа',
    description: 'Структура акта и извлечённые ссылки на нормы. Разбор детерминированный.',
  })
  analyze(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.drafts.analyze(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать документ' })
  create(
    @ZodBody(createDraftSchema) body: z.infer<typeof createDraftSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.drafts.create(user.id, body);
  }

  @Post(':id/versions')
  @ApiOperation({ summary: 'Сохранить новую версию' })
  saveVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(saveVersionSchema) body: z.infer<typeof saveVersionSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.drafts.saveVersion(user.id, id, body);
  }

  @Get(':id/suggestions')
  @ApiOperation({ summary: 'Предложения правок' })
  listSuggestions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('all') all?: string,
  ) {
    return this.drafts.listSuggestions(user.id, id, all !== 'true');
  }

  @Post(':id/suggestions')
  @ApiOperation({
    summary: 'Предложить правку',
    description: 'Правка не применяется сразу — её принимает или отклоняет человек.',
  })
  createSuggestion(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(suggestionSchema) body: z.infer<typeof suggestionSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.drafts.createSuggestion(user.id, id, body);
  }

  @Patch('suggestions/:suggestionId')
  @ApiOperation({ summary: 'Принять или отклонить предложение' })
  resolveSuggestion(
    @Param('suggestionId', ParseUUIDPipe) suggestionId: string,
    @ZodBody(resolveSchema) body: z.infer<typeof resolveSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.drafts.resolveSuggestion(user.id, suggestionId, body.decision);
  }
}
