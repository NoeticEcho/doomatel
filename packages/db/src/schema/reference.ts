import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Схема `legal` — публичный корпус законодательства.
 *
 * Данные официальные и общедоступные, поэтому политики RLS здесь
 * разрешают чтение любому аутентифицированному пользователю, а запись —
 * только сервисной роли ингеста. Прикладные данные (проекты, чаты, задачи)
 * живут в схеме `public` со строгими политиками (см. `tenancy.ts`).
 */
export const legal = pgSchema('legal');

/** Вид субъекта права законодательной инициативы. */
export const spziKind = legal.enum('spzi_kind', [
  'deputy', // депутат Государственной Думы
  'senator', // сенатор Российской Федерации
  'department', // федеральный орган (Правительство, Президент, суды)
  'faction', // фракция
  'regional_organ', // законодательный орган субъекта Российской Федерации
  'federal_organ', // иной федеральный орган
  'other',
]);

/** Созывы Государственной Думы. */
export const refConvocation = legal.table('ref_convocation', {
  id: smallint('id').primaryKey(),
  name: text('name').notNull(),
  dateStart: date('date_start'),
  dateEnd: date('date_end'),
});

/** Стадии рассмотрения законопроекта. */
export const refStage = legal.table('ref_stage', {
  id: smallint('id').primaryKey(),
  name: text('name').notNull(),
  /** Порядковый номер стадии для сортировки хронологии. */
  ordinal: smallint('ordinal'),
});

/** Фазы внутри стадии. */
export const refPhase = legal.table('ref_phase', {
  id: integer('id').primaryKey(),
  stageId: smallint('stage_id').references(() => refStage.id),
  name: text('name').notNull(),
});

/** Тематические блоки законопроектов. */
export const refTopic = legal.table('ref_topic', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});

/**
 * Отрасли законодательства.
 *
 * Соответствуют Классификатору правовых актов, утверждённому Указом
 * Президента Российской Федерации от 15.03.2000 № 511.
 */
export const refLawClass = legal.table('ref_law_class', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  /** Код рубрики классификатора, напр. «030.030.000». */
  classifierCode: text('classifier_code'),
  parentId: integer('parent_id'),
});

/** Комитеты и комиссии Государственной Думы. */
export const refCommittee = legal.table(
  'ref_committee',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    dateStart: date('date_start'),
    dateEnd: date('date_end'),
  },
  (table) => [index('ref_committee_current_idx').on(table.isCurrent)],
);

/** Инстанции рассмотрения: ГД, Совет Федерации, Президент. */
export const refInstance = legal.table('ref_instance', {
  id: smallint('id').primaryKey(),
  name: text('name').notNull(),
});

/** Субъекты права законодательной инициативы (статья 104 Конституции). */
export const subjectOfInitiative = legal.table(
  'subject_of_initiative',
  {
    /** Идентификатор из ИС «Законотворчество». */
    id: bigint('id', { mode: 'number' }).primaryKey(),
    kind: spziKind('kind').notNull(),
    name: text('name').notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    dateStart: date('date_start'),
    dateEnd: date('date_end'),
    /** Фракция депутата. */
    factionId: bigint('faction_id', { mode: 'number' }),
    /** Ответ API целиком — источник истины при изменении схемы. */
    raw: jsonb('raw').default(sql`'{}'::jsonb`).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('spzi_kind_idx').on(table.kind),
    index('spzi_faction_idx').on(table.factionId),
    index('spzi_name_fts_idx').using('gin', sql`to_tsvector('russian', ${table.name})`),
  ],
);

/** Справочник принявших органов (publication.pravo.gov.ru). */
export const refSignatoryAuthority = legal.table('ref_signatory_authority', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  weight: integer('weight'),
});

/** Справочник видов документов (publication.pravo.gov.ru). */
export const refDocumentType = legal.table('ref_document_type', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  weight: integer('weight'),
});

/** Справочник блоков публикации (publication.pravo.gov.ru). */
export const refPublicBlock = legal.table('ref_public_block', {
  id: text('id').primaryKey(),
  code: text('code').unique(),
  name: text('name'),
  shortName: text('short_name'),
  menuName: text('menu_name'),
  parentId: text('parent_id'),
  weight: integer('weight'),
  isBlocked: boolean('is_blocked').default(false).notNull(),
});
