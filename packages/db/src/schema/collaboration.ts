import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, profile, project, workgroup } from './tenancy.js';

/** Тип `bytea` для хранения бинарных обновлений Yjs. */
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType: () => 'bytea',
});

/** Вид рабочего документа. */
export const draftKind = pgEnum('draft_kind', [
  'bill', // текст законопроекта
  'explanatory_note', // пояснительная записка
  'financial_justification', // финансово-экономическое обоснование
  'repeal_list', // перечень актов, подлежащих признанию утратившими силу
  'amendment_table', // таблица поправок
  'conclusion', // заключение
  'review', // отзыв
  'speech', // текст выступления
  'presentation', // презентация
  'analytical_note', // аналитическая записка
  'inquiry', // депутатский запрос
  'other',
]);

export const draftStatus = pgEnum('draft_status', [
  'draft',
  'in_review',
  'approved',
  'submitted',
  'archived',
]);

/**
 * Рабочий документ.
 *
 * Содержимое хранится в двух представлениях:
 *  - `content` — нормализованный JSON блочного редактора (источник истины
 *    для чтения, экспорта и индексации);
 *  - `yjsState` — бинарное состояние Yjs (источник истины для совместного
 *    редактирования; сервис совместной работы периодически сворачивает
 *    журнал обновлений в снимок).
 *
 * Структура `content` совместима с Akoma Ntoso по иерархии и идентификаторам
 * элементов (`eId`), что позволяет детерминированно выгружать документ в AKN,
 * не делая XML первичным форматом хранения.
 */
export const draft = pgTable(
  'draft',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: draftKind('kind').notNull(),
    title: text('title').notNull(),
    status: draftStatus('status').default('draft').notNull(),
    /** Документ, частью пакета которого является данный (текст законопроекта). */
    parentDraftId: uuid('parent_draft_id'),
    content: jsonb('content').default(sql`'{"type":"doc","content":[]}'::jsonb`).notNull(),
    /** Простой текст — для полнотекстового поиска и индексации. */
    plainText: text('plain_text'),
    yjsState: bytea('yjs_state'),
    yjsStateVector: bytea('yjs_state_vector'),
    /** Номер версии, увеличивается при создании снимка. */
    version: integer('version').default(1).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profile.id),
    updatedBy: uuid('updated_by').references(() => profile.id),
    lockedBy: uuid('locked_by').references(() => profile.id),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('draft_project_idx').on(table.projectId, table.kind),
    index('draft_parent_idx').on(table.parentDraftId),
    index('draft_fts_idx').using(
      'gin',
      sql`to_tsvector('russian', ${table.title} || ' ' || coalesce(${table.plainText}, ''))`,
    ),
  ],
);

/** Снимок версии документа — для истории и сравнения редакций. */
export const draftVersion = pgTable(
  'draft_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => draft.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    label: text('label'),
    content: jsonb('content').notNull(),
    plainText: text('plain_text'),
    /** Снимок Yjs — позволяет восстановить состояние совместного сеанса. */
    yjsSnapshot: bytea('yjs_snapshot'),
    createdBy: uuid('created_by').references(() => profile.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique('draft_version_unique').on(table.draftId, table.version)],
);

/**
 * Журнал обновлений Yjs.
 *
 * Сервис совместной работы дописывает сюда обновления, а фоновая задача
 * периодически сворачивает их в `draft.yjsState` и очищает журнал.
 * Такая схема даёт устойчивость к перезапуску сервиса без внешнего хранилища.
 */
export const draftYjsUpdate = pgTable(
  'draft_yjs_update',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => draft.id, { onDelete: 'cascade' }),
    update: bytea('update').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('draft_yjs_update_draft_idx').on(table.draftId, table.id)],
);

/** Вид предложения правки — режим поправок в редакторе. */
export const suggestionKind = pgEnum('suggestion_kind', ['insert', 'delete', 'replace', 'comment']);
export const suggestionStatus = pgEnum('suggestion_status', [
  'open',
  'accepted',
  'rejected',
  'outdated',
]);

/**
 * Предложение правки и комментарий к документу.
 *
 * Реализует режим отслеживания изменений поверх Yjs: предложение хранит
 * якорь на фрагмент документа и содержимое правки, но не изменяет документ
 * до принятия. Это соответствует порядку работы с поправками, где правка
 * сначала предлагается, а затем принимается или отклоняется.
 */
