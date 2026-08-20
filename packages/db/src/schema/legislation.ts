import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  legal,
  refCommittee,
  refConvocation,
  refLawClass,
  refPhase,
  refStage,
  refTopic,
  subjectOfInitiative,
} from './reference.js';

/** Формат исходного файла документа. */
export const docFormat = legal.enum('doc_format', [
  'doc',
  'docx',
  'pdf',
  'rtf',
  'zip',
  'html',
  'txt',
  'odt',
  'other',
]);

/** Состояние извлечения текста из файла. */
export const extractStatus = legal.enum('extract_status', [
  'pending',
  'ok',
  'ocr_ok',
  'failed',
  'skipped',
]);

/** Роль комитета по законопроекту. */
export const committeeRole = legal.enum('committee_role', [
  'responsible', // ответственный комитет
  'profile', // профильный комитет
  'soexecutor', // комитет-соисполнитель
]);

/**
 * Законопроект.
 *
 * Естественный ключ — номер вида «149922-8» (порядковый номер и созыв).
 * Он стабилен, публичен и используется во всех источниках, поэтому лучше
 * подходит на роль первичного ключа, чем внутренний идентификатор API.
 */
export const bill = legal.table(
  'bill',
  {
    number: text('number').primaryKey(),
    /** Идентификатор из ИС «Законотворчество». */
    dumaId: bigint('duma_id', { mode: 'number' }).unique(),
    convocation: smallint('convocation')
      .notNull()
      .references(() => refConvocation.id),
    serialNo: integer('serial_no').notNull(),
    name: text('name').notNull(),
    comments: text('comments'),
    introductionDate: date('introduction_date'),
    lawTypeId: integer('law_type_id'),
    lawTypeName: text('law_type_name'),
    /** Поле паспорта СОЗД «Форма законопроекта». */
    lawForm: text('law_form'),
    sozdUrl: text('sozd_url').notNull(),
    transcriptUrl: text('transcript_url'),

    responsibleCommitteeId: integer('responsible_committee_id').references(() => refCommittee.id),
    topicId: integer('topic_id').references(() => refTopic.id),
    lawClassId: integer('law_class_id').references(() => refLawClass.id),
    /** Срок представления поправок ко второму чтению. */
    amendmentDeadline: date('amendment_deadline'),
    lawmakingProgram: text('lawmaking_program'),
    issueAssignment: text('issue_assignment'),
    issueQuestion: text('issue_question'),

    // Денормализованное последнее событие — горячий путь списков в интерфейсе.
    lastEventDate: date('last_event_date'),
    lastEventStageId: smallint('last_event_stage_id').references(() => refStage.id),
    lastEventPhaseId: integer('last_event_phase_id').references(() => refPhase.id),
    lastEventSolution: text('last_event_solution'),
    statusCode: smallint('status_code'),
    statusText: text('status_text'),

    /** Номер принятого федерального закона, напр. «273-ФЗ». */
    fzNumber: text('fz_number'),
    /** Номер электронного опубликования — мост на publication.pravo.gov.ru. */
    actEoNumber: char('act_eo_number', { length: 16 }),

    /** Отпечаток ответа API — дешёвое обнаружение изменений первого уровня. */
    apiFingerprint: text('api_fingerprint'),
    /** Отпечаток карточки СОЗД — обнаружение изменений второго уровня. */
    cardFingerprint: text('card_fingerprint'),
    rawApi: jsonb('raw_api').default(sql`'{}'::jsonb`).notNull(),
    rawCard: jsonb('raw_card').default(sql`'{}'::jsonb`).notNull(),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastApiSyncAt: timestamp('last_api_sync_at', { withTimezone: true }),
    lastCardSyncAt: timestamp('last_card_sync_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('bill_convocation_event_idx').on(table.convocation, table.lastEventDate),
    index('bill_last_event_idx').on(table.lastEventDate),
    index('bill_status_idx').on(table.statusCode),
    index('bill_eo_idx').on(table.actEoNumber),
    index('bill_name_fts_idx').using('gin', sql`to_tsvector('russian', ${table.name})`),
  ],
);

/** Связь законопроекта с субъектами права законодательной инициативы. */
export const billInitiator = legal.table(
  'bill_initiator',
  {
    billNumber: text('bill_number')
      .notNull()
      .references(() => bill.number, { onDelete: 'cascade' }),
    subjectId: bigint('subject_id', { mode: 'number' })
      .notNull()
      .references(() => subjectOfInitiative.id),
  },
  (table) => [
    primaryKey({ columns: [table.billNumber, table.subjectId] }),
    index('bill_initiator_subject_idx').on(table.subjectId),
  ],
);

/** Комитеты, привлечённые к рассмотрению законопроекта. */
export const billCommittee = legal.table(
  'bill_committee',
  {
    billNumber: text('bill_number')
      .notNull()
      .references(() => bill.number, { onDelete: 'cascade' }),
    committeeId: integer('committee_id')
      .notNull()
      .references(() => refCommittee.id),
    role: committeeRole('role').notNull(),
  },
  (table) => [primaryKey({ columns: [table.billNumber, table.committeeId, table.role] })],
);

/**
 * Хронология рассмотрения законопроекта.
 *
 * `eventNum` — иерархический номер вида «1.1» из атрибута `data-eventnum`
 * карточки СОЗД; его смысл совпадает с парой (стадия, фаза) из API,
 * что позволяет связывать события из двух источников.
 */
export const billEvent = legal.table(
  'bill_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    billNumber: text('bill_number')
      .notNull()
      .references(() => bill.number, { onDelete: 'cascade' }),
    eventNum: text('event_num'),
    stageId: smallint('stage_id').references(() => refStage.id),
    phaseId: integer('phase_id').references(() => refPhase.id),
    eventDate: date('event_date'),
    title: text('title'),
    solution: text('solution'),
    instance: text('instance'),
    raw: jsonb('raw').default(sql`'{}'::jsonb`).notNull(),
    /** Источник события: `duma_api` или `sozd_card`. */
    source: text('source').notNull(),
  },
  (table) => [
    index('bill_event_bill_date_idx').on(table.billNumber, table.eventDate),
    unique('bill_event_natural_key').on(
      table.billNumber,
      table.eventNum,
      table.eventDate,
      table.title,
    ),
  ],
);

