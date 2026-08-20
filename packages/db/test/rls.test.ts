import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.js';

/**
 * Проверка политик разграничения доступа на настоящем PostgreSQL.
 *
 * Тесты запускаются, если задан `TEST_DATABASE_URL` (строка подключения
 * к пустой базе, которую можно пересоздавать). Без него набор пропускается,
 * чтобы `pnpm test` оставался зелёным в средах без базы.
 *
 * Проверяется главное свойство модели: депутат видит ровно то, к чему у него
 * есть основание доступа, и совместная работа депутатов **разных партий**
 * возможна только через явное участие в проекте или явную выдачу доступа.
 */

const TEST_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_URL ? describe : describe.skip;

interface Actors {
  partyA: string;
  partyB: string;
  factionA: string;
  alice: string; // партия A, администратор
  boris: string; // партия A, участник
  viktor: string; // партия B, посторонний
  galina: string; // партия B, приглашена в проект партии A
  projectA: string;
  draftA: string;
}

describeIfDb('политики RLS', () => {
  let sql: postgres.Sql;
  let actors: Actors;

  /** Выполняет запросы от имени пользователя — как это делает PostgREST. */
  async function asUser<T>(
    userId: string,
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    return (await sql.begin(async (tx) => {
      await tx.unsafe(
        `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: 'authenticated' })}', true)`,
      );
      await tx.unsafe('set local role authenticated');
      return fn(tx);
    })) as T;
  }

  beforeAll(async () => {
    await migrate({ dir: join(import.meta.dirname, '..', 'migrations'), url: TEST_URL! });
    sql = postgres(TEST_URL!, { max: 4, onnotice: () => undefined });

    // Набор идемпотентен: база очищается перед наполнением, поэтому
    // повторный запуск на той же базе даёт тот же результат.
    await sql.unsafe(`
      truncate table
        public.audit_log, public.project_share, public.project_member,
        public.draft_suggestion, public.draft_version, public.draft_yjs_update,
        public.draft, public.task_comment, public.task,
        public.message_reaction, public.message,
        public.conversation_participant, public.conversation,
        public.transcript_segment, public.transcript, public.meeting,
        public.asset, public.workflow_step, public.workflow_run,
        public.invitation, public.project,
        public.workgroup_member, public.workgroup,
        public.membership, public.profile, public.organization,
        legal.bill_document, legal.bill_event, legal.bill_initiator,
        legal.bill_committee, legal.bill, legal.ref_convocation
      restart identity cascade
    `);
    await sql.unsafe('delete from auth.users');

    // Сервисная роль пишет в обход RLS — как это делает бэкенд.
    const ids = {
      partyA: randomUUID(),
      partyB: randomUUID(),
      factionA: randomUUID(),
      alice: randomUUID(),
      boris: randomUUID(),
      viktor: randomUUID(),
      galina: randomUUID(),
      projectA: randomUUID(),
      draftA: randomUUID(),
    };

    await sql.begin(async (tx) => {
      for (const id of [ids.alice, ids.boris, ids.viktor, ids.galina]) {
        await tx`insert into auth.users (id) values (${id}) on conflict do nothing`;
      }
      await tx`
        insert into profile (id, full_name) values
          (${ids.alice}, 'Алиса'), (${ids.boris}, 'Борис'),
          (${ids.viktor}, 'Виктор'), (${ids.galina}, 'Галина')
      `;
      await tx`
        insert into organization (id, kind, name, slug) values
          (${ids.partyA}, 'party', 'Партия А', 'party-a'),
          (${ids.partyB}, 'party', 'Партия Б', 'party-b')
      `;
      await tx`
        insert into organization (id, kind, name, slug, parent_id) values
          (${ids.factionA}, 'faction', 'Фракция А', 'faction-a', ${ids.partyA})
      `;
      await tx`
        insert into membership (organization_id, user_id, role, status) values
          (${ids.partyA}, ${ids.alice}, 'admin', 'active'),
          (${ids.partyA}, ${ids.boris}, 'contributor', 'active'),
          (${ids.partyB}, ${ids.viktor}, 'admin', 'active'),
          (${ids.partyB}, ${ids.galina}, 'contributor', 'active')
      `;
      await tx`
        insert into project (id, scope, name, organization_id, owner_id) values
          (${ids.projectA}, 'organization', 'Законопроект партии А', ${ids.partyA}, ${ids.alice})
      `;
      await tx`
        insert into draft (id, project_id, kind, title, created_by) values
          (${ids.draftA}, ${ids.projectA}, 'bill', 'Текст законопроекта', ${ids.alice})
      `;
    });

    actors = ids;
  }, 120_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('участник организации-владельца видит её проект', async () => {
    const rows = await asUser(actors.boris, (tx) => tx`select id from project`);
    expect(rows.map((r) => r['id'])).toContain(actors.projectA);
  });

  it('депутат чужой партии не видит проект', async () => {
    const rows = await asUser(actors.viktor, (tx) => tx`select id from project`);
    expect(rows).toHaveLength(0);
  });

  it('депутат чужой партии не видит документы проекта', async () => {
    const rows = await asUser(actors.viktor, (tx) => tx`select id from draft`);
    expect(rows).toHaveLength(0);
  });

  it('приглашение в проект открывает доступ депутату другой партии', async () => {
    await sql`
      insert into project_member (project_id, user_id, role, is_external)
      values (${actors.projectA}, ${actors.galina}, 'editor', true)
    `;
    const projects = await asUser(actors.galina, (tx) => tx`select id from project`);
    expect(projects.map((r) => r['id'])).toContain(actors.projectA);

    const drafts = await asUser(actors.galina, (tx) => tx`select id from draft`);
    expect(drafts.map((r) => r['id'])).toContain(actors.draftA);

    // Её однопартиец доступа при этом не получает.
    const viktorProjects = await asUser(actors.viktor, (tx) => tx`select id from project`);
    expect(viktorProjects).toHaveLength(0);
  });

  it('выдача доступа организации открывает проект всей партии', async () => {
    await sql`
      insert into project_share (project_id, organization_id, role, granted_by)
      values (${actors.projectA}, ${actors.partyB}, 'viewer', ${actors.alice})
    `;
    const rows = await asUser(actors.viktor, (tx) => tx`select id from project`);
    expect(rows.map((r) => r['id'])).toContain(actors.projectA);
  });

  it('доступ по выдаче организации даёт только чтение', async () => {
    const role = await asUser(
      actors.viktor,
      (tx) => tx`select public.project_role(${actors.projectA}) as role`,
    );
    expect(role[0]!['role']).toBe('viewer');

    await expect(
      asUser(
        actors.viktor,
        (tx) => tx`update draft set title = 'Подмена' where id = ${actors.draftA}`,
      ),
    ).resolves.toHaveLength(0);

    const title = await sql`select title from draft where id = ${actors.draftA}`;
    expect(title[0]!['title']).toBe('Текст законопроекта');
  });

  it('администратор партии наследует доступ к проектам своей фракции', async () => {
    const factionProject = randomUUID();
    await sql`
      insert into project (id, scope, name, organization_id, owner_id)
      values (${factionProject}, 'faction', 'Проект фракции А', ${actors.factionA}, ${actors.alice})
    `;
    const rows = await asUser(actors.alice, (tx) => tx`select id from project`);
    expect(rows.map((r) => r['id'])).toContain(factionProject);

    // Рядовой участник партии не состоит во фракции и проект не видит.
    const borisRows = await asUser(
      actors.boris,
      (tx) => tx`select id from project where id = ${factionProject}`,
    );
    expect(borisRows).toHaveLength(0);
  });

  it('истёкшая выдача доступа перестаёт действовать', async () => {
    const expiredProject = randomUUID();
    await sql`
      insert into project (id, scope, name, organization_id, owner_id)
      values (${expiredProject}, 'organization', 'Истёкший', ${actors.partyA}, ${actors.alice})
    `;
    await sql`
      insert into project_share (project_id, organization_id, role, granted_by, expires_at)
      values (${expiredProject}, ${actors.partyB}, 'viewer', ${actors.alice}, now() - interval '1 day')
    `;
    const rows = await asUser(
      actors.viktor,
      (tx) => tx`select id from project where id = ${expiredProject}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('личный проект депутата не виден его партии', async () => {
    const personal = randomUUID();
    await sql`
      insert into project (id, scope, name, owner_id)
      values (${personal}, 'personal', 'Личный проект Бориса', ${actors.boris})
    `;
    const aliceRows = await asUser(
      actors.alice,
      (tx) => tx`select id from project where id = ${personal}`,
    );
    expect(aliceRows).toHaveLength(0);

    const borisRows = await asUser(
      actors.boris,
      (tx) => tx`select id from project where id = ${personal}`,
    );
    expect(borisRows).toHaveLength(1);
  });

  it('приостановленное членство лишает доступа', async () => {
    await sql`
      update membership set status = 'suspended'
      where organization_id = ${actors.partyA} and user_id = ${actors.boris}
    `;
    const rows = await asUser(
      actors.boris,
      (tx) => tx`select id from project where id = ${actors.projectA}`,
    );
    expect(rows).toHaveLength(0);

    await sql`
      update membership set status = 'active'
      where organization_id = ${actors.partyA} and user_id = ${actors.boris}
    `;
  });

  it('корпус законодательства открыт для чтения всем', async () => {
    await sql`
      insert into legal.ref_convocation (id, name) values (8, 'VIII созыв')
      on conflict do nothing
    `;
    await sql`
      insert into legal.bill (number, convocation, serial_no, name, sozd_url)
      values ('1-8', 8, 1, 'Тестовый законопроект', 'https://sozd.duma.gov.ru/bill/1-8')
      on conflict do nothing
    `;
    const rows = await asUser(actors.viktor, (tx) => tx`select number from legal.bill`);
    expect(rows.map((r) => r['number'])).toContain('1-8');
  });

  it('журнал действий недоступен для изменения из клиента', async () => {
    // Защита двойная: привилегия INSERT отозвана (сработает первой),
    // а политики INSERT для роли authenticated не заведено вовсе.
    await expect(
      asUser(
        actors.alice,
        (tx) =>
          tx`insert into audit_log (actor_id, action, entity_type) values (${actors.alice}, 'test', 'test')`,
      ),
    ).rejects.toThrow(/permission denied|row-level security/iu);

    // Чтение собственных записей журнала при этом разрешено.
    await sql`
      insert into audit_log (actor_id, action, entity_type)
      values (${actors.alice}, 'project.create', 'project')
    `;
    const rows = await asUser(actors.alice, (tx) => tx`select action from audit_log`);
    expect(rows.map((r) => r['action'])).toContain('project.create');
  });

  it('нельзя выдать себе доступ к чужому проекту', async () => {
    await expect(
      asUser(
        actors.viktor,
        (tx) =>
          tx`insert into project_member (project_id, user_id, role) values (${actors.projectA}, ${actors.viktor}, 'owner')`,
      ),
    ).rejects.toThrow(/row-level security|permission denied/iu);
  });
});

/** Проверка разбиения файла миграции на запросы не требует базы. */
describe('splitStatements', () => {
  it('разбивает по маркеру и отбрасывает пустые фрагменты', async () => {
    const { splitStatements } = await import('../src/migrate.js');
    const parts = splitStatements(
      'create table a();--> statement-breakpoint\n\n--> statement-breakpoint\ncreate table b();',
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('create table a');
  });

  it('отбрасывает фрагменты из одних комментариев', async () => {
    const { splitStatements } = await import('../src/migrate.js');
    expect(splitStatements('-- только комментарий\n')).toEqual([]);
  });
});

// выполняется скриптом `scripts/test-db.sh`, который вызывается из CI.