export const draftSuggestion = pgTable(
  'draft_suggestion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => draft.id, { onDelete: 'cascade' }),
    kind: suggestionKind('kind').notNull(),
    status: suggestionStatus('status').default('open').notNull(),
    /** Идентификатор блока, к которому относится правка (`eId` в терминах AKN). */
    anchorBlockId: text('anchor_block_id'),
    /** Относительная позиция Yjs — переживает правки соседних фрагментов. */
    anchorRelative: jsonb('anchor_relative'),
    /** Цитируемый фрагмент на момент создания предложения. */
    quotedText: text('quoted_text'),
    /** Предлагаемый текст. */
    proposedText: text('proposed_text'),
    /** Обоснование правки — попадает в таблицу поправок. */
    rationale: text('rationale'),
    /** Ветка обсуждения: ответы ссылаются на корневое предложение. */
    parentId: uuid('parent_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profile.id),
    resolvedBy: uuid('resolved_by').references(() => profile.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('draft_suggestion_draft_idx').on(table.draftId, table.status),
    index('draft_suggestion_parent_idx').on(table.parentId),
  ],
);

/** Вид беседы. */
export const conversationKind = pgEnum('conversation_kind', [
  'direct', // личная переписка
  'group', // групповой чат
  'project', // чат проекта
  'organization', // чат организации или фракции
  'workgroup', // чат рабочей группы
  'assistant', // диалог с ИИ-помощником
]);

export const conversation = pgTable(
  'conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: conversationKind('kind').notNull(),
    title: text('title'),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    workgroupId: uuid('workgroup_id').references(() => workgroup.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profile.id),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    isArchived: boolean('is_archived').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('conversation_project_idx').on(table.projectId),
    index('conversation_org_idx').on(table.organizationId),
    index('conversation_last_message_idx').on(table.lastMessageAt),
  ],
);

export const conversationParticipant = pgTable(
  'conversation_participant',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    /** Идентификатор последнего прочитанного сообщения. */
    lastReadMessageId: uuid('last_read_message_id'),
    isMuted: boolean('is_muted').default(false).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('conversation_participant_user_idx').on(table.userId),
  ],
);

export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);

export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: messageRole('role').default('user').notNull(),
    authorId: uuid('author_id').references(() => profile.id, { onDelete: 'set null' }),
    /** Имя агента для сообщений помощника. */
    agentName: text('agent_name'),
    body: text('body').notNull(),
    /** Структурированное содержимое: вызовы инструментов, ссылки, цитаты. */
    parts: jsonb('parts').default(sql`'[]'::jsonb`).notNull(),
    /** Ответ в ветке. */
    replyToId: uuid('reply_to_id'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('message_conversation_idx').on(table.conversationId, table.createdAt),
    index('message_reply_idx').on(table.replyToId),
    index('message_fts_idx').using('gin', sql`to_tsvector('russian', ${table.body})`),
  ],
);

export const messageReaction = pgTable(
  'message_reaction',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId, table.emoji] })],
);

export const taskStatus = pgEnum('task_status', [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
]);

export const taskPriority = pgEnum('task_priority', ['low', 'normal', 'high', 'urgent']);

/**
 * Задача.
 *
 * Задачи ставятся в проекте, рабочей группе, организации или лично.
 * Источником задачи может быть расшифровка совещания — тогда заполняется
 * `sourceTranscriptId`, и в интерфейсе видно, из какого обсуждения
 * возникло поручение.
 */