/**
 * Файл документа, адресуемый по содержимому.
 *
 * Ключ — SHA-256 содержимого: один и тот же документ встречается в карточках
 * разных законопроектов и на publication.pravo.gov.ru, и хранить его нужно
 * один раз.
 */
export const document = legal.table(
  'document',
  {
    sha256: char('sha256', { length: 64 }).primaryKey(),
    storagePath: text('storage_path').notNull(),
    format: docFormat('format').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    pageCount: integer('page_count'),
    sourceUrl: text('source_url'),
    sourceHost: text('source_host'),
    extractStatus: extractStatus('extract_status').default('pending').notNull(),
    extractEngine: text('extract_engine'),
    extractError: text('extract_error'),
    plainText: text('plain_text'),
    lang: text('lang').default('ru'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
  },
  (table) => [
    index('document_extract_status_idx').on(table.extractStatus),
    index('document_source_url_idx').on(table.sourceUrl),
  ],
);

/** Привязка документа к законопроекту и этапу рассмотрения. */
export const billDocument = legal.table(
  'bill_document',
  {
    billNumber: text('bill_number')
      .notNull()
      .references(() => bill.number, { onDelete: 'cascade' }),
    documentSha: char('document_sha', { length: 64 })
      .notNull()
      .references(() => document.sha256),
    /** Наименование документа из карточки: «Текст законопроекта», «ФЭО». */
    title: text('title'),
    /** Классифицированный вид сопроводительного документа. */
    docKind: text('doc_kind'),
    docDate: date('doc_date'),
    eventNum: text('event_num'),
    /** GUID из ссылки `/download/{GUID}`. */
    sozdGuid: text('sozd_guid'),
    ordinal: integer('ordinal'),
  },
  (table) => [
    uniqueIndex('bill_document_key')
      .on(table.billNumber, table.documentSha, sql`coalesce(${table.eventNum}, '')`),
    index('bill_document_sha_idx').on(table.documentSha),
  ],
);

/** Официально опубликованный нормативный правовой акт. */
export const act = legal.table(
  'act',
  {
    /** Номер электронного опубликования, напр. «0001202601170001». */
    eoNumber: char('eo_number', { length: 16 }).primaryKey(),
    pravoId: text('pravo_id').unique(),
    complexName: text('complex_name'),
    title: text('title'),
    name: text('name'),
    number: text('number'),
    /** Нормализованный номер для сопоставления с `bill.fz_number`. */
    numberNormalized: text('number_normalized'),
    documentDate: date('document_date'),
    publishDate: date('publish_date'),
    jdRegNumber: text('jd_reg_number'),
    jdRegDate: date('jd_reg_date'),
    pagesCount: integer('pages_count'),
    pdfFileLength: bigint('pdf_file_length', { mode: 'number' }),
    zipFileLength: bigint('zip_file_length', { mode: 'number' }),
    hasSvg: boolean('has_svg').default(false).notNull(),
    signatoryAuthorityId: text('signatory_authority_id'),
    documentTypeId: text('document_type_id'),
    blockCode: text('block_code'),
    pdfDocumentSha: char('pdf_document_sha', { length: 64 }).references(() => document.sha256),
    raw: jsonb('raw').default(sql`'{}'::jsonb`).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('act_publish_date_idx').on(table.publishDate),
    index('act_number_normalized_idx').on(table.numberNormalized),
    index('act_document_date_idx').on(table.documentDate),
  ],
);

/** Журнал обходов источников — для диагностики и соблюдения лимитов. */
export const crawlLog = legal.table(
  'crawl_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: text('source').notNull(),
    url: text('url').notNull(),
    httpStatus: integer('http_status'),
    bytes: bigint('bytes', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    etag: text('etag'),
    lastModified: text('last_modified'),
    fetchedVia: text('fetched_via'),
    error: text('error'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('crawl_log_source_idx').on(table.source, table.fetchedAt),
    index('crawl_log_url_idx').on(table.url, table.fetchedAt),
  ],
);

/** Курсоры инкрементальной синхронизации по источникам. */
export const syncCursor = legal.table('sync_cursor', {
  source: text('source').primaryKey(),
  cursorValue: text('cursor_value').notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
