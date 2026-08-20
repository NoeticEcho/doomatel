import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Модель организаций и доступа.
 *
 * Иерархия: партия → фракция → рабочая группа → проект → документ.
 * Депутат может состоять более чем в одной структуре (например, во фракции
 * и в межфракционной рабочей группе), поэтому членство вынесено в отдельную
 * таблицу, а не выражено полем в профиле.
 *
 * Доступ к данным ограничивается политиками RLS (см. `migrations/*_rls.sql`).
 * Записи в базу выполняет только сервис NestJS с сервисной ролью; RLS —
 * второй рубеж защиты на случай ошибки в прикладном коде и обязательное
 * условие для прямых запросов из браузера через PostgREST.
 */

/**
 * Таблица `auth.users` принадлежит Supabase Auth и здесь не объявляется:
 * иначе миграция попыталась бы её создать. Внешний ключ
 * `profile.id → auth.users.id` добавляется отдельной миграцией
 * `0002_auth_link.sql`, которая пропускает его, если схемы `auth` нет
 * (вариант развёртывания без Supabase).
 */

/** Вид организации. */
export const organizationKind = pgEnum('organization_kind', [
  'party', // политическая партия
  'faction', // фракция в Государственной Думе
  'committee', // комитет
  'apparatus', // аппарат
  'expert', // экспертная организация
  'independent', // объединение независимых депутатов
]);

/** Область действия проекта. */
export const projectScope = pgEnum('project_scope', [
  'organization', // проект партии
  'faction', // проект фракции
  'workgroup', // проект рабочей группы
  'personal', // личный проект депутата
]);

/**
 * Роли. Порядок соответствует убыванию полномочий и используется
 * в функции `public.role_at_least`.
 */
export const memberRole = pgEnum('member_role', [
  'owner', // полный контроль, включая удаление
  'admin', // управление участниками и настройками
  'editor', // изменение содержимого
  'contributor', // создание своего содержимого, комментарии
  'reviewer', // комментарии и предложения правок без прямого изменения
  'viewer', // только чтение
]);

export const membershipStatus = pgEnum('membership_status', [
  'invited',
  'active',
  'suspended',
  'left',
]);

/** Организация: партия, фракция, комитет, экспертный центр. */
export const organization = pgTable(
  'organization',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: organizationKind('kind').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    slug: text('slug').notNull().unique(),
    /** Родительская организация: фракция принадлежит партии. */
    parentId: uuid('parent_id'),
    /** Созыв, к которому относится фракция. */
    convocation: smallint('convocation'),
    /** Идентификатор в справочнике СПЗИ ИС «Законотворчество». */
    dumaSubjectId: text('duma_subject_id'),
    description: text('description'),
    settings: jsonb('settings').default(sql`'{}'::jsonb`).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('organization_parent_idx').on(table.parentId),
    index('organization_kind_idx').on(table.kind),
  ],
);

/**
 * Профиль пользователя — расширение `auth.users`.
 *
 * Статус депутата подтверждается администратором организации: самостоятельная
 * регистрация даёт роль `viewer` и статус `invited` до подтверждения.
 */
export const profile = pgTable(
  'profile',
  {
    /** Совпадает с `auth.users.id` в Supabase. */
    id: uuid('id').primaryKey(),
    fullName: text('full_name').notNull(),
    displayName: text('display_name'),
    email: text('email'),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    /** Должность: «депутат Государственной Думы», «помощник депутата». */
    position: text('position'),
    /** Идентификатор депутата в ИС «Законотворчество», если сопоставлен. */
    dumaDeputyId: text('duma_deputy_id'),
    /** Подтверждён ли статус депутата администратором. */
    isVerified: boolean('is_verified').default(false).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by'),
    locale: text('locale').default('ru').notNull(),
    settings: jsonb('settings').default(sql`'{}'::jsonb`).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('profile_duma_deputy_idx').on(table.dumaDeputyId),
    index('profile_name_fts_idx').using('gin', sql`to_tsvector('russian', ${table.fullName})`),
  ],
);

/** Членство пользователя в организации. */
export const membership = pgTable(
  'membership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    role: memberRole('role').default('viewer').notNull(),
    status: membershipStatus('status').default('invited').notNull(),
    invitedBy: uuid('invited_by'),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('membership_unique').on(table.organizationId, table.userId),
    index('membership_user_idx').on(table.userId, table.status),
    index('membership_org_idx').on(table.organizationId, table.status),
  ],
);