export const task = pgTable(
  'task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    workgroupId: uuid('workgroup_id').references(() => workgroup.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatus('status').default('todo').notNull(),
    priority: taskPriority('priority').default('normal').notNull(),
    assigneeId: uuid('assignee_id').references(() => profile.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profile.id),
    dueDate: timestamp('due_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Родительская задача — для подзадач. */
    parentId: uuid('parent_id'),
    /** Порядок в колонке доски. */
    ordinal: real('ordinal').default(0).notNull(),
    /** Связанные объекты: черновики, законопроекты, сообщения. */
    links: jsonb('links').default(sql`'[]'::jsonb`).notNull(),
    labels: text('labels').array(),
    sourceTranscriptId: uuid('source_transcript_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('task_project_status_idx').on(table.projectId, table.status),
    index('task_assignee_idx').on(table.assigneeId, table.status),
    index('task_due_idx').on(table.dueDate),
    index('task_parent_idx').on(table.parentId),
    index('task_fts_idx').using(
      'gin',
      sql`to_tsvector('russian', ${table.title} || ' ' || coalesce(${table.description}, ''))`,
    ),
  ],
);

export const taskComment = pgTable(
  'task_comment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => profile.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('task_comment_task_idx').on(table.taskId, table.createdAt)],
);

/** Вид загруженного материала. */
export const assetKind = pgEnum('asset_kind', [
  'document',
  'image',
  'audio',
  'video',
  'link',
  'archive',
  'other',
]);

export const assetProcessingStatus = pgEnum('asset_processing_status', [
  'pending',
  'processing',
  'ready',
  'failed',
]);

/** Загруженный пользователем материал: документ, изображение, аудио, ссылка. */
export const asset = pgTable(
  'asset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    kind: assetKind('kind').notNull(),
    name: text('name').notNull(),
    /** Ключ в объектном хранилище; для ссылок пусто. */
    storagePath: text('storage_path'),
    /** Внешний адрес для материалов вида `link`. */
    url: text('url'),
    mimeType: text('mime_type'),
    byteSize: bigint('byte_size', { mode: 'number' }),
    sha256: text('sha256'),
    /** Извлечённый текст — основа для индексации и работы агентов. */
    extractedText: text('extracted_text'),
    processingStatus: assetProcessingStatus('processing_status').default('pending').notNull(),
    processingError: text('processing_error'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => profile.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('asset_project_idx').on(table.projectId, table.kind),
    index('asset_status_idx').on(table.processingStatus),
    index('asset_sha_idx').on(table.sha256),
  ],
);

export const meetingKind = pgEnum('meeting_kind', [
  'call', // созвон
  'planning', // планёрка
  'plenary', // пленарное заседание
  'committee', // заседание комитета
  'workgroup', // заседание рабочей группы
  'other',
]);

/** Совещание: созвон, планёрка, заседание. */
export const meeting = pgTable(
  'meeting',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    workgroupId: uuid('workgroup_id').references(() => workgroup.id, { onDelete: 'cascade' }),
    kind: meetingKind('kind').notNull(),
    title: text('title').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    durationSec: integer('duration_sec'),
    /** Исходная аудиозапись, если загружена. */
    audioAssetId: uuid('audio_asset_id').references(() => asset.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profile.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('meeting_project_idx').on(table.projectId, table.startedAt)],
);

export const transcriptStatus = pgEnum('transcript_status', [
  'pending',
  'transcribing',
  'diarizing',
  'summarizing',
  'ready',
  'failed',
]);

/** Расшифровка совещания. */
export const transcript = pgTable(
  'transcript',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meeting.id, { onDelete: 'cascade' }),
    status: transcriptStatus('status').default('pending').notNull(),
    /** Модель распознавания и её версия — для воспроизводимости. */
    asrModel: text('asr_model'),
    diarizationModel: text('diarization_model'),
    language: text('language').default('ru').notNull(),
    /** Полный текст расшифровки. */
    fullText: text('full_text'),
    /** Краткое изложение, подготовленное моделью. */
    summary: text('summary'),
    /** Принятые решения. */
    decisions: jsonb('decisions').default(sql`'[]'::jsonb`).notNull(),
    /** Поручения, из которых создаются задачи. */
    actionItems: jsonb('action_items').default(sql`'[]'::jsonb`).notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('transcript_meeting_idx').on(table.meetingId),
    index('transcript_fts_idx').using(
      'gin',
      sql`to_tsvector('russian', coalesce(${table.fullText}, ''))`,
    ),
  ],
);

/** Реплика в расшифровке с привязкой ко времени и говорящему. */
export const transcriptSegment = pgTable(
  'transcript_segment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transcriptId: uuid('transcript_id')
      .notNull()
      .references(() => transcript.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    /** Метка говорящего от диаризации: `SPEAKER_00`. */
    speakerLabel: text('speaker_label'),
    /** Сопоставленный участник, если распознан. */
    speakerUserId: uuid('speaker_user_id').references(() => profile.id, { onDelete: 'set null' }),
    /** Имя говорящего, если он не пользователь системы. */
    speakerName: text('speaker_name'),
    text: text('text').notNull(),
    confidence: real('confidence'),
  },
  (table) => [
    unique('transcript_segment_ordinal').on(table.transcriptId, table.ordinal),
    index('transcript_segment_time_idx').on(table.transcriptId, table.startMs),
  ],
);

/** Состояние запуска рабочего процесса (pipeline) законотворческой деятельности. */
export const workflowRunStatus = pgEnum('workflow_run_status', [
  'pending',
  'running',
  'suspended',
  'completed',
  'failed',
  'cancelled',
]);

export const workflowRun = pgTable(
  'workflow_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    /** Идентификатор рабочего процесса, напр. `bill-drafting`. */
    workflowId: text('workflow_id').notNull(),
    status: workflowRunStatus('status').default('pending').notNull(),
    /** Текущий шаг. */
    currentStep: text('current_step'),
    input: jsonb('input').default(sql`'{}'::jsonb`).notNull(),
    output: jsonb('output'),
    /** Состояние приостановленного шага, ожидающего решения человека. */
    suspendPayload: jsonb('suspend_payload'),
    error: text('error'),
    startedBy: uuid('started_by').references(() => profile.id),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('workflow_run_project_idx').on(table.projectId, table.status),
    index('workflow_run_workflow_idx').on(table.workflowId, table.status),
  ],
);

/** Шаг запуска рабочего процесса — для наблюдаемости и повторного запуска. */
export const workflowStep = pgTable(
  'workflow_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRun.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    ordinal: smallint('ordinal').notNull(),
    status: workflowRunStatus('status').default('pending').notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    /** Затраты на языковую модель — для учёта стоимости. */
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('workflow_step_run_idx').on(table.runId, table.ordinal)],
);
