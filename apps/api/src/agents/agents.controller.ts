import { Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodBody } from '../common/zod.pipe.js';
import { AgentsService } from './agents.service.js';

const streamSchema = z.object({
  agentId: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  threadId: z.string().optional(),
  projectId: z.string().uuid().optional(),
});

const startWorkflowSchema = z.object({
  workflowId: z.string().min(1),
  inputData: z.record(z.string(), z.unknown()),
  projectId: z.string().uuid().optional(),
});

const resumeWorkflowSchema = z.object({
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  step: z.string().min(1),
  resumeData: z.record(z.string(), z.unknown()),
  projectId: z.string().uuid().optional(),
});

@ApiTags('Помощник')
@Controller('api/agents')
@UseGuards(AuthGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Post('stream')
  @ApiOperation({ summary: 'Диалог с агентом с потоковой отдачей' })
  async stream(
    @ZodBody(streamSchema) body: z.infer<typeof streamSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const upstream = await this.agents.streamAgent(user.id, user.token, body);
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('x-accel-buffering', 'no');
    for await (const chunk of upstream) {
      response.write(chunk);
    }
    response.end();
  }

  @Post('workflows/start')
  @ApiOperation({ summary: 'Запустить рабочий процесс' })
  startWorkflow(
    @ZodBody(startWorkflowSchema) body: z.infer<typeof startWorkflowSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agents.startWorkflow(user.id, user.token, body);
  }

  @Post('workflows/resume')
  @ApiOperation({
    summary: 'Продолжить приостановленный процесс',
    description: 'Через этот метод передаётся решение человека, в том числе виза на документе.',
  })
  resumeWorkflow(
    @ZodBody(resumeWorkflowSchema) body: z.infer<typeof resumeWorkflowSchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agents.resumeWorkflow(user.id, body);
  }
}
