import { sql } from 'drizzle-orm';
import {
  bigserial,
  customType,
  char,
  date,
  index,
  integer,
  jsonb,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { document } from './legislation.js';
import { legal } from './reference.js';

/**
 * Тип `ltree` — иерархический путь к структурной единице.
 * Позволяет запрашивать всех потомков статьи одним оператором `<@`
 * с индексной поддержкой GiST.
 */
const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => 'ltree',
});

/**
 * Корпус действующего права: акты, их редакции, структурные единицы,
 * связи между нормами и чанки для поиска.
 *
 * Модель следует уровням FRBR:
 *   `legal_work`        — акт как таковой (Work), не зависит от редакции;
 *   `legal_expression`  — редакция акта на период действия (Expression);
 *   `legal_unit`        — структурная единица внутри редакции.
 *
 * Время моделируется битемпорально: `validFrom`/`validTo` — период действия
 * нормы, `knownFrom`/`knownTo` — период, когда система знала об этой версии.
 * Это позволяет отвечать и на вопрос «что действовало на дату D»,
 * и на вопрос «что мы считали действующим на дату D».
 */

export const unitKind = legal.enum('unit_kind', [
  'preamble',
  'part',
  'section',
  'subsection',
  'chapter',
  'paragraph_sign',
  'article',
  'clause',
  'item',
  'subitem',
  'indent',
  'note',
  'appendix',
]);

export const unitStatus = legal.enum('unit_status', [
  'in_force', // действует
  'repealed', // утратило силу
  'not_yet_in_force', // не вступило в силу
  'suspended', // действие приостановлено
]);

/** Вид связи между нормами. */
export const edgeKind = legal.enum('edge_kind', [
  'amends', // изменяет
  'repeals', // признаёт утратившим силу
  'references', // ссылается на
  'implements', // принят во исполнение
  'interprets', // разъясняет/толкует
  'supersedes', // заменяет собой
  'suspends', // приостанавливает действие
  'introduced_by', // введено в действие актом
  'conflicts_with', // предположительно противоречит
]);

/** Акт как произведение (уровень Work). */
export const legalWork = legal.table(
  'legal_work',
  {
    /** Устойчивый идентификатор вида `eli:rf:federal-law:2006-07-27:149-fz`. */
    uri: text('uri').primaryKey(),
    actType: text('act_type').notNull(),
    number: text('number'),
    signedDate: date('signed_date'),
    title: text('title'),
    shortName: text('short_name'),
    /** Номер электронного опубликования первой публикации. */
    eoNumber: char('eo_number', { length: 16 }),
    /** Законопроект, из которого возник акт. */
    billNumber: text('bill_number'),
    classifierCode: text('classifier_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('legal_work_number_idx').on(table.number),
    index('legal_work_bill_idx').on(table.billNumber),
    index('legal_work_title_fts_idx').using(
      'gin',
      sql`to_tsvector('russian', coalesce(${table.title}, ''))`,
    ),
  ],
);

/** Редакция акта (уровень Expression). */
export const legalExpression = legal.table(
  'legal_expression',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workUri: text('work_uri')
      .notNull()
      .references(() => legalWork.uri, { onDelete: 'cascade' }),
    /** Порядковый номер редакции, монотонно возрастает. */
    redactionNo: integer('redaction_no').notNull(),
    /** Дата, на которую действует редакция. */
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to').default('9999-12-31').notNull(),
    knownFrom: timestamp('known_from', { withTimezone: true }).defaultNow().notNull(),
    knownTo: timestamp('known_to', { withTimezone: true }),
    /** Акт, которым внесена данная редакция. */
    amendedByUri: text('amended_by_uri'),
    sourceDocumentSha: char('source_document_sha', { length: 64 }).references(
      () => document.sha256,
    ),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('legal_expression_redaction_key').on(table.workUri, table.redactionNo),
    index('legal_expression_validity_idx').on(table.workUri, table.validFrom, table.validTo),
  ],
);

