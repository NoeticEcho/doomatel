import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request } from 'undici';
import { AccessService } from '../auth/access.service.js';
import { AuditService } from '../common/audit.service.js';

/**
 * Обращение к сервису агентов.
 *
 * Прикладной сервис выступает посредником и делает три вещи, которые нельзя
 * поручить клиенту:
 *  1. вычисляет права пользователя и передаёт их агенту как контекст запроса;
 *  2. записывает обращение в журнал — для государственного контура должно
 *     быть видно, какие материалы обрабатывались моделью;
 *  3. изолирует сервис агентов от внешней сети: наружу он не публикуется.
 */
@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private readonly baseUrl: string;

  constructor(
    config: ConfigService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {
    this.baseUrl = (config.get<string>('AGENTS_URL') ?? 'http://127.0.0.1:3002').replace(
      /\/$/,
      '',
    );
  }

  /**
   * Запрос к агенту с потоковой отдачей ответа.
   *
   * Возвращается поток, а не готовый текст: работа над правовым вопросом
   * занимает десятки секунд, и депутат должен видеть ход рассуждения,
   * а не пустой экран.
   */
  async streamAgent(
    userId: string,
    accessToken: string,
    input: { agentId: string; messages: unknown[]; threadId?: string; projectId?: string },
  ) {
    const scope = await this.access.scope(userId);

    await this.audit.record({
      actorId: userId,
      action: 'agent.invoke',
      entityType: 'agent',
      entityId: input.agentId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      payload: { threadId: input.threadId, messageCount: input.messages.length },
    });

    try {
      const response = await request(`${this.baseUrl}/api/agents/${input.agentId}/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: input.messages,
          ...(input.threadId ? { threadId: input.threadId, resourceId: userId } : {}),
          // Права передаются сервером; агент не может их изменить.
          requestContext: {
            userId,
            accessToken,
            projectIds: scope.projectIds,
            tenantIds: scope.tenantIds,
            ...(input.projectId ? { projectId: input.projectId } : {}),
          },
        }),
        headersTimeout: 60_000,
        bodyTimeout: 600_000,
      });

      if (response.statusCode >= 400) {
        const text = await response.body.text();
        throw new ServiceUnavailableException(
          `Сервис агентов вернул ${response.statusCode}: ${text.slice(0, 300)}`,
        );
      }

      return response.body;
    } catch (error) {
      this.logger.error(`Ошибка обращения к сервису агентов: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Сервис агентов недоступен. Работа с документами и поиск при этом доступны.',
      );
    }
  }

  /** Запуск рабочего процесса. */
  async startWorkflow(
    userId: string,
    accessToken: string,
    input: { workflowId: string; inputData: Record<string, unknown>; projectId?: string },
  ) {
    const scope = await this.access.scope(userId);

    await this.audit.record({
      actorId: userId,
      action: 'workflow.start',
      entityType: 'workflow',
      entityId: input.workflowId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      payload: { inputKeys: Object.keys(input.inputData) },
    });

    const response = await request(
      `${this.baseUrl}/api/workflows/${input.workflowId}/start-async`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputData: input.inputData,
          requestContext: {
            userId,
            accessToken,
            projectIds: scope.projectIds,
            tenantIds: scope.tenantIds,
          },
        }),
        headersTimeout: 60_000,
        bodyTimeout: 60_000,
      },
    );

    const text = await response.body.text();
    if (response.statusCode >= 400) {
      throw new ServiceUnavailableException(
        `Не удалось запустить процесс: ${text.slice(0, 300)}`,
      );
    }
    return JSON.parse(text) as Record<string, unknown>;
  }

  /**
   * Возобновление приостановленного процесса.
   *
   * Сюда приходит решение человека — виза на документе. Именно этот вызов
   * завершает шаг согласования, поэтому он записывается в журнал отдельно
   * и с указанием, кто именно принял решение.
   */
  async resumeWorkflow(
    userId: string,
    input: {
      workflowId: string;
      runId: string;
      step: string;
      resumeData: Record<string, unknown>;
      projectId?: string;
    },
  ) {
    await this.audit.record({
      actorId: userId,
      action: 'workflow.resume',
      entityType: 'workflow_run',
      entityId: input.runId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      payload: { step: input.step, decision: input.resumeData['approved'] },
    });

    const response = await request(
      `${this.baseUrl}/api/workflows/${input.workflowId}/runs/${input.runId}/resume`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: input.step, resumeData: input.resumeData }),
        headersTimeout: 60_000,
        bodyTimeout: 300_000,
      },
    );

    const text = await response.body.text();
    if (response.statusCode >= 400) {
      throw new ServiceUnavailableException(
        `Не удалось продолжить процесс: ${text.slice(0, 300)}`,
      );
    }
    return JSON.parse(text) as Record<string, unknown>;
  }
}