/**
 * Рабочая группа. Может быть межфракционной: участники добавляются
 * независимо от их организации, поэтому у группы есть собственный список
 * участников, а не наследуемый от организации.
 */
export const workgroup = pgTable(
  'workgroup',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    /** Организация-учредитель. Для межфракционных групп — инициатор. */
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    /** Открыта ли группа для участников из других организаций. */
    isCrossOrganization: boolean('is_cross_organization').default(false).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profile.id),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('workgroup_org_idx').on(table.organizationId)],
);

export const workgroupMember = pgTable(
  'workgroup_member',
  {
    workgroupId: uuid('workgroup_id')
      .notNull()
      .references(() => workgroup.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    role: memberRole('role').default('contributor').notNull(),
    status: membershipStatus('status').default('active').notNull(),
    addedBy: uuid('added_by').references(() => profile.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workgroupId, table.userId] }),
    index('workgroup_member_user_idx').on(table.userId),
  ],
);

/**
 * Проект — единица законотворческой работы: подготовка законопроекта,
 * сопровождение внесённого законопроекта, аналитическая работа.
 */
export const project = pgTable(
  'project',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: projectScope('scope').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Владелец-организация для scope `organization` и `faction`. */
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    /** Владелец-группа для scope `workgroup`. */
    workgroupId: uuid('workgroup_id').references(() => workgroup.id, { onDelete: 'cascade' }),
    /** Владелец-пользователь для scope `personal`. */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'restrict' }),
    /** Сопровождаемый законопроект, если проект привязан к внесённому. */
    billNumber: text('bill_number'),
    status: text('status').default('active').notNull(),
    /** Стадия законотворческого процесса, на которой находится проект. */
    stage: text('stage'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    settings: jsonb('settings').default(sql`'{}'::jsonb`).notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('project_org_idx').on(table.organizationId),
    index('project_workgroup_idx').on(table.workgroupId),
    index('project_owner_idx').on(table.ownerId),
    index('project_bill_idx').on(table.billNumber),
    index('project_name_fts_idx').using('gin', sql`to_tsvector('russian', ${table.name})`),
  ],
);

/**
 * Участник проекта.
 *
 * Именно эта таблица делает возможной совместную работу депутатов **разных**
 * партий и фракций: право доступа определяется прямым членством в проекте,
 * а не принадлежностью к организации-владельцу.
 */
export const projectMember = pgTable(
  'project_member',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    role: memberRole('role').default('contributor').notNull(),
    /** Приглашён из другой организации — отображается в интерфейсе. */
    isExternal: boolean('is_external').default(false).notNull(),
    addedBy: uuid('added_by').references(() => profile.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index('project_member_user_idx').on(table.userId),
  ],
);

/**
 * Предоставление доступа к проекту целой организации или рабочей группе —
 * без перечисления каждого участника поимённо.
 */
export const projectShare = pgTable(
  'project_share',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    workgroupId: uuid('workgroup_id').references(() => workgroup.id, { onDelete: 'cascade' }),
    role: memberRole('role').default('viewer').notNull(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => profile.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('project_share_project_idx').on(table.projectId),
    index('project_share_org_idx').on(table.organizationId),
    index('project_share_workgroup_idx').on(table.workgroupId),
    unique('project_share_org_unique').on(table.projectId, table.organizationId),
    unique('project_share_workgroup_unique').on(table.projectId, table.workgroupId),
  ],
);

/** Приглашение в организацию, рабочую группу или проект. */
export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    workgroupId: uuid('workgroup_id').references(() => workgroup.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    role: memberRole('role').default('viewer').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => profile.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => profile.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('invitation_email_idx').on(table.email)],
);

/**
 * Журнал действий.
 *
 * Обязателен для государственного контура: фиксирует, кто и когда получил
 * доступ к сведениям и изменил их. Запись выполняется триггерами и сервисом,
 * изменение и удаление записей запрещены политиками RLS.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => profile.id, { onDelete: 'set null' }),
    /** Действие: `project.create`, `document.export`, `member.role_change`. */
    action: text('action').notNull(),
    /** Вид объекта и его идентификатор. */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Изменения: `{ before, after }`. */
    payload: jsonb('payload').default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_actor_idx').on(table.actorId, table.createdAt),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_project_idx').on(table.projectId, table.createdAt),
  ],
);
