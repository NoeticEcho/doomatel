import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@doomatel/db';
import { extractReferences, parseAct, actUri, unitPathToString } from '@doomatel/legal';
import { AccessService } from '../auth/access.service.js';
import { AuditService } from '../common/audit.service.js';
import { DatabaseService } from '../common/database.service.js';

export type DraftKind =
  | 'bill'
  | 'explanatory_note'
  | 'financial_justification'
  | 'repeal_list'
  | 'amendment_table'
  | 'conclusion'
  | 'review'
  | 'speech'
  | 'presentation'
  | 'analytical_note'
  | 'inquiry'
  | 'other';

@Injectable()
export class DraftsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async listByProject(userId: string, projectId: string) {
    await this.access.requireProjectRole(userId, projectId, 'viewer');
    return this.db.drizzle
      .select({
        id: schema.draft.id,
        kind: schema.draft.kind,
        title: schema.draft.title,
        status: schema.draft.status,
        version: schema.draft.version,
        updatedAt: schema.draft.updatedAt,
      })
      .from(schema.draft)
      .where(eq(schema.draft.projectId, projectId))
      .orderBy(desc(schema.draft.updatedAt));
  }

  async get(userId: string, draftId: string) {
    const draft = await this.loadDraft(draftId);
    await this.access.requireProjectRole(userId, draft.projectId, 'viewer');
    return {
      id: draft.id,
      title: draft.title,
      kind: draft.kind,
      status: draft.status,
      plainText: draft.plainText ?? '',
      content: draft.content,
      version: draft.version,
    };
  }

  async create(
    userId: string,
    input: { projectId: string; kind: DraftKind; title: string; plainText?: string },
  ) {
    await this.access.requireProjectRole(userId, input.projectId, 'contributor');

    const [draft] = await this.db.drizzle
      .insert(schema.draft)
      .values({
        projectId: input.projectId,
        kind: input.kind,
        title: input.title,
        plainText: input.plainText ?? '',
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    if (!draft) throw new Error('Не удалось создать документ');

    await this.audit.record({
      actorId: userId,
      action: 'draft.create',
      entityType: 'draft',
      entityId: draft.id,
      projectId: input.projectId,
      payload: { kind: input.kind, title: input.title },
    });

    return draft;
  }

  /**
   * Сохранение новой версии.
   *
   * Каждое сохранение создаёт запись версии. Для законотворческой работы это
   * обязательно: нужно уметь показать, каким был текст на момент согласования,
   * и построить таблицу поправок между редакциями.
   */
  async saveVersion(
    userId: string,
    draftId: string,
    input: { plainText: string; content?: unknown; label?: string },
  ) {
    const draft = await this.loadDraft(draftId);
    await this.access.requireProjectRole(userId, draft.projectId, 'contributor');

    const nextVersion = draft.version + 1;

    await this.db.drizzle.transaction(async (tx) => {
      await tx.insert(schema.draftVersion).values({
        draftId,
        version: draft.version,
        label: input.label ?? null,
        content: draft.content,
        plainText: draft.plainText,
        createdBy: userId,
      });

      await tx
        .update(schema.draft)
        .set({
          plainText: input.plainText,
          ...(input.content ? { content: input.content } : {}),
          version: nextVersion,
          updatedBy: userId,
        })
        .where(eq(schema.draft.id, draftId));
    });

    await this.audit.record({
      actorId: userId,
      action: 'draft.save',
      entityType: 'draft',
      entityId: draftId,
      projectId: draft.projectId,
      payload: { version: nextVersion },
    });

    return { version: nextVersion };
  }

  /**
   * Разбор документа: структура и ссылки на нормы.
   *
   * Выполняется на сервере детерминированным разбором, а не моделью:
   * результат используется для проверки правок и построения связей,
   * и в нём не должно быть вероятностной составляющей.
   */
  async analyze(userId: string, draftId: string) {
    const draft = await this.loadDraft(draftId);
    await this.access.requireProjectRole(userId, draft.projectId, 'viewer');

    const text = draft.plainText ?? '';
    const act = parseAct(text);
    const references = extractReferences(text);

    return {
      structure: {
        title: act.title,
        units: act.units.map((unit) => ({
          kind: unit.kind,
          number: unit.number,
          heading: unit.heading,
          path: unitPathToString(unit.path),
        })),
        warnings: act.warnings,
      },
      references: references.map((reference) => ({
        raw: reference.raw,
        actUri: actUri(reference),
        path: unitPathToString(reference.path),
        confidence: reference.confidence,
        span: reference.span,
      })),
    };
  }

  /** Создание предложения правки. */
  async createSuggestion(
    userId: string,
    draftId: string,
    input: {
      kind: 'insert' | 'delete' | 'replace' | 'comment';
      anchorBlockId?: string;
      quotedText?: string;
      proposedText?: string;
      rationale: string;
      parentId?: string;
    },
  ) {
    const draft = await this.loadDraft(draftId);
    // Рецензент правок не вносит, но предлагать их обязан — в этом смысл роли.
    await this.access.requireProjectRole(userId, draft.projectId, 'reviewer');

    const [suggestion] = await this.db.drizzle
      .insert(schema.draftSuggestion)
      .values({
        draftId,
        kind: input.kind,
        anchorBlockId: input.anchorBlockId ?? null,
        quotedText: input.quotedText ?? null,
        proposedText: input.proposedText ?? null,
        rationale: input.rationale,
        parentId: input.parentId ?? null,
        createdBy: userId,
      })
      .returning();

    await this.audit.record({
      actorId: userId,
      action: 'draft.suggest',
      entityType: 'draft_suggestion',
      entityId: suggestion?.id,
      projectId: draft.projectId,
      payload: { kind: input.kind },
    });

    return { suggestionId: suggestion?.id ?? '', created: true };
  }

  async listSuggestions(userId: string, draftId: string, onlyOpen = true) {
    const draft = await this.loadDraft(draftId);
    await this.access.requireProjectRole(userId, draft.projectId, 'viewer');

    const conditions = onlyOpen
      ? and(eq(schema.draftSuggestion.draftId, draftId), eq(schema.draftSuggestion.status, 'open'))
      : eq(schema.draftSuggestion.draftId, draftId);

    return this.db.drizzle
      .select()
      .from(schema.draftSuggestion)
      .where(conditions)
      .orderBy(desc(schema.draftSuggestion.createdAt));
  }

  /** Принятие или отклонение предложения — решение принимает человек. */
  async resolveSuggestion(
    userId: string,
    suggestionId: string,
    decision: 'accepted' | 'rejected',
  ) {
    const [suggestion] = await this.db.drizzle
      .select()
      .from(schema.draftSuggestion)
      .where(eq(schema.draftSuggestion.id, suggestionId))
      .limit(1);
    if (!suggestion) throw new NotFoundException('Предложение не найдено');

    const draft = await this.loadDraft(suggestion.draftId);
    await this.access.requireProjectRole(userId, draft.projectId, 'editor');

    if (suggestion.status !== 'open') {
      throw new ForbiddenException('Предложение уже рассмотрено');
    }

    await this.db.drizzle
      .update(schema.draftSuggestion)
      .set({ status: decision, resolvedBy: userId, resolvedAt: new Date() })
      .where(eq(schema.draftSuggestion.id, suggestionId));

    await this.audit.record({
      actorId: userId,
      action: `draft.suggestion_${decision}`,
      entityType: 'draft_suggestion',
      entityId: suggestionId,
      projectId: draft.projectId,
    });

    return { status: decision };
  }

  private async loadDraft(draftId: string) {
    const [draft] = await this.db.drizzle
      .select()
      .from(schema.draft)
      .where(eq(schema.draft.id, draftId))
      .limit(1);
    if (!draft) throw new NotFoundException('Документ не найден');
    return draft;
  }
}