/** Структурная единица внутри редакции акта. */
export const legalUnit = legal.table(
  'legal_unit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expressionId: uuid('expression_id')
      .notNull()
      .references(() => legalExpression.id, { onDelete: 'cascade' }),
    workUri: text('work_uri')
      .notNull()
      .references(() => legalWork.uri, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    kind: unitKind('kind').notNull(),
    number: text('number'),
    heading: text('heading'),
    /** Сериализованный путь: `ch_1/st_15/p_3`. */
    path: text('path').notNull(),
    /** Тот же путь в формате `ltree` для запросов по предкам: `ch_1.st_15.p_3`. */
    pathLtree: ltree('path_ltree').notNull(),
    depth: smallint('depth').notNull(),
    /** Порядковый номер среди сиблингов — задаёт порядок в документе. */
    ordinal: integer('ordinal').notNull(),
    /** Собственный текст единицы, дословно, без изменений. */
    text: text('text').notNull(),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    status: unitStatus('status').default('in_force').notNull(),
    /** Готовая короткая ссылка: «ч. 2 ст. 15.1 ФЗ-149». */
    citationShort: text('citation_short'),
    /** Готовая полная ссылка с реквизитами акта и указанием редакции. */
    citationFull: text('citation_full'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('legal_unit_path_key').on(table.expressionId, table.path),
    index('legal_unit_expression_idx').on(table.expressionId, table.ordinal),
    index('legal_unit_parent_idx').on(table.parentId),
    index('legal_unit_work_path_idx').on(table.workUri, table.path),
    index('legal_unit_ltree_idx').using('gist', table.pathLtree),
    index('legal_unit_fts_idx').using('gin', sql`to_tsvector('russian', ${table.text})`),
  ],
);

/**
 * Связь между нормами — реляционное представление графа права.
 *
 * Решение зафиксировано в архитектуре: единственная система записи —
 * PostgreSQL. Обходы графа выполняются рекурсивными CTE, а специализированный
 * граф-движок при необходимости подключается как производная read-модель
 * через порт `LegalGraphPort`.
 */
export const legalEdge = legal.table(
  'legal_edge',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: edgeKind('kind').notNull(),
    /** Источник связи: URI акта либо URI со структурной единицей. */
    fromUri: text('from_uri').notNull(),
    toUri: text('to_uri').notNull(),
    /** Идентификаторы разрешённых единиц, если разрешение выполнено. */
    fromUnitId: uuid('from_unit_id').references(() => legalUnit.id, { onDelete: 'cascade' }),
    toUnitId: uuid('to_unit_id').references(() => legalUnit.id, { onDelete: 'set null' }),
    /** Уверенность извлечения связи, 0..1. */
    confidence: real('confidence').default(1).notNull(),
    /** Как получена связь: `parser`, `llm`, `manual`, `official`. */
    provenance: text('provenance').notNull(),
    /** Фрагмент текста, из которого извлечена связь. */
    evidence: text('evidence'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('legal_edge_from_idx').on(table.fromUri, table.kind),
    index('legal_edge_to_idx').on(table.toUri, table.kind),
    index('legal_edge_from_unit_idx').on(table.fromUnitId),
    unique('legal_edge_natural_key').on(table.kind, table.fromUri, table.toUri, table.evidence),
  ],
);

/** Вид документа, из которого получен чанк. */
export const chunkDocKind = legal.enum('chunk_doc_kind', [
  'law',
  'code',
  'constitution',
  'decree',
  'regulation',
  'bill',
  'bill_explanatory', // пояснительная записка
  'bill_feo', // финансово-экономическое обоснование
  'bill_conclusion', // заключение
  'bill_review', // отзыв
  'bill_amendments', // таблица поправок
  'bill_repeal_list', // перечень актов, подлежащих признанию утратившими силу
  'transcript', // стенограмма
  'draft', // рабочий черновик
  'uploaded', // загруженный пользователем документ
]);

/**
 * Чанк для поиска.
 *
 * Строка в этой таблице — система записи; вектор живёт в Qdrant, а `vectorId`
 * связывает их. Такая раскладка позволяет пересобрать векторный индекс
 * из базы без повторного обращения к источникам.
 */
export const chunk = legal.table(
  'chunk',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    docKind: chunkDocKind('doc_kind').notNull(),
    /** Документ-файл, если чанк получен из файла. */
    documentSha: char('document_sha', { length: 64 }).references(() => document.sha256, {
      onDelete: 'cascade',
    }),
    /** Структурная единица, если чанк получен из разобранного акта. */
    unitId: uuid('unit_id').references(() => legalUnit.id, { onDelete: 'cascade' }),
    workUri: text('work_uri'),
    expressionId: uuid('expression_id').references(() => legalExpression.id, {
      onDelete: 'cascade',
    }),
    billNumber: text('bill_number'),
    /** Родительский чанк — для стратегии parent-document retrieval. */
    parentChunkId: uuid('parent_chunk_id'),

    chunkIndex: integer('chunk_index').notNull(),
    /** Дословный текст единицы. */
    text: text('text').notNull(),
    /** Поясняющее предложение, сгенерированное моделью (contextual retrieval). */
    contextGloss: text('context_gloss'),
    /** Ровно та строка, которая была подана на эмбеддинг. */
    embedInput: text('embed_input').notNull(),
    tokenCount: integer('token_count'),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),

    path: text('path'),
    citationShort: text('citation_short'),
    citationFull: text('citation_full'),

    /** Период действия нормы — для запросов на дату. */
    validFrom: date('valid_from'),
    validTo: date('valid_to'),

    /** Арендатор: фракция, комитет, проект или `public`. */
    tenantId: text('tenant_id').default('public').notNull(),
    visibility: text('visibility').default('public').notNull(),
    ownerUserId: uuid('owner_user_id'),
    projectId: uuid('project_id'),

    /** Исходящие ссылки, извлечённые парсером: `["eli:rf:federal-law:...#st_9"]`. */
    refsOut: text('refs_out').array(),
    /** Упомянутые организации. */
    orgs: text('orgs').array(),

    /** Идентификатор точки в Qdrant. */
    vectorId: text('vector_id'),
    embedModel: text('embed_model'),
    /** Ревизия модели эмбеддингов — обязательна для безопасной переиндексации. */
    embedModelRev: text('embed_model_rev'),
    embedDim: integer('embed_dim'),
    /** SimHash для обнаружения почти-дубликатов. */
    simhash: text('simhash'),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('chunk_document_idx').on(table.documentSha, table.chunkIndex),
    index('chunk_unit_idx').on(table.unitId),
    index('chunk_work_idx').on(table.workUri),
    index('chunk_bill_idx').on(table.billNumber),
    index('chunk_tenant_idx').on(table.tenantId),
    index('chunk_vector_idx').on(table.vectorId),
    index('chunk_simhash_idx').on(table.simhash),
    index('chunk_fts_idx').using('gin', sql`to_tsvector('russian', ${table.text})`),
  ],
);
