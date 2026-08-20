# 07 — Platform layer: Supabase + NestJS + Next.js

**Scope.** Self-hosting, multi-tenancy & RLS, auth & РФ-compliance, NestJS↔Supabase
integration, realtime/chat, storage & ingestion, background jobs, observability.

**Verification legend**

| Tag | Meaning |
|---|---|
| `[V-doc]` | Seen in official documentation / repo file, URL cited |
| `[V-npm]` | Confirmed via `npm view <pkg> version` on 2026-08-20 |
| `[V-src]` | Confirmed by reading a file in the upstream repo (raw.githubusercontent.com) |
| `[UNVERIFIED]` | Inference or design proposal — **not** confirmed by a source |

> Everything under §2, §5 (chat DDL) and §4 (Nest patterns) is **design work by me**
> — it is grounded in verified primitives but is not copied from any source.
> Treat the SQL as a reviewed-but-untested first draft: it must be run against a real
> Postgres 17 + `pgTAP` suite before it is trusted.

---

## 0. Executive recommendation (TL;DR)

| Question | Decision | Confidence |
|---|---|---|
| Self-host Supabase on-prem in РФ? | **Yes.** All components Apache-2.0 / MIT / PostgreSQL licence, no phone-home required. | high `[V-src]` |
| Which Supabase parts do we actually use? | **Postgres + GoTrue (Auth) + Realtime + Storage.** Skip PostgREST-as-public-API, skip Edge Functions, skip Studio in prod, keep Supavisor. | high |
| Who writes to the DB? | **NestJS only**, via a direct `pg` pool as a privileged role. **RLS is defence-in-depth**, not the primary authorisation layer. | high |
| Query builder on the Nest side | **Drizzle** (already vendored, `drizzle-orm@0.45.2`) — it is the only one of the three that can *emit* RLS policies into migrations. | high `[V-npm]`+`[V-doc]` |
| JWT verification in Nest | **Asymmetric (RS256/ES256) via JWKS**, `passport-jwt` + `jwks-rsa`. Do **not** ship `SUPABASE_JWT_SECRET` to services. | high `[V-doc]` |
| Chat & presence transport | **Supabase Realtime private channels** (`broadcast` + `presence`), *not* a Nest socket.io gateway, *not* `postgres_changes`. | medium-high |
| Object storage | **MinIO (S3) behind NestJS-issued pre-signed URLs**, not Supabase Storage. Already in `infra/docker-compose.yml`. | medium-high |
| Job queue | **BullMQ + Redis** for the hot path (already in compose) + **pg_cron** for schedule triggers. `pg-boss` as the fallback if we drop Redis. | medium |
| Long agent runs | Not a queue problem — use **Mastra `suspend`/`resume` + a `workflow_run` row** (see `03-mastra.md` §2.5.1), with BullMQ only as the *executor*. | medium |
| Observability | **OpenTelemetry as the wire format → Langfuse (self-hosted) as the LLM-trace backend.** Mastra's built-in exporter speaks OTel. | high |

**Two things in the current repo need changing:**

1. `infra/docker-compose.yml` pins `langfuse/langfuse:2`. Langfuse **v2 is superseded**;
   current tags are `4.15` / `3.225` `[V-src, Docker Hub]`. v3+ requires **ClickHouse +
   Redis + S3**, which is a materially bigger footprint than the single-Postgres v2. See §8.
2. The `standalone` profile uses `pgvector/pgvector:pg17`. If we go Supabase, the
   authoritative image is **`supabase/postgres:17.6.1.165`** which already ships
   `vector 0.8.2`, `pg_cron 1.6.4`, `pgmq 1.5.1`, `pgaudit 17.1`, `pgroonga 3.2.5`,
   `rum 1.3`, `pg_partman 5.3.1` `[V-src]` — see §1.3. Do not maintain two Postgres images.

---

## 1. Supabase self-hosting

### 1.1 Licensing — data sovereignty is legally clear

Fetched `LICENSE` from each upstream repo on 2026-08-20 `[V-src]`:

| Component | Repo | Licence |
|---|---|---|
| Supabase monorepo (Studio, docs, docker/) | `supabase/supabase` | **Apache 2.0** |
| Auth (GoTrue fork) | `supabase/auth` | **MIT** (`Copyright (c) 2021-2025 Supabase`) |
| Realtime (Elixir/Phoenix) | `supabase/realtime` | **Apache 2.0** |
| Storage API | `supabase/storage` | **Apache 2.0** |
| Supavisor (pooler) | `supabase/supavisor` | **Apache 2.0** |
| PostgREST | `PostgREST/postgrest` | **MIT** |
| pgmq | `pgmq/pgmq` | **PostgreSQL License** |
| pg-boss | `timgit/pg-boss` | **MIT** |
| BullMQ | `taskforcesh/bullmq` | **MIT** |

Consequences:

* No copyleft obligation, no source-disclosure obligation, no per-seat licence,
  no network-callback, no licence key. **A fully air-gapped on-prem install in РФ is
  permitted by the licences.** This is the single most important finding for this project.
* Langfuse is the exception — see §8.1, its `LICENSE` reads
  `Copyright (c) 2023-2026 ClickHouse, Inc. Portions of this software are licensed as follows:`
  i.e. **MIT core + a proprietary `/ee` directory** `[V-src]`.
* Caveat `[UNVERIFIED]`: licence permissiveness ≠ *regulatory* admissibility.
  Foreign OSS is not in the **реестр отечественного ПО**; if Doomatel is ever classified
  as a **ГИС**, that matters. See §3.5.

### 1.2 What the self-host compose actually contains

From `supabase/supabase/docker/docker-compose.yml` as documented `[V-doc]`
https://supabase.com/docs/guides/self-hosting/docker :

| Service | Image | Route via gateway | Keep for Doomatel? |
|---|---|---|---|
| **Postgres** | `supabase/postgres` | `:5432` | **Yes — this is the core** |
| **Supavisor** | `supabase/supavisor` | `:5432` (session) / `:6543` (txn) | **Yes** |
| **Auth (GoTrue)** | `supabase/auth` | `/auth/v1` | **Yes** |
| **Realtime** | `supabase/realtime` | `/realtime/v1` | **Yes** |
| **Storage** | `supabase/storage` | `/storage/v1` | Optional — see §6 |
| **imgproxy** | `imgproxy/imgproxy` | internal | Only if Storage kept |
| **PostgREST** | `postgrest/postgrest` | `/rest/v1` | **Internal only**, never public |
| **Edge Runtime** | `supabase/edge-runtime` | `/functions/v1` | **No** — Nest is our compute |
| **postgres-meta** | `supabase/postgres-meta` | internal | Only with Studio |
| **Studio** | `supabase/studio` | `:8000` | Dev/staging only, never prod-public |
| **Envoy** (was Kong) | `envoyproxy/envoy` | `:8000` | Yes — single ingress |
| Logflare + Vector | analytics | opt-in | **No** — we use OTel (§8) |

**Required secrets** `[V-doc]`: `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`,
`SERVICE_ROLE_KEY`, `SECRET_KEY_BASE` (≥64 chars, Realtime/Supavisor),
`VAULT_ENC_KEY` (exactly 32 chars, Supavisor), `DASHBOARD_PASSWORD`,
`REALTIME_DB_ENC_KEY`, `PG_META_CRYPTO_KEY`, plus S3 credentials for Storage.

**Not included in self-host by default** `[V-doc]`: Logs & Analytics (Logflare+Vector must
be explicitly enabled), automated backups, read replicas, the Supabase branching/preview
system, and cloud-only quota features. All of those are our own operational problem.

### 1.3 Extensions actually shipped in `supabase/postgres` — VERIFIED

Read from `supabase/postgres@develop:nix/ext/versions.json` `[V-src]`
(latest version per extension; current image tag `17.6.1.165`, from Docker Hub `[V-src]`):

```
http 1.6.1            hypopg 1.4.1          index_advisor 0.2.0   pg_cron 1.6.4
pg_graphql 1.6.1      pg_hashids 1.3.0      pg_jsonschema 0.3.3   pg_net 0.20.4
pg_partman 5.3.1      pg_plan_filter 0.1    pg_repack 1.5.2       pg_stat_monitor 2.1
pg_tle 1.4.0          pgaudit 17.1          pgjwt 0.2.0           pgmq 1.5.1
pgroonga 3.2.5        pgrouting 3.4.1       pgsodium 3.1.8        pgtap 1.3.3
plpgsql_check 2.8     plv8 3.1.10           postgis 3.3.7         rum 1.3
safeupdate 1.4        supabase_vault 0.3.1  timescaledb 2.16.1    vector 0.8.2
wal2json 2.6          wrappers 0.6.2
```

Four of these matter disproportionately to Doomatel:

* **`pgaudit 17.1`** — session/object-level audit logging at the *engine* level. This is the
  cheapest credible answer to «журналирование доступа к ПДн» in §3.4. Our application-level
  `public.audit_log` table records *business* events; `pgaudit` records *every statement*.
  Both are needed for a ГИС-grade audit story.
* **`pgroonga 3.2.5` + `rum 1.3`** — real Russian morphological / trigram search beyond
  `to_tsvector('russian', …)`. `04-retrieval.md` §4 chose the lexical strategy; if that
  doc assumed plain `tsvector`, these two are worth re-evaluating — **they are free here.**
* **`pgmq 1.5.1`** — Postgres-native queue. Relevant to §7.
* **`pg_partman 5.3.1`** — declarative time partitioning. Use it for `audit_log`,
  `message`, and `workflow_step`, all of which grow without bound.

`pgtap 1.3.3` is the test harness for the RLS suite in §2.8 — no extra install needed.

### 1.4 Recommended topology

```
                    ┌─────────────────────────────────────────┐
  browser ─TLS──────▶  Next.js (SSR, @supabase/ssr cookies)   │
                    └───────────┬──────────────┬──────────────┘
                                │ REST/SSE     │ WSS
                                ▼              ▼
                    ┌───────────────────┐  ┌──────────────────────┐
                    │  NestJS API       │  │ Envoy (Supabase edge)│
                    │  (the only writer)│  │  /auth/v1  → GoTrue  │
                    └────┬────────┬─────┘  │  /realtime/v1 → RT   │
                         │        │        └──────────┬───────────┘
              pg pool    │        │ service-role JWT  │
              (app_api)  │        └───────────────────┤
                         ▼                            ▼
                    ┌──────────────────────────────────────────┐
                    │ Postgres 17 (supabase/postgres) + RLS    │
                    └──────────────────────────────────────────┘
                         │            │              │
                    Qdrant       MinIO (S3)      Redis (BullMQ)
```

Key point: **PostgREST is not exposed to the browser.** The browser talks to
Next.js/Nest for data and to Supabase Realtime for events. That single decision removes
the class of bugs where a missing RLS policy becomes a data breach, while keeping RLS as
the second wall.

---

## 2. Multi-tenancy and RLS

### 2.1 The hierarchy, and why it is not a tree

The requested model is `Организация(Партия) → Фракция → Рабочая группа → Проект → Документ`.
The schema already in `packages/db/src/schema/tenancy.ts` correctly refuses to model this
as a strict tree, and that is the right call. Three facts break the tree:

1. **Независимые депутаты** have no партия. They must own `project.scope = 'personal'`
   projects with `organization_id IS NULL`.
2. **Межфракционные рабочие группы** (`workgroup.is_cross_organization`) contain deputies
   from several партии at once. Group membership cannot be derived from org membership.
3. **Cross-party project sharing** — the genuinely hard case — means a project owned by
   Фракция A must be readable by named individuals, *or whole orgs*, from Фракция B,
   at a role that may be **lower** than the role those people hold in their own org.

So the access graph is: **a project is reachable by four independent paths**, and the
effective role is the **maximum** over all paths that apply.

```
                     ┌── path 1: project.owner_id = me            (personal ownership)
                     ├── path 2: project_member(project, me)      (named individual; CROSS-ORG)
project visible ─────┤
                     ├── path 3: project_share → organization O,  me ∈ active members of O
                     │                                            (whole-org grant; CROSS-ORG)
                     ├── path 4: project_share → workgroup W,     me ∈ active members of W
                     └── path 5: project.organization_id ∈ upward-closure(my orgs)
                                 or project.workgroup_id ∈ my workgroups   (implicit/ownership)
```

Paths 3 and 4 carry `expires_at` — an expired share must evaluate to *no access*, not to
a stale role.

### 2.2 The "upward closure" rule for org inheritance

`organization.parent_id` gives Партия → Фракция. Question: should a Фракция member see a
Партия-level project?

**Decision: yes, by default, via *upward* closure.** A user who is an active member of
Фракция F gets the scope set `{F, parent(F), parent(parent(F)), …}`. A project owned by
Партия P is then visible to every member of every фракция under P. The reverse does **not**
hold: a Партия-level member does **not** automatically see Фракция-level projects, because
фракция work is frequently confidential from the party apparatus.

If a specific партия wants strict isolation, gate it with a flag rather than changing the
algorithm — `organization.settings->>'inherit_down' = 'false'` stops the closure at that node.
The SQL below implements the closure; the flag is left as a TODO marker `[UNVERIFIED]` because
it is a product decision, not a technical one.

### 2.3 The recursion trap — and the exact fix

This is the failure mode that kills naive multi-tenant RLS, and it has a subtle second half.

**Half one.** A policy on `public.project_member` that reads `public.project_member`
(«can I see the other members of a project I belong to?») makes Postgres re-evaluate the
same policy for the inner query → `ERROR: infinite recursion detected in policy for
relation "project_member"`.

The standard fix is a `SECURITY DEFINER` function: it executes as its owner, and RLS is not
applied to a table owned by the role that owns the function (barring `FORCE ROW LEVEL SECURITY`).

**Half two — the part that is usually missed.** If you write that helper as
`LANGUAGE sql`, Postgres may **inline** it during planning. An inlined function body loses
the `SECURITY DEFINER` boundary, RLS applies to the inner query again, and the recursion
comes back — intermittently, depending on the plan. `[V-doc]`
https://dev.to/bairescodeai/infinite-recursion-in-postgres-rls-a-security-definer-gotcha-1916

**Therefore every RLS helper in this codebase must be:**

```sql
LANGUAGE plpgsql          -- plpgsql is never inlined
SECURITY DEFINER
STABLE                    -- allows InitPlan caching; not IMMUTABLE (it reads tables)
SET search_path = ''      -- mandatory: unqualified names in a DEFINER function are a
                          -- privilege-escalation vector (attacker-controlled search_path)
```

and every reference inside must be schema-qualified (`public.project_member`, not
`project_member`). Supabase's own RBAC guide uses exactly this signature `[V-doc]`
https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac .

### 2.4 The performance trap — and the exact fix

A policy shaped `USING (EXISTS (SELECT 1 FROM … WHERE project_id = project.id))` runs the
subquery **once per candidate row**. On a `draft` table with 10⁵ rows that is 10⁵ subqueries
to return 20. Reported slowdowns are 2×–11× on large tables `[V-doc]`
https://supabase.com/docs/guides/database/postgres/row-level-security .

Two mitigations, both used below:

1. **Wrap non-correlated calls in `(select …)`.** Postgres hoists them to an **InitPlan**,
   evaluated once per statement. This is why Supabase docs insist on `(select auth.uid())`
   rather than bare `auth.uid()` `[V-doc]`.
2. **Return a set/array, not a per-row boolean.** For `SELECT` policies use
   `id = ANY ((select app.visible_project_ids()))` — one evaluation, then an array
   membership test per row. For a deputy the visible-project count is O(10²), so the
   array is tiny. Per-row `app.project_role(id)` is reserved for `INSERT`/`UPDATE`/`DELETE`,
   where the row count is 1. **This two-tier split is the central performance idea of this design.**

### 2.5 Helper functions — full SQL

Helpers live in a private `app` schema so they are **not reachable as PostgREST RPC**
(PostgREST only exposes schemas listed in `PGRST_DB_SCHEMAS`, default `public,graphql_public`).

```sql
-- ============================================================================
-- 0000_rls_helpers.sql
-- ============================================================================
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ранг роли. member_role объявлен по убыванию полномочий:
--   owner(1) admin(2) editor(3) contributor(4) reviewer(5) viewer(6)
-- Меньший ранг = больше прав.
-- ---------------------------------------------------------------------------
create or replace function app.role_rank(r public.member_role)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array_position(enum_range(null::public.member_role), r);
$$;
-- ^ здесь LANGUAGE sql безопасен: функция не читает таблиц и не является
--   SECURITY DEFINER, инлайнинг только ускоряет её.

create or replace function app.role_at_least(actual public.member_role,
                                             required public.member_role)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select actual is not null and app.role_rank(actual) <= app.role_rank(required);
$$;

create or replace function app.role_max(a public.member_role, b public.member_role)
returns public.member_role
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when a is null then b
    when b is null then a
    when app.role_rank(a) <= app.role_rank(b) then a
    else b
  end;
$$;
```

```sql
-- ---------------------------------------------------------------------------
-- Восходящее замыкание организаций пользователя:
--   каждая организация с активным членством + все её предки.
-- SECURITY DEFINER — иначе политика на public.membership вызовет рекурсию.
-- ---------------------------------------------------------------------------
create or replace function app.user_org_scope(p_uid uuid default null)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := coalesce(p_uid, auth.uid());
  v_ids uuid[];
begin
  if v_uid is null then
    return '{}'::uuid[];
  end if;

  with recursive direct as (
    select m.organization_id as id
    from public.membership m
    where m.user_id = v_uid
      and m.status = 'active'
  ),
  climb as (
    select d.id, 0 as depth from direct d
    union all
    select o.parent_id, c.depth + 1
    from climb c
    join public.organization o on o.id = c.id
    where o.parent_id is not null
      and c.depth < 8                      -- страховка от цикла в parent_id
  )
  select array_agg(distinct id) into v_ids from climb where id is not null;

  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;

-- Нисходящее замыкание — нужно администратору партии для управления фракциями.
create or replace function app.org_subtree(p_root uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_ids uuid[];
begin
  with recursive down as (
    select p_root as id, 0 as depth
    union all
    select o.id, d.depth + 1
    from public.organization o
    join down d on o.parent_id = d.id
    where d.depth < 8
  )
  select array_agg(distinct id) into v_ids from down;
  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;

create or replace function app.user_workgroup_ids(p_uid uuid default null)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := coalesce(p_uid, auth.uid());
  v_ids uuid[];
begin
  if v_uid is null then return '{}'::uuid[]; end if;
  select array_agg(wm.workgroup_id) into v_ids
  from public.workgroup_member wm
  where wm.user_id = v_uid and wm.status = 'active';
  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;
```

**The load-bearing function** — it encodes all five access paths, including cross-org sharing:

```sql
-- ---------------------------------------------------------------------------
-- Эффективная роль пользователя в проекте: максимум по всем путям доступа.
-- Единственный источник истины. Всё остальное — обёртки над ней.
-- ---------------------------------------------------------------------------
create or replace function app.project_role(p_project uuid, p_uid uuid default null)
returns public.member_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := coalesce(p_uid, auth.uid());
  v_role  public.member_role;
  v_p     public.project%rowtype;
  v_orgs  uuid[];
  v_wgs   uuid[];
begin
  if v_uid is null or p_project is null then
    return null;
  end if;

  select * into v_p from public.project where id = p_project;
  if not found or v_p.archived_at is not null then
    return null;                       -- архив читается только через сервисную роль
  end if;

  -- путь 1: личное владение
  if v_p.owner_id = v_uid then
    return 'owner'::public.member_role;
  end if;

  -- путь 2: поимённое членство в проекте (сюда попадают депутаты ДРУГИХ фракций)
  select pm.role into v_role
  from public.project_member pm
  where pm.project_id = p_project and pm.user_id = v_uid;

  v_orgs := app.user_org_scope(v_uid);
  v_wgs  := app.user_workgroup_ids(v_uid);

  -- путь 5: неявный доступ владеющей структуры
  if v_p.organization_id is not null and v_p.organization_id = any (v_orgs) then
    -- роль в проекте наследуется от роли в организации
    v_role := app.role_max(v_role, (
      select max_role.role from (
        select m.role
        from public.membership m
        where m.user_id = v_uid
          and m.status = 'active'
          and m.organization_id = any (app.org_subtree(v_p.organization_id))
        order by app.role_rank(m.role)
        limit 1
      ) as max_role
    ));
  end if;

  if v_p.workgroup_id is not null and v_p.workgroup_id = any (v_wgs) then
    v_role := app.role_max(v_role, (
      select wm.role from public.workgroup_member wm
      where wm.workgroup_id = v_p.workgroup_id and wm.user_id = v_uid
    ));
  end if;

  -- пути 3 и 4: делегирование целой организации или рабочей группе.
  -- ЭТО И ЕСТЬ МЕЖПАРТИЙНЫЙ ДОСТУП. Срок действия проверяется здесь,
  -- а не в политике, — иначе просроченная выдача осталась бы рабочей.
  -- ВНИМАНИЕ: скалярный подзапрос, а НЕ `select ... into v_role from (...)`.
  -- Форма с FROM обнулила бы v_role, если выдач нет (SELECT INTO без строк даёт NULL),
  -- стерев роль, полученную по путям 2 и 5.
  v_role := app.role_max(v_role, (
    select ps.role
    from public.project_share ps
    where ps.project_id = p_project
      and (ps.expires_at is null or ps.expires_at > now())
      and (
           (ps.organization_id is not null and ps.organization_id = any (v_orgs))
        or (ps.workgroup_id    is not null and ps.workgroup_id    = any (v_wgs))
      )
    order by app.role_rank(ps.role)
    limit 1
  ));

  return v_role;
end;
$$;
```

> **Note on path 5 + `org_subtree`.** A user who is `admin` of Партия P and the project is
> owned by Фракция F under P: `v_p.organization_id = F`, and `F ∈ user_org_scope` only if
> the user is an active member of F **or** of something under F. Membership in P alone does
> *not* put F into the scope (the closure runs upward). This is the intended
> «партия не читает фракцию автоматически» rule from §2.2.

The `SELECT`-side wrapper — **the array trick from §2.4**:

```sql
create or replace function app.visible_project_ids(p_uid uuid default null)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := coalesce(p_uid, auth.uid());
  v_orgs uuid[];
  v_wgs  uuid[];
  v_ids  uuid[];
begin
  if v_uid is null then return '{}'::uuid[]; end if;
  v_orgs := app.user_org_scope(v_uid);
  v_wgs  := app.user_workgroup_ids(v_uid);

  select array_agg(distinct p.id) into v_ids
  from public.project p
  where p.archived_at is null
    and (
         p.owner_id = v_uid                                              -- путь 1
      or exists (select 1 from public.project_member pm                   -- путь 2
                  where pm.project_id = p.id and pm.user_id = v_uid)
      or (p.organization_id is not null and p.organization_id = any (v_orgs))  -- путь 5a
      or (p.workgroup_id    is not null and p.workgroup_id    = any (v_wgs))   -- путь 5b
      or exists (select 1 from public.project_share ps                    -- пути 3, 4
                  where ps.project_id = p.id
                    and (ps.expires_at is null or ps.expires_at > now())
                    and ( (ps.organization_id is not null and ps.organization_id = any (v_orgs))
                       or (ps.workgroup_id    is not null and ps.workgroup_id    = any (v_wgs)) ))
    );

  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;

grant execute on function
  app.role_rank(public.member_role),
  app.role_at_least(public.member_role, public.member_role),
  app.role_max(public.member_role, public.member_role),
  app.user_org_scope(uuid),
  app.org_subtree(uuid),
  app.user_workgroup_ids(uuid),
  app.project_role(uuid, uuid),
  app.visible_project_ids(uuid)
to authenticated, service_role;
```

> **Security note.** `app.project_role(p_project, p_uid)` takes an explicit `p_uid`. Because
> the function is `SECURITY DEFINER`, an authenticated caller could pass *someone else's*
> uid and learn their role. That is an information leak. **Mitigation:** either drop the
> `p_uid` parameter from the `authenticated` grant (grant only the 1-arg overload) or add a
> guard `if p_uid is not null and p_uid <> auth.uid() and not app.is_platform_admin() then
> raise exception 'forbidden'; end if;`. The second is implemented in §2.9. Supabase's own
> docs flag exactly this class of bug `[V-doc]`.

### 2.6 Policies — full SQL

```sql
-- ============================================================================
-- 0001_rls_policies.sql
-- ============================================================================

-- Роль, под которой работает NestJS. НЕ superuser, НЕ владелец таблиц,
-- но с BYPASSRLS — приложение само проверяет права, RLS остаётся вторым рубежом
-- для PostgREST/Realtime/аналитики.
-- ВАЖНО: см. §4.3 — рекомендуется НЕ давать BYPASSRLS, а использовать
-- app.assume(uid) и оставить RLS включённым даже для сервиса.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api login;
  end if;
end
$$;
grant usage on schema public, app to app_api;
grant select, insert, update, delete on all tables in schema public to app_api;

alter table public.organization        enable row level security;
alter table public.profile             enable row level security;
alter table public.membership          enable row level security;
alter table public.workgroup           enable row level security;
alter table public.workgroup_member    enable row level security;
alter table public.project             enable row level security;
alter table public.project_member      enable row level security;
alter table public.project_share       enable row level security;
alter table public.invitation          enable row level security;
alter table public.audit_log           enable row level security;
alter table public.draft               enable row level security;
alter table public.asset               enable row level security;
alter table public.conversation        enable row level security;
alter table public.conversation_participant enable row level security;
alter table public.message             enable row level security;
alter table public.message_reaction    enable row level security;
```

**`project` — the four paths collapse into one predicate:**

```sql
create policy project_select on public.project
for select to authenticated
using ( id = any ((select app.visible_project_ids())) );

-- Создавать проект может любой подтверждённый депутат; личный — всегда,
-- проектный уровень организации — только editor и выше в этой организации.
create policy project_insert on public.project
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (select p.is_verified from public.profile p where p.id = (select auth.uid()))
  and (
    (scope = 'personal' and organization_id is null and workgroup_id is null)
    or (organization_id is not null
        and app.role_at_least(app.org_role(organization_id), 'editor'))
    or (workgroup_id is not null
        and app.role_at_least(app.workgroup_role(workgroup_id), 'editor'))
  )
);

create policy project_update on public.project
for update to authenticated
using      ( app.role_at_least(app.project_role(id), 'admin') )
with check ( app.role_at_least(app.project_role(id), 'admin') );

create policy project_delete on public.project
for delete to authenticated
using ( app.project_role(id) = 'owner' );
```

**`project_member` — the recursion case.** Note that the policy on this table never
selects from this table directly; it delegates to the `DEFINER` helper.

```sql
create policy project_member_select on public.project_member
for select to authenticated
using ( project_id = any ((select app.visible_project_ids())) );

-- Добавлять/убирать участников — admin проекта и выше.
-- WITH CHECK на INSERT предотвращает выдачу роли выше собственной:
-- admin не может назначить owner.
create policy project_member_write on public.project_member
for all to authenticated
using      ( app.role_at_least(app.project_role(project_id), 'admin') )
with check ( app.role_at_least(app.project_role(project_id), 'admin')
             and app.role_rank(role) >= app.role_rank(app.project_role(project_id)) );
```

**`project_share` — the межпартийная выдача. This is the table that must be hardest to write to.**

```sql
create policy project_share_select on public.project_share
for select to authenticated
using ( project_id = any ((select app.visible_project_ids())) );

-- Выдать доступ ЧУЖОЙ организации может только owner проекта — не admin.
-- Это осознанное ужесточение: межпартийная выдача — политическое решение.
create policy project_share_insert on public.project_share
for insert to authenticated
with check (
  app.project_role(project_id) = 'owner'
  and granted_by = (select auth.uid())
  -- нельзя выдать роль выше editor: внешняя организация не управляет проектом
  and app.role_rank(role) >= app.role_rank('editor'::public.member_role)
  -- ровно одна цель
  and (organization_id is null) <> (workgroup_id is null)
);

create policy project_share_delete on public.project_share
for delete to authenticated
using ( app.project_role(project_id) = 'owner' );

-- UPDATE запрещён намеренно: отозвать и выдать заново, чтобы в audit_log
-- осталось два различимых события.
```

**`membership` — the second recursion case.**

```sql
-- Свои членства видны всегда; чужие — только если ты член той же организации
-- или её предка (управленческая видимость сверху вниз).
create or replace function app.manageable_org_ids(p_uid uuid default null)
returns uuid[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := coalesce(p_uid, auth.uid());
  v_ids uuid[];
begin
  if v_uid is null then return '{}'::uuid[]; end if;
  select array_agg(distinct s.id) into v_ids
  from public.membership m
  cross join lateral unnest(app.org_subtree(m.organization_id)) as s(id)
  where m.user_id = v_uid and m.status = 'active';
  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;

create policy membership_select on public.membership
for select to authenticated
using (
  user_id = (select auth.uid())
  or organization_id = any ((select app.manageable_org_ids()))
);

create policy membership_write on public.membership
for all to authenticated
using      ( app.role_at_least(app.org_role(organization_id), 'admin') )
with check ( app.role_at_least(app.org_role(organization_id), 'admin')
             and app.role_rank(role) >= app.role_rank(app.org_role(organization_id)) );
```

with the org/workgroup role helpers:

```sql
create or replace function app.org_role(p_org uuid, p_uid uuid default null)
returns public.member_role
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := coalesce(p_uid, auth.uid());
  v_role public.member_role;
begin
  if v_uid is null or p_org is null then return null; end if;
  -- прямое членство ИЛИ членство в организации-предке (партия управляет фракцией)
  select m.role into v_role
  from public.membership m
  where m.user_id = v_uid
    and m.status = 'active'
    and m.organization_id = any (app.user_org_scope(v_uid))
    and p_org = any (app.org_subtree(m.organization_id))
  order by app.role_rank(m.role)
  limit 1;
  return v_role;
end;
$$;

create or replace function app.workgroup_role(p_wg uuid, p_uid uuid default null)
returns public.member_role
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := coalesce(p_uid, auth.uid());
  v_role public.member_role;
begin
  if v_uid is null or p_wg is null then return null; end if;
  select wm.role into v_role
  from public.workgroup_member wm
  where wm.workgroup_id = p_wg and wm.user_id = v_uid and wm.status = 'active';
  return v_role;
end;
$$;
```

**`draft` and `asset` — documents inherit from the project, with an ACL override.**

The task asked for a `document_acl`. The existing schema has `draft` (внутренние документы:
тексты законопроектов, пояснительные записки, ФЭО) and `asset` (загруженные материалы).
Neither has a per-document ACL. Add one — it is needed for the real case «текст
законопроекта виден всей рабочей группе, но ФЭО — только двум людям»:

```sql
-- ============================================================================
-- 0002_draft_acl.sql — точечные исключения из наследования от проекта
-- ============================================================================
create type public.acl_effect as enum ('grant', 'revoke');

create table public.draft_acl (
  id              uuid primary key default gen_random_uuid(),
  draft_id        uuid not null references public.draft(id) on delete cascade,
  -- ровно одна из трёх целей
  user_id         uuid references public.profile(id) on delete cascade,
  organization_id uuid references public.organization(id) on delete cascade,
  workgroup_id    uuid references public.workgroup(id) on delete cascade,
  effect          public.acl_effect not null default 'grant',
  role            public.member_role not null default 'viewer',
  granted_by      uuid not null references public.profile(id),
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint draft_acl_one_target check (
    (user_id is not null)::int + (organization_id is not null)::int
      + (workgroup_id is not null)::int = 1
  )
);
create index draft_acl_draft_idx on public.draft_acl(draft_id);
create index draft_acl_user_idx  on public.draft_acl(user_id);
alter table public.draft_acl enable row level security;

-- «Закрытый» документ: если стоит флаг, наследование от проекта ОТКЛЮЧЕНО
-- и доступ дают только строки draft_acl с effect='grant'.
alter table public.draft add column if not exists is_restricted boolean not null default false;
```

```sql
create or replace function app.draft_role(p_draft uuid, p_uid uuid default null)
returns public.member_role
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   uuid := coalesce(p_uid, auth.uid());
  v_d     public.draft%rowtype;
  v_role  public.member_role;
  v_orgs  uuid[];
  v_wgs   uuid[];
  v_revoked boolean;
begin
  if v_uid is null then return null; end if;
  select * into v_d from public.draft where id = p_draft;
  if not found then return null; end if;

  v_orgs := app.user_org_scope(v_uid);
  v_wgs  := app.user_workgroup_ids(v_uid);

  -- 1. явный отзыв побеждает всё
  select true into v_revoked
  from public.draft_acl a
  where a.draft_id = p_draft
    and a.effect = 'revoke'
    and (a.expires_at is null or a.expires_at > now())
    and (   a.user_id = v_uid
         or a.organization_id = any (v_orgs)
         or a.workgroup_id    = any (v_wgs))
  limit 1;
  if v_revoked then return null; end if;

  -- 2. наследование от проекта, если документ не закрыт
  if not v_d.is_restricted then
    v_role := app.project_role(v_d.project_id, v_uid);
  end if;

  -- 3. точечные выдачи
  -- скалярный подзапрос — см. примечание в app.project_role
  v_role := app.role_max(v_role, (
    select a.role from public.draft_acl a
    where a.draft_id = p_draft
      and a.effect = 'grant'
      and (a.expires_at is null or a.expires_at > now())
      and (   a.user_id = v_uid
           or a.organization_id = any (v_orgs)
           or a.workgroup_id    = any (v_wgs))
    order by app.role_rank(a.role)
    limit 1
  ));

  -- владелец документа не теряет доступ никогда
  if v_d.created_by = v_uid then
    v_role := app.role_max(v_role, 'editor'::public.member_role);
  end if;

  return v_role;
end;
$$;

create policy draft_select on public.draft
for select to authenticated
using (
  -- быстрый путь: обычный документ видимого проекта
  (is_restricted = false and project_id = any ((select app.visible_project_ids())))
  -- медленный путь: только для закрытых документов, их мало
  or (is_restricted = true and app.draft_role(id) is not null)
);

create policy draft_insert on public.draft
for insert to authenticated
with check ( app.role_at_least(app.project_role(project_id), 'contributor')
             and created_by = (select auth.uid()) );

create policy draft_update on public.draft
for update to authenticated
using      ( app.role_at_least(app.draft_role(id), 'editor') )
with check ( app.role_at_least(app.draft_role(id), 'editor') );

create policy draft_delete on public.draft
for delete to authenticated
using ( app.role_at_least(app.draft_role(id), 'admin') );

create policy draft_acl_select on public.draft_acl
for select to authenticated
using ( app.draft_role(draft_id) is not null );

create policy draft_acl_write on public.draft_acl
for all to authenticated
using      ( app.role_at_least(app.draft_role(draft_id), 'admin') )
with check ( app.role_at_least(app.draft_role(draft_id), 'admin')
             and granted_by = (select auth.uid()) );
```

`asset` is simpler — it inherits from the project only:

```sql
create policy asset_select on public.asset
for select to authenticated
using (
  (project_id is not null and project_id = any ((select app.visible_project_ids())))
  or (project_id is null and organization_id = any ((select app.user_org_scope())))
  or uploaded_by = (select auth.uid())
);

create policy asset_insert on public.asset
for insert to authenticated
with check ( uploaded_by = (select auth.uid())
             and ( project_id is null
                   or app.role_at_least(app.project_role(project_id), 'contributor') ) );

create policy asset_delete on public.asset
for delete to authenticated
using ( uploaded_by = (select auth.uid())
        or app.role_at_least(app.project_role(project_id), 'admin') );
```

**`audit_log` — append-only.** There are deliberately **no** `UPDATE`/`DELETE` policies:
with RLS enabled and no permissive policy for a command, that command returns zero rows.
Belt-and-braces, revoke the privilege too.

```sql
create policy audit_log_select on public.audit_log
for select to authenticated
using (
  actor_id = (select auth.uid())
  or (project_id is not null and app.role_at_least(app.project_role(project_id), 'admin'))
  or (organization_id is not null and app.role_at_least(app.org_role(organization_id), 'admin'))
);
-- вставка только через сервис/триггеры
revoke insert, update, delete on public.audit_log from authenticated, app_api;
grant  insert on public.audit_log to service_role;
```

### 2.7 Indexes the policies depend on

RLS predicates are query predicates. Missing indexes here are the #1 cause of RLS
slowdowns `[V-doc]`. Most already exist in `tenancy.ts`; these are the additions:

```sql
create index if not exists membership_user_active_idx
  on public.membership(user_id) where status = 'active';
create index if not exists workgroup_member_user_active_idx
  on public.workgroup_member(user_id) where status = 'active';
create index if not exists project_share_org_live_idx
  on public.project_share(organization_id, project_id)
  where organization_id is not null;
create index if not exists project_share_wg_live_idx
  on public.project_share(workgroup_id, project_id)
  where workgroup_id is not null;
create index if not exists project_active_org_idx
  on public.project(organization_id) where archived_at is null;
create index if not exists draft_restricted_idx
  on public.draft(project_id) where is_restricted = false;
```

### 2.8 Testing the policies — `pgtap` is already in the image

Do not test RLS by hand. `pgtap 1.3.3` ships with `supabase/postgres` `[V-src]`.

```sql
-- packages/db/tests/rls/project_cross_org.sql
begin;
select plan(6);

-- фикстуры: партия А (фракция А1), партия Б (фракция Б1), проект фракции А1
-- депутат b1 приглашён поимённо в проект А1 как reviewer

set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid-b1>","role":"authenticated"}';

select is( app.project_role('<proj-a1>')::text, 'reviewer',
           'депутат другой партии получает роль по project_member' );
select ok ( '<proj-a1>' = any(app.visible_project_ids()),
           'проект попадает в видимые' );
select is( (select count(*) from public.draft where project_id = '<proj-a1>'), 3::bigint,
           'видит документы проекта' );
select throws_ok(
  $q$ update public.draft set title = 'x' where project_id = '<proj-a1>' $q$,
  null, null, 'reviewer не может править' );

-- истечение выдачи
update public.project_share set expires_at = now() - interval '1 day'
  where project_id = '<proj-a2>';
select is( app.project_role('<proj-a2>'), null,
           'просроченная выдача не даёт доступа' );
select ok ( not ('<proj-a2>' = any(app.visible_project_ids())),
           'просроченный проект исчезает из выборки' );

select * from finish();
rollback;
```

Run with `pg_prove -d postgres packages/db/tests/rls/*.sql` in CI. **A PR that adds a
table to `public` and no RLS policy must fail CI** — add a guard test that asserts
`pg_tables WHERE schemaname='public' AND NOT rowsecurity` is empty.

### 2.9 Guarding the `p_uid` parameter

```sql
create or replace function app.assert_self(p_uid uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_uid is null then return auth.uid(); end if;
  if p_uid <> auth.uid()
     and coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','')
         <> 'service_role' then
    raise exception 'forbidden: cannot evaluate access for another user'
      using errcode = '42501';
  end if;
  return p_uid;
end;
$$;
```
…and open every helper with `v_uid := app.assert_self(p_uid);` instead of
`coalesce(p_uid, auth.uid())`.

### 2.10 Declaring the policies from Drizzle

`drizzle-orm` can emit policies into migrations, which keeps them in the same review flow
as the schema `[V-doc]` https://orm.drizzle.team/docs/rls :

```ts
import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const project = pgTable('project', { /* … */ }, (t) => [
  pgPolicy('project_select', {
    for: 'select',
    to: authenticatedRole,
    using: sql`${t.id} = any ((select app.visible_project_ids()))`,
  }),
  pgPolicy('project_delete', {
    for: 'delete',
    to: authenticatedRole,
    using: sql`app.project_role(${t.id}) = 'owner'`,
  }),
]);
```

`drizzle-orm/supabase` exports `anonRole`, `authenticatedRole`, `serviceRole`,
`supabaseAuthAdminRole` as `pgRole(...).existing()` `[V-doc]`. `pgTable.withRLS(...)`
enables RLS with an implicit deny-all when no policy is given `[V-doc]` — a safe default.

**Caveat.** Drizzle cannot express the `plpgsql` helper *bodies*. Keep them in
hand-written SQL files under `packages/db/migrations/` and reference them from the
policies. Drizzle-kit will not drop unknown functions, but it *will* try to drop policies
it does not know about — so either declare **all** policies in Drizzle or **none**.
Mixing the two causes migration churn. **Recommendation: declare all policies in Drizzle,
all functions in raw SQL.**

---

## 3. Auth: Supabase Auth vs custom

### 3.1 Verdict — use Supabase Auth (GoTrue), do not build custom

GoTrue is MIT, self-hostable, and already gives us the expensive parts: password hashing,
refresh-token rotation and reuse detection, email/OTP flows, TOTP MFA, SAML 2.0 SP, OAuth
providers, and — critically — **asymmetric JWT signing with a JWKS endpoint**.

What it does **not** give us, and we must build: the деп-status verification workflow
(§3.2), ЕСИА as an IdP (§3.3), and the business audit log (already `public.audit_log`).

Verified capabilities on self-host:

| Capability | Self-host status | Source |
|---|---|---|
| TOTP MFA | Enabled by default, no config, free | `[V-doc]` https://supabase.com/docs/guides/auth/auth-mfa/totp |
| SAML 2.0 SSO (as SP) | Supported; `GOTRUE_SAML_ENABLED=true` + `GOTRUE_SAML_PRIVATE_KEY` = base64 PKCS#1 DER RSA ≥2048-bit. IdPs are registered **at runtime through the Auth admin API**, not env vars | `[V-doc]` https://supabase.com/docs/guides/self-hosting/self-hosted-saml-sso |
| Asymmetric JWT (RS256 default; ECC / Ed25519 optional) | Yes; JWKS at `/auth/v1/.well-known/jwks.json`; all new projects default to asymmetric since **1 Oct 2025** | `[V-doc]` https://supabase.com/blog/jwt-signing-keys |
| Custom claims in the access token | `custom_access_token_hook(event jsonb) returns jsonb`, plpgsql, granted to `supabase_auth_admin` | `[V-doc]` https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac |
| Zero-downtime key rotation | Old public keys stay in the JWKS set until all tokens expire | `[V-doc]` |

**Do not** put org/role claims into the JWT for authorisation decisions unless you accept
staleness: a revoked membership stays valid until the access token expires (default 1 h).
For Doomatel, where revoking a deputy's access may be time-critical, **the DB is the
authority and the JWT carries only `sub`, `role`, `aal`, `session_id`**. Put at most a
`is_verified` boolean in the token for cheap UI gating. `[UNVERIFIED — product decision]`

### 3.2 Registration BY PARTY with deputy-status verification

The requirement is that a person cannot self-serve into the system as a депутат.
The schema already encodes it (`profile.is_verified`, `membership.status='invited'`,
`invitation.token_hash`). The flow:

```
┌ 1. Администратор партии создаёт приглашение
│    POST /api/invitations  { email, organizationId, role, dumaDeputyId? }
│    → Nest: проверяет app.role_at_least(app.org_role(orgId),'admin')
│    → генерирует token (32 байта, crypto.randomBytes), пишет ТОЛЬКО sha256(token)
│      в invitation.token_hash, отправляет ссылку по почте (Mailpit в dev)
│
├ 2. Приглашённый открывает /invite/<token>
│    → Nest: sha256(token) → invitation, проверяет expires_at/revoked_at/accepted_at
│    → отдаёт «предзаполненную» форму: ФИО, организация, роль (только чтение)
│
├ 3. Регистрация в GoTrue
│    supabase.auth.signUp({ email, password })  ИЛИ signInWithSSO / ЕСИА (§3.3)
│    email из приглашения ДОЛЖЕН совпадать с email в GoTrue — иначе 403
│
├ 4. Nest в одной транзакции:
│    insert profile (id = auth.users.id, is_verified = false)
│    insert membership (status='active', role = invitation.role)
│    update invitation set accepted_at, accepted_by
│    insert audit_log ('member.invite_accepted')
│
└ 5. Подтверждение статуса депутата — ОТДЕЛЬНЫЙ шаг
     Администратор партии (или аппарат) сверяет ФИО с реестром депутатов
     (см. 01-sozd-data-sources.md — справочник депутатов с duma.gov.ru)
     → profile.is_verified = true, verified_by, verified_at
     → audit_log ('profile.verified')
     До этого момента: доступ только viewer, запрет на создание проектов
     (см. project_insert WITH CHECK в §2.6).
```

Two hardening points:

* **Token is never stored in plaintext.** `invitation.token_hash` is already `unique` in
  the schema — good. Look up by hash, not by id, so the URL contains no enumerable id.
* **Automated cross-check.** `profile.duma_deputy_id` links to the справочник депутатов.
  A nightly job flags profiles whose `duma_deputy_id` no longer appears in the current
  созыв (полномочия прекращены) and downgrades `membership.status` to `suspended`.
  `[UNVERIFIED — depends on the reachability of the справочник, see 00-network-access-notes.md]`

### 3.3 ЕСИА / Госуслуги — the real picture

This is the highest-uncertainty area in this document and the answer is
**«architecturally plan for it, do not build it in v1»**.

Verified facts:

* ЕСИА historically speaks a **profiled OAuth 2.0** with **ГОСТ-signed** requests
  (detached CMS signature over the request, ГОСТ Р 34.10-2012), not vanilla OIDC.
* The ЕСИА Regulation now requires **OpenID Connect support with ФСБ conformance
  evaluation (оценка влияния на СКЗИ)** — deadline **31 December 2026**, with already-
  connected systems given until end of 2026 to adapt `[V-search]`
  https://habr.com/ru/articles/893544/ , https://esia.ru/reglament_esia
* Connection requires the ИС to have passed **аттестация по требованиям ИБ**, and to use
  **СКЗИ сертифицированные ФСБ класса не ниже КС3** `[V-search]`
  https://rcngroup.ru/blog/esia-i-smjev-trebovanija-k-ib-pri-podkljuchenii-k-sisteme/
* A **«типовое техническое решение» / «ЕСИА Шлюз»** exists specifically to avoid the two
  most expensive procedures (оценка влияния на СКЗИ + проверка корректности реализации
  OIDC). Interaction moves to a **шлюзовой модуль (API Gateway)** available from 2025.
  `[V-search]` https://info.gosuslugi.ru/upload/iblock/74f/…/Tekhreshenie_new.pdf

Architectural consequence — **do not** try to speak ЕСИА from Node:

```
browser ──► Next.js ──► GoTrue (SAML SP / OIDC RP)
                          │
                          └──► ЕСИА-Шлюз (сертифицированный, отдельный контур,
                                 ГОСТ-СКЗИ КС3, аттестован)
                                     │
                                     └──► ЕСИА
```

GoTrue acts as SP/RP against the **шлюз**, which speaks the certified protocol to ЕСИА.
This keeps every ГОСТ/СКЗИ obligation inside a component we buy rather than write.
Requirements on our side:

1. GoTrue's SAML SP must be enabled and the шлюз registered as an IdP via the Auth admin
   API (self-host does this at runtime, not via env `[V-doc]`).
2. `profile` needs a stable external subject column: add
   `esia_oid text unique` (ЕСИА OID) and `snils_hash text` — **store a hash, never
   the СНИЛС itself**, see §3.4.
3. Nest must map ЕСИА's «должностное лицо» attributes onto `membership`, never trust them
   for `is_verified` without a human step.

`[UNVERIFIED]` Whether ЕСИА will admit a system like Doomatel at all (it is not a
государственная услуга) is a legal/organisational question, not a technical one. Treat
ЕСИА as an **optional identity provider for v2**, and ship v1 with
email+password+TOTP and, for parties that want it, SAML against their own IdP.

### 3.4 ФЗ-152 (персональные данные) — what it means in the build

Verified requirements:

* **ч. 5 ст. 18 152-ФЗ**: при сборе ПДн граждан РФ **запись, систематизация,
  накопление, хранение, уточнение и извлечение** должны производиться с использованием
  баз данных, **находящихся на территории РФ** `[V-search]`
  https://www.consultant.ru/law/podborki/lokalizaciya_personalnyh_dannyh/
* Foreign clouds are allowed only as an **asynchronous replica** after the primary write
  landed in the Russian cluster `[V-search]`.
* Penalties: up to 6 млн ₽ + предписание о немедленном переносе; повторно — до 18 млн ₽
  `[V-search]` https://www.klerk.ru/blogs/roskom24/674017/

Architectural translation — a checklist, not prose:

| Requirement | Implementation |
|---|---|
| Primary write of ПДн inside РФ | Postgres primary in РФ. **No managed Supabase Cloud, ever.** No Vercel/Neon/Supabase-hosted. |
| No foreign processor touching ПДн | LLM calls must not carry ПДн. See §3.4.1. |
| Cross-border transfer notification | If any replica/backup leaves РФ → уведомление в Роскомнадзор. **Simplest answer: don't.** Backups stay in РФ. |
| Locality of object storage | MinIO / Yandex Object Storage in a Russian region. `.env.example` already sets `S3_REGION=ru-central-1` — good. |
| Data minimisation | `profile` must not store СНИЛС/паспорт in plaintext. Add `snils_hash` only. |
| Right to deletion | `profile` delete must cascade. `audit_log.actor_id` is `on delete set null` — correct: the audit record survives, the identity does not. |
| Log of every access to ПДн | `pgaudit 17.1` (§1.3) + `public.audit_log`. |
| Consent record | Add `public.consent(user_id, purpose, version, accepted_at, ip, text_sha256)`. Missing from the schema today. |
| Retention | `pg_partman 5.3.1` monthly partitions on `audit_log`, `message`; detach+archive on schedule. |

#### 3.4.1 The LLM boundary is the real ФЗ-152 risk

This is the thing most likely to be got wrong. Every prompt that contains a стенограмма,
a chat message, an обращение граждан, or a ФИО is a transfer of ПДн to the model host.

* `.env.example` already points `LLM_BASE_URL` at a self-hosted OpenAI-compatible
  endpoint (`http://127.0.0.1:8000/v1`) — **that is the correct default and must stay
  the default.** Do not add a fallback to a foreign provider.
* If GigaChat/YandexGPT are used, they are Russian operators — permissible, but they are
  **third-party processors**: a поручение на обработку (ст. 6 ч. 3) is required, and the
  ПДн still must have been *collected* into a Russian DB first (it was).
* Build a **ПДн-redaction step** in the ingestion pipeline (§6.4): a Russian NER pass that
  replaces ФИО/телефон/адрес with stable placeholders before text reaches an external
  model, and restores them in the rendered answer. `[UNVERIFIED — design proposal]`

### 3.5 ФЗ-149, ФСТЭК, and the ГИС question

* **ФЗ-149** «Об информации…» — relevant mainly for: обязанность хранить сведения о
  пользователях and «организатор распространения информации» rules **if** the chat becomes
  a public messaging service. Internal corporate chat behind auth is normally out of that
  scope. `[UNVERIFIED — needs Russian counsel]`
* **Critical, and new:** приказ ФСТЭК России **№ 117 от 11.04.2025** replaced приказ № 17
  and applies **from 1 марта 2026**. Two changes matter to us `[V-search]`
  https://securitymedia.org/info/attestatsiya-gis-i-kii-po-novym-pravilam-2026-polnyy-razbor-prikaza-fstek-117.html :
  1. Scope widened — № 117 covers **all** information systems operated by
     государственные органы, предприятия и учреждения, not only formally-designated ГИС.
     The Государственная Дума operating Doomatel is squarely in that set.
  2. Аттестация shifts from a one-off event to a **continuous process** with concrete
     metrics and deadlines.
  Classes К1/К2/К3 are retained; a system with конфиденциальная (non-state-secret)
  information at federal level lands at **К1 or К2**.
* Consequences we can act on **now**, cheaply:
  - Deploy on **Astra Linux SE / RED OS** (ФСТЭК-certified), not Ubuntu. Both run Docker.
  - Keep every component **self-hosted and version-pinned by digest** — аттестация is
    against a fixed configuration; a floating `:latest` tag invalidates it.
  - Enable `pgaudit` and ship logs to a WORM store from day one.
  - TLS via **ГОСТ TLS** on the ingress (КриптоПро NGINX / Ideco / С-Терра), terminating
    in front of Envoy. Application code is unaffected.
  - Expect to need **сертифицированные СЗИ** (антивирус, СКЗИ, СЗИ от НСД) around the
    stack. ClamAV (§6.3) is a hygiene control, **not** a certified антивирус — plan for
    Kaspersky/Dr.Web ScanEngine as a drop-in replacement behind the same interface.
* `[UNVERIFIED]` Whether an аттестация can be passed with non-registry OSS (Supabase,
  Postgres upstream) is a question for the аттестующая организация. Postgres itself has a
  certified Russian distribution (**Postgres Pro Certified**) — which is a reason to keep
  the DB layer free of Supabase-specific extensions where possible, or to accept that
  Supabase's `supabase/postgres` image is the constraint. **This is a genuine strategic
  fork and should be decided before the schema hardens.** See §10.

---

## 4. NestJS + Supabase together

### 4.1 Verifying Supabase JWTs in Nest — use JWKS, not the shared secret

`.env.example` currently has `SUPABASE_JWT_SECRET`. **Remove it from every service except
GoTrue itself.** With asymmetric keys the private key never leaves the Auth server and each
service verifies with a public key it fetches — a compromised API pod can no longer *mint*
tokens `[V-doc]` https://supabase.com/blog/jwt-signing-keys .

```ts
// apps/api/src/auth/supabase-jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';

export interface SupabaseJwt {
  sub: string;                 // auth.users.id
  role: 'authenticated' | 'anon' | 'service_role';
  aal?: 'aal1' | 'aal2';       // aal2 == MFA пройдена
  session_id?: string;
  email?: string;
  exp: number;
}

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // RS256 по умолчанию; ES256 если ключ ECC
      algorithms: ['RS256', 'ES256'],
      audience: 'authenticated',
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        // JWKS кешируется Supabase Edge на 10 минут; локальный кеш держим короче,
        // иначе ротация ключа выбьет живые токены.
        cacheMaxAge: 5 * 60_000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      }),
    });
  }

  async validate(payload: SupabaseJwt) {
    if (payload.role !== 'authenticated') throw new UnauthorizedException();
    return payload;                 // → request.user
  }
}
```

Gotchas, verified:

* The JWKS endpoint **returns nothing** if the project still uses the legacy symmetric
  secret `[V-doc]`. Migrate the project to asymmetric keys *first*, then switch Nest.
* Supabase Edge caches JWKS for 10 minutes; when rotating, **wait ≥20 minutes** before
  revoking the old key `[V-doc]`.
* Self-hosted issuer is `${SUPABASE_URL}/auth/v1` — pin it. Not pinning `issuer` +
  `audience` is how you accept a token from a different tenant.
* MFA enforcement is a **claim check, not a login check**: require `aal === 'aal2'` on
  sensitive routes (project_share writes, member role changes, export).

```ts
@Injectable()
export class Aal2Guard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as SupabaseJwt;
    if (user?.aal !== 'aal2') throw new ForbiddenException('MFA required');
    return true;
  }
}
```

### 4.2 The service-role key — rules

`SERVICE_ROLE_KEY` bypasses RLS entirely. Three hard rules:

1. **Never** in `NEXT_PUBLIC_*`, never in a client bundle, never in a Server Action that
   could be reached without an auth check. `.env.example` correctly keeps it un-prefixed.
2. Use it for exactly three things: (a) GoTrue **admin API** calls (`auth.admin.*` — user
   creation, MFA factor management, SAML IdP registration), (b) Storage administration,
   (c) issuing Realtime tokens. **Not** for ordinary data access — that goes through the
   `pg` pool (§4.3).
3. Wrap it in one injectable so there is a single grep-able call site:

```ts
// apps/api/src/supabase/supabase-admin.service.ts
@Injectable()
export class SupabaseAdminService implements OnModuleInit {
  private client!: SupabaseClient;
  onModuleInit() {
    this.client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  /** Единственная точка доступа к admin-API. Логируется в audit_log. */
  get admin() { return this.client.auth.admin; }
  get storage() { return this.client.storage; }
}
```

### 4.3 Direct `pg` pool vs PostgREST — and the recommended pattern

**Recommendation: NestJS is the only writer; it talks to Postgres over a direct pool with
Drizzle; RLS stays enabled and is enforced *even for Nest*.**

Most teams give the app role `BYPASSRLS` and treat RLS as decoration. Do not. Instead
adopt the pattern where Nest **impersonates the caller** per transaction:

```ts
// apps/api/src/db/tx.service.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

@Injectable()
export class TxService {
  constructor(private readonly pool: Pool) {}

  /** Выполняет работу от имени пользователя: RLS применяется. */
  async asUser<T>(uid: string, fn: (db: NodePgDatabase<typeof schema>) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // set_config(..., true) => local, откатывается вместе с транзакцией
      await client.query(
        `select set_config('request.jwt.claims', $1, true),
                set_config('role', 'authenticated', true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' })],
      );
      const db = drizzle(client, { schema });
      const out = await fn(db);
      await client.query('commit');
      return out;
    } catch (e) { await client.query('rollback'); throw e; }
    finally { client.release(); }
  }

  /** Служебный путь: миграции, воркеры, ingestion. RLS обходится осознанно. */
  async asService<T>(fn: (db: NodePgDatabase<typeof schema>) => Promise<T>) { /* … */ }
}
```

Why this is worth the extra code:

* `auth.uid()` in Supabase reads `request.jwt.claims->>'sub'`, so the same policies work
  identically whether the query arrives from PostgREST, from Realtime, or from Nest.
  **One authorisation model, three transports.** Without this, RLS is only ever exercised
  by paths we do not use, and therefore is never actually tested.
* `set_config(..., true)` is transaction-local, so a pooled connection cannot leak identity
  into the next request. **This is the correctness-critical detail** — with `false` it
  would be session-local and a pooler would hand the identity to another user.
* Escaping to `asService()` is explicit and grep-able, so an audit can enumerate every
  place that bypasses RLS.

Cost: policy evaluation on every read. That is exactly what §2.4's array pattern is for.
Measure with `explain (analyze, buffers)` before optimising further.

**When to use PostgREST at all:** internal, read-only, ad-hoc analytics from trusted
tooling. Not the browser. Keep it on the internal network only.

**Connection pooling.** Supavisor in **transaction mode** (port 6543) breaks
prepared statements and session-level `SET`. Since `asUser()` uses transaction-local
`set_config`, transaction mode is fine — but Drizzle must be told:

```ts
// postgres-js driver
const client = postgres(process.env.DATABASE_URL!, { prepare: false });
```
Use **session mode / direct** (`DIRECT_URL`, port 5432) for migrations and for the
LISTEN/NOTIFY connection. `.env.example` already separates `DATABASE_URL` / `DIRECT_URL` —
keep that distinction, it is load-bearing.

### 4.4 Drizzle vs Prisma vs Kysely — recommendation: **Drizzle**

Versions verified 2026-08-20 `[V-npm]`: `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`,
`prisma@7.9.1`, `kysely@0.29.5`.

| Criterion | Drizzle | Prisma | Kysely |
|---|---|---|---|
| Can declare **RLS policies** in schema → migrations | **Yes** (`pgPolicy`, `pgTable.withRLS`, `drizzle-orm/supabase` roles) `[V-doc]` | No — RLS is raw SQL only | No — raw SQL only |
| Knows Supabase's `auth` schema | **Yes** (`authUsers` export) `[V-doc]` | No | No |
| Runs on an existing `pg` client (needed for `asUser` tx) | **Yes** — `drizzle(client)` | Awkward; Prisma owns its connection | Yes |
| Postgres enums, partial indexes, `tsvector` GIN, custom types | Native | Enums yes; partial indexes/`tsvector` need `Unsupported` + raw SQL | Native |
| Extra runtime/engine | None | Rust engine (or `driverAdapters`) | None |
| Typed raw SQL escape hatch | `sql\`\`` template | `$queryRaw` (weaker typing) | Excellent |
| Already used in this repo | **Yes** — `packages/db` | — | — |

Decision: **Drizzle**, and it is already the right call in `packages/db`. The deciding
factor is not ergonomics, it is that Drizzle is the only one that keeps **schema and
security policy in the same migration**, which is precisely what an аттестация needs to
see. Kysely is the runner-up if the team ever finds Drizzle's query builder limiting —
they compose (Drizzle for schema/migrations, Kysely for gnarly reads) at the cost of two
mental models. Prisma is the wrong fit here: `Unsupported` columns for `tsvector`/`bytea`
+ the RLS gap + the connection-ownership problem all bite this exact schema.

Note `packages/db` uses the `postgres` (postgres.js) driver `[V-npm] postgres@3.4.7`.
For the `asUser` pattern above either driver works; `postgres.js` uses `reserve()` instead
of `pool.connect()`. Pick one and keep it — `pg@8.23.0` `[V-npm]` has the more predictable
pooling story under Supavisor.

---

## 5. Realtime: Supabase Realtime vs a Nest socket.io gateway

### 5.1 The three Realtime mechanisms, and which to use

| Mechanism | How it works | Use in Doomatel |
|---|---|---|
| `postgres_changes` | Realtime reads the WAL, then **re-checks RLS per subscriber per change**. Cost grows with subscriber count. | **No.** Deprecated in practice for chat-scale fan-out. |
| **`broadcast`** | Pub/sub over a topic. Can be emitted **from SQL** via `realtime.broadcast_changes()` / `realtime.send()` in a trigger. Authorised by RLS on `realtime.messages`. | **Yes — the primary transport** for chat, presence hints, agent-run progress. |
| **`presence`** | Per-channel ephemeral state (who is online / typing / cursor). Same authorisation model. | **Yes** — presence and the collaborative-editor cursor layer. |

Verified API `[V-doc]` https://supabase.com/docs/guides/realtime/broadcast :

```sql
PERFORM realtime.broadcast_changes(
  'conversation:' || NEW.conversation_id::text,  -- topic
  TG_OP,                                          -- event
  TG_OP,                                          -- operation
  TG_TABLE_NAME, TG_TABLE_SCHEMA,                 -- table, schema
  NEW, OLD                                        -- new record, old record
);

-- произвольная полезная нагрузка
SELECT realtime.send('{}'::jsonb, 'event', 'topic', TRUE /* private */);
```

Authorisation `[V-doc]` https://supabase.com/docs/guides/realtime/authorization :
create RLS policies on **`realtime.messages`**; subscribe with `config: { private: true }`;
call `supabase.realtime.setAuth()` on the client. Realtime connects as
`supabase_admin`, then **inserts the message and reads it back inside a transaction it
rolls back**, purely to evaluate the user's policies — the probe message is never
delivered. `realtime.topic()` returns the channel topic inside a policy.

### 5.2 Verdict for chat: Supabase Realtime, not a Nest socket.io gateway

| | Supabase Realtime | Nest + socket.io |
|---|---|---|
| Horizontal scale | Elixir/Phoenix, built for this; clustering included | Needs `@socket.io/redis-adapter` + sticky sessions |
| Authorisation | **Same RLS policies as the REST path** — one model | A second, hand-written model that will drift |
| Presence CRDT | Built in | Hand-rolled |
| DB→client fan-out | `realtime.broadcast_changes()` in a trigger — the message is delivered *because it committed* | App must publish after commit; a crash between commit and publish silently loses the event |
| Ops cost | One more container we already run | One more scaling axis on the Nest fleet |

The third row is decisive. Emitting from a trigger makes delivery **transactional**:
there is no window where the row exists and the notification does not.

**Where socket.io still wins, and where we should keep it:** the **collaborative editor**
(`draft.yjs_state` / `draft_yjs_update` in `collaboration.ts`) needs a Yjs-aware server
that applies and compacts binary updates — Realtime's broadcast is a dumb pipe and would
push per-keystroke traffic through Postgres. Run a **dedicated `apps/collab` y-websocket
service** (hinted at in `infra/docker-compose.yml`'s comment about a `collab` app) and keep
Realtime for everything else. Two transports, cleanly separated by purpose, not by accident.

### 5.3 Chat schema — additions to `collaboration.ts`

`collaboration.ts` already has `conversation`, `conversation_participant`, `message`,
`message_reaction`. Three things are missing for a production chat:

```sql
-- ============================================================================
-- 0003_chat.sql
-- ============================================================================

-- 1. Вложения. Сейчас файлы висят на project через asset; сообщению нужна связь.
create table public.message_attachment (
  message_id uuid not null references public.message(id) on delete cascade,
  asset_id   uuid not null references public.asset(id)   on delete cascade,
  ordinal    int  not null default 0,
  primary key (message_id, asset_id)
);
create index message_attachment_asset_idx on public.message_attachment(asset_id);

-- 2. Ветки. reply_to_id даёт дерево, но «показать все ответы в ветке» — это
--    рекурсивный обход. Денормализуем корень ветки.
alter table public.message
  add column if not exists thread_root_id uuid references public.message(id) on delete cascade,
  add column if not exists reply_count int not null default 0;
create index if not exists message_thread_idx
  on public.message(thread_root_id, created_at)
  where thread_root_id is not null;

-- 3. Точные отметки о прочтении.
--    conversation_participant.last_read_message_id хватает для счётчика непрочитанного,
--    но не отвечает на вопрос «кто прочитал ЭТО сообщение» (нужно для поручений).
create table public.message_read (
  message_id uuid not null references public.message(id) on delete cascade,
  user_id    uuid not null references public.profile(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_read_user_idx on public.message_read(user_id, read_at);
```

> **Sizing warning.** `message_read` is O(messages × participants). For an организация-wide
> channel that is unacceptable. **Rule: write `message_read` rows only for conversations
> with `kind IN ('direct','group')` and ≤ 50 participants; rely on
> `conversation_participant.last_read_message_id` otherwise.** Enforce in a trigger, not in
> application code. `[UNVERIFIED — design proposal]`

### 5.4 Chat RLS

One helper, then everything hangs off it:

```sql
create or replace function app.conversation_ids(p_uid uuid default null)
returns uuid[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := app.assert_self(p_uid);
  v_ids uuid[];
begin
  if v_uid is null then return '{}'::uuid[]; end if;
  select array_agg(distinct c.id) into v_ids
  from public.conversation c
  where
    -- прямое участие
    exists (select 1 from public.conversation_participant cp
             where cp.conversation_id = c.id
               and cp.user_id = v_uid
               and cp.left_at is null)
    -- чат проекта доступен всем, кто видит проект (включая депутатов других партий)
    or (c.kind = 'project'   and c.project_id      = any (app.visible_project_ids(v_uid)))
    or (c.kind = 'workgroup' and c.workgroup_id    = any (app.user_workgroup_ids(v_uid)))
    or (c.kind = 'organization' and c.organization_id = any (app.user_org_scope(v_uid)));
  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;
```

```sql
create policy conversation_select on public.conversation
for select to authenticated
using ( id = any ((select app.conversation_ids())) );

create policy conversation_participant_select on public.conversation_participant
for select to authenticated
using ( conversation_id = any ((select app.conversation_ids())) );

-- выйти из беседы может каждый сам; добавлять других — создатель беседы
create policy conversation_participant_self on public.conversation_participant
for update to authenticated
using ( user_id = (select auth.uid()) )
with check ( user_id = (select auth.uid()) );

create policy message_select on public.message
for select to authenticated
using (
  conversation_id = any ((select app.conversation_ids()))
  and (deleted_at is null or author_id = (select auth.uid()))
);

create policy message_insert on public.message
for insert to authenticated
with check (
  conversation_id = any ((select app.conversation_ids()))
  and author_id = (select auth.uid())
  and role = 'user'                       -- сообщения ассистента пишет только сервис
);

-- правка и удаление — только своё, и только пока свежее
create policy message_update on public.message
for update to authenticated
using      ( author_id = (select auth.uid()) and created_at > now() - interval '24 hours' )
with check ( author_id = (select auth.uid()) );

create policy message_reaction_all on public.message_reaction
for all to authenticated
using ( exists (select 1 from public.message m
                 where m.id = message_id
                   and m.conversation_id = any ((select app.conversation_ids()))) )
with check ( user_id = (select auth.uid())
             and exists (select 1 from public.message m
                          where m.id = message_id
                            and m.conversation_id = any ((select app.conversation_ids()))) );

create policy message_read_all on public.message_read
for all to authenticated
using      ( user_id = (select auth.uid()) )
with check ( user_id = (select auth.uid()) );

create policy message_attachment_select on public.message_attachment
for select to authenticated
using ( exists (select 1 from public.message m
                 where m.id = message_id
                   and m.conversation_id = any ((select app.conversation_ids()))) );
```

**Realtime channel authorisation** — the same `app.conversation_ids()` guards the socket:

```sql
-- Топики вида 'conversation:<uuid>'
create policy realtime_conversation_read on realtime.messages
for select to authenticated
using (
  realtime.topic() like 'conversation:%'
  and (substring(realtime.topic() from 14))::uuid = any ((select app.conversation_ids()))
);

-- Писать в канал напрямую нельзя: сообщения идут через INSERT в public.message,
-- а в канал их выкладывает триггер. Это исключает подделку author_id.
create policy realtime_presence_write on realtime.messages
for insert to authenticated
with check (
  realtime.topic() like 'presence:conversation:%'
  and (substring(realtime.topic() from 23))::uuid = any ((select app.conversation_ids()))
);
```

and the trigger that publishes:

```sql
create or replace function public.message_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'conversation:' || coalesce(NEW.conversation_id, OLD.conversation_id)::text,
    TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
  );
  return null;
end;
$$;

create trigger message_broadcast_trg
  after insert or update or delete on public.message
  for each row execute function public.message_broadcast();

-- поддержка счётчика ветки
create or replace function public.message_thread_counter()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.reply_to_id is not null then
    NEW.thread_root_id := coalesce(
      (select coalesce(m.thread_root_id, m.id) from public.message m where m.id = NEW.reply_to_id),
      NEW.reply_to_id);
    update public.message set reply_count = reply_count + 1 where id = NEW.thread_root_id;
  end if;
  update public.conversation set last_message_at = NEW.created_at where id = NEW.conversation_id;
  return NEW;
end;
$$;
create trigger message_thread_trg before insert on public.message
  for each row execute function public.message_thread_counter();
```

Client side:

```ts
await supabase.realtime.setAuth();                    // обязательно для private
const ch = supabase
  .channel(`conversation:${conversationId}`, { config: { private: true } })
  .on('broadcast', { event: 'INSERT' }, (p) => appendMessage(p.payload.record))
  .on('broadcast', { event: 'UPDATE' }, (p) => patchMessage(p.payload.record))
  .subscribe();

const presence = supabase
  .channel(`presence:conversation:${conversationId}`, {
    config: { private: true, presence: { key: userId } },
  })
  .on('presence', { event: 'sync' }, () => setOnline(presence.presenceState()))
  .subscribe(async (s) => {
    if (s === 'SUBSCRIBED') await presence.track({ typing: false, at: Date.now() });
  });
```

**Index required by the policy** — `realtime.messages` policies run on every channel join:
`app.conversation_ids()` already leans on `conversation_participant_user_idx`
(exists in `collaboration.ts`). Add
`create index on public.conversation_participant(user_id) where left_at is null;`

---

## 6. Storage, files, and the ingestion pipeline

### 6.1 Supabase Storage vs MinIO — recommendation: **MinIO**

| | Supabase Storage | MinIO (already in compose) |
|---|---|---|
| Licence | Apache 2.0 `[V-src]` | AGPL-3.0 (server) — see caveat |
| Authorisation | RLS on `storage.objects` — same model as data | IAM policies + app-issued pre-signed URLs |
| Max size, standard upload | **5 GB** `[V-doc]` | Server-limited |
| Max size, resumable (TUS) / S3 multipart | **50 GB** `[V-doc]` | 5 TB per object (S3 spec) |
| Self-host default cap | `UPLOAD_FILE_SIZE_LIMIT=52428800` (50 MB) per tenant, overridable per bucket `[V-doc]` | Configurable |
| Image transforms | imgproxy included | Not included |
| Extra moving parts | storage-api + imgproxy + its own Postgres tables | One container |

**Decision: MinIO,** because (a) it is already the compose'd store and `.env.example` is
built around `S3_*`, (b) in production it is swapped for **Yandex Object Storage /
VK Cloud** in a Russian region by changing one endpoint — Supabase Storage would have to
be re-pointed *and* still needs a Russian S3 behind it anyway, and (c) audio/video from
`meeting`/`transcript` will exceed the 50 MB default and the 5 GB standard-upload ceiling
is uncomfortably close for long стенограммы.

> **AGPL caveat `[UNVERIFIED]`.** MinIO's server is AGPL-3.0. We do not modify it and do not
> offer it as a service, so obligations are minimal — but if legal is uncomfortable,
> **SeaweedFS (Apache 2.0)** or **Garage (AGPL)** or simply Yandex Object Storage are drop-in
> S3 replacements. Nothing in the code changes; `@aws-sdk/client-s3@3.1115.0` `[V-npm]`
> speaks to all of them.

Pre-signed URL flow — the browser never gets S3 credentials, and Nest gets to run the
authorisation check that RLS would have run:

```ts
// POST /api/projects/:id/assets/upload-url
@Post(':id/assets/upload-url')
@UseGuards(SupabaseAuthGuard)
async createUploadUrl(@Param('id') projectId: string, @CurrentUser() u: SupabaseJwt,
                      @Body() dto: CreateUploadDto) {
  await this.acl.requireProjectRole(u.sub, projectId, 'contributor');
  if (dto.byteSize > MAX_UPLOAD) throw new PayloadTooLargeException();
  if (!ALLOWED_MIME.has(dto.mimeType)) throw new UnsupportedMediaTypeException();

  // ключ содержит projectId — префикс становится границей арендатора в бакете
  const key = `p/${projectId}/${randomUUID()}/${sanitize(dto.fileName)}`;
  const url = await getSignedUrl(this.s3, new PutObjectCommand({
    Bucket: process.env.S3_BUCKET, Key: key,
    ContentType: dto.mimeType, ContentLength: dto.byteSize,
    Metadata: { uploadedby: u.sub, projectid: projectId },
  }), { expiresIn: 900 });                       // 15 минут

  const asset = await this.assets.createPending({ projectId, key, uploadedBy: u.sub, ...dto });
  return { assetId: asset.id, url, key };
}
```

Download is the mirror image: `GET /api/assets/:id/url` → check `app.draft_role`/
`app.project_role` → `getSignedUrl(GetObjectCommand, { expiresIn: 300 })`. **Never store a
public bucket policy.** `minio-init` in the compose already does
`mc anonymous set none local/doomatel-documents` — correct.

### 6.2 Limits to set explicitly

| Kind | Cap | Rationale |
|---|---|---|
| `document` (docx/pdf/odt/rtf) | 100 MB | Пакет законопроекта с приложениями |
| `image` | 25 MB | Сканы, фотографии документов |
| `audio` (совещание, стенограмма) | 2 GB | 8 ч моно 128 kbps ≈ 460 MB; запас ×4 |
| `video` | 5 GB | Записи заседаний |
| `archive` (zip) | 200 MB | Разворачивается сервером, не клиентом |
| Per-project quota | 100 GB, конфигурируемо | Иначе один проект съест хранилище |

Enforce **three times**: client (UX), pre-signed `ContentLength` (S3 rejects mismatch), and
a post-upload `HeadObject` check in the ingestion worker (defence against a tampered
`ContentLength`).

### 6.3 Virus scanning

`clamscan@2.4.0` `[V-npm]` talks to a `clamd` daemon over TCP or UNIX socket using the
**INSTREAM** protocol (4-byte big-endian length-prefixed chunks; daemon replies
`stream: OK` or `stream: <Name> FOUND`) `[V-search]` https://github.com/kylefarris/clamscan .

```yaml
# infra/docker-compose.yml — добавить
  clamav:
    image: clamav/clamav:1.4
    container_name: doomatel-clamav
    environment:
      CLAMAV_NO_MILTERD: 'true'
      FRESHCLAM_CHECKS: '4'
    ports: ['3310:3310']
    volumes: [clamav-db:/var/lib/clamav]
    healthcheck:
      test: ['CMD-SHELL', 'clamdscan --ping 1 || exit 1']
      interval: 30s
      timeout: 10s
      retries: 10
      start_period: 180s      # первая загрузка баз занимает минуты
```

```ts
// packages/ingest/src/scan.ts — стримом из S3, файл не материализуется на диск
import NodeClam from 'clamscan';
const clam = await new NodeClam().init({
  clamdscan: { host: 'clamav', port: 3310, timeout: 120_000 },
  preference: 'clamdscan',
});
const body = (await s3.send(new GetObjectCommand({ Bucket, Key }))).Body as Readable;
const { isInfected, viruses } = await clam.scanStream(body);
```

**State machine**: `asset.processing_status` goes
`pending → scanning → processing → ready`, or `→ failed` with
`processing_error = 'infected: <name>'`. An infected object is **deleted from S3
immediately**, the `asset` row is kept with the failure reason, and an `audit_log` entry
`asset.infected` is written. The uploader is notified; the file is never re-servable.

`[UNVERIFIED]` ClamAV is **not** a ФСТЭК-certified антивирус (§3.5). Keep the scanner
behind an interface (`interface FileScanner { scan(stream): Promise<Verdict> }`) so
Kaspersky Scan Engine / Dr.Web can replace it without touching the pipeline.

### 6.4 Ingestion pipeline: upload → text → chunks → embeddings

```
 client  ──presigned PUT──▶  S3/MinIO
    │
    └── POST /assets/:id/complete ──▶ Nest ──▶ BullMQ queue "ingest"
                                                   │
   ┌───────────────────────────────────────────────┘
   ▼
 [1] verify        HeadObject: размер, ETag; sha256 стримом → asset.sha256
                   ДЕДУПЛИКАЦИЯ: если sha256 уже есть — переиспользовать извлечённый текст
   ▼
 [2] scan          ClamAV INSTREAM (§6.3)                → status=scanning
   ▼
 [3] extract       по MIME:                               → status=processing
                     .docx  → mammoth@1.12.1 (HTML+стили) ИЛИ прямой разбор OOXML
                              для сохранения нумерации статей — критично для законопроектов
                     .pdf   → pdf-parse@2.4.5 текстовый слой;
                              если текста < 100 симв/стр → OCR (Tesseract rus / PaddleOCR)
                     .rtf/.odt → LibreOffice --headless --convert-to docx (sidecar)
                     image  → OCR
                     audio  → ASR (см. отдельный документ), → transcript/transcript_segment
                     link   → SourceFetcher из packages/ingest (Jina/Playwright, §00)
   ▼
 [4] normalize     нормализация типографики (ё, «», неразрывные пробелы, № ),
                   распознавание структуры: Статья/Часть/Пункт/Подпункт/Абзац
                   → те же правила, что в 04-retrieval.md §5
   ▼
 [5] chunk         структурно-осознанное разбиение (04-retrieval.md §5.2)
   ▼
 [6] embed         батч → EMBEDDINGS_BASE_URL, 1024-мерные векторы
   ▼
 [7] index         upsert в Qdrant (payload: assetId, projectId, orgId — ФИЛЬТР
                   АРЕНДАТОРА ОБЯЗАТЕЛЕН) + tsvector в Postgres
   ▼
 [8] done          asset.extracted_text, status=ready
                   realtime.send(... 'asset:ready', 'project:<id>', true)
```

Two non-obvious requirements:

* **Tenant filter in the vector store is mandatory and is *not* covered by RLS.** Qdrant has
  no RLS. Every search must carry `filter: { must: [{ key: 'projectId', match: { any: visibleProjectIds } }] }`.
  Get `visibleProjectIds` from `app.visible_project_ids()` — **the same function**, so
  Postgres and Qdrant cannot disagree. Deleting a project must enqueue a Qdrant purge; a
  dangling vector is a data leak.
* **Idempotency.** Key every job by `sha256` so a retried job does not double-index. Steps
  1–8 must each be resumable: store the furthest completed step on the `asset` row.

Verified packages `[V-npm]`: `mammoth@1.12.1`, `pdf-parse@2.4.5`, `@aws-sdk/client-s3@3.1115.0`,
`clamscan@2.4.0`, `tus-js-client@4.3.1`, `@tus/server@2.4.4`, `unzipper@0.12.5`.

---

## 7. Background jobs and scheduling

### 7.1 The candidates

| | Transport | Licence | Self-host | Fit |
|---|---|---|---|---|
| **BullMQ** `6.1.2` `[V-npm]` | Redis | MIT `[V-src]` | Trivial (Redis already in compose) | Rate limiting, priorities, flows/parent-child, repeatable jobs, delayed jobs |
| **pg-boss** `12.27.0` `[V-npm]` | Postgres `SKIP LOCKED` | MIT `[V-src]` | Zero new infra | ACID with the business transaction; archiving, singleton keys, cron |
| **pgmq** `1.5.1` | Postgres | PostgreSQL Lic. `[V-src]` | **Already in `supabase/postgres`** `[V-src]` | Primitive queue only — no scheduler, no retry policy, no UI |
| **Temporal** | own cluster | Apache 2.0 | Heavy: server + Cassandra/Postgres + Elasticsearch; reported €2.5–4.5k/mo self-hosted `[V-search]` | Durable execution, multi-week workflows |
| **Inngest** | own server | **SSPL** at release, converts to Apache 2.0 after 3 years `[V-search]` | Possible but SSPL | Good DX, wrong licence for a state contour |

### 7.2 Recommendation: **BullMQ + Redis** as the executor, `pg_cron` as the clock

Reasoning:

1. Redis is **already** in `infra/docker-compose.yml` with `appendonly yes` and
   `maxmemory-policy noeviction` — the latter is exactly right for a queue (an evicted job
   is a lost job) and suggests it was provisioned with this in mind.
2. Our workloads need the features Redis-backed BullMQ has and pgmq does not:
   **rate limiting** (LLM/embedding endpoint concurrency), **flows** (extract → chunk →
   embed → index as a parent-child graph), **priorities** (an interactive agent run must
   preempt a nightly crawl), **backoff**.
3. Embedding and ASR jobs are **CPU/GPU-heavy and long**. Running them through Postgres
   means long-lived transactions or heavy polling against the same DB that serves
   interactive RLS queries. Keep that traffic off the primary.
4. `pg_cron 1.6.4` is in the image `[V-src]` — use it as the **scheduler of record** (it
   survives app restarts and is visible to a DBA), and have it enqueue into BullMQ via a
   thin Nest endpoint or via `pgmq` + a bridge:

```sql
select cron.schedule('sozd-poll-hourly', '7 * * * *', $$
  select pgmq.send('jobs_bridge', jsonb_build_object('queue','crawl','name','sozd.poll'));
$$);
select cron.schedule('deputy-registry-nightly', '30 2 * * *', $$
  select pgmq.send('jobs_bridge', jsonb_build_object('queue','sync','name','deputies.reconcile'));
$$);
```

A single Nest worker reads `pgmq` with `pgmq.read/pgmq.delete` and `queue.add(...)` into
BullMQ. This gives cron durability without putting the whole queue in Postgres.
Verified npm client: `pgmq-js@1.3.1` `[V-npm]`. `@nestjs/bullmq@11.0.5` and
`@nestjs/schedule@6.1.3` are both current `[V-npm]`.

```ts
// apps/worker/src/queues.ts
export const QUEUES = {
  ingest:   'ingest',     // extract → chunk → embed → index (flow)
  crawl:    'crawl',      // СОЗД / duma.gov.ru / pravo.gov.ru
  embed:    'embed',      // rate-limited: { max: 8, duration: 1000 }
  asr:      'asr',        // concurrency 1–2, GPU-bound
  agent:    'agent',      // длинные прогоны Mastra
  notify:   'notify',
} as const;

new Worker(QUEUES.embed, processor, {
  connection,
  concurrency: 4,
  limiter: { max: 8, duration: 1000 },      // защита эмбеддинг-эндпоинта
});
```

**When to revisit.** If the deployment must be single-container / no-Redis (a real
possibility for an on-prem installation в аппарате фракции), **pg-boss@12.27.0** is the
swap: same job model, one fewer service. Design the worker layer behind a
`JobQueue` interface from day one so the swap is a module, not a rewrite.

### 7.3 Long agent runs are *not* a queue problem

`03-mastra.md` §2.5.1 already establishes Mastra `suspend`/`resume` for human-in-the-loop.
A законотворческий workflow can sit suspended for **days** waiting for a депутат to approve
a formulation. Do not model that as a job with a visibility timeout.

**Pattern:** BullMQ runs a *segment* of the workflow to the next suspension point, persists
state to `public.workflow_run` / `workflow_step` (already in `collaboration.ts`), and the
job **completes**. Resumption is a *new* job enqueued by the HTTP handler that receives the
human's decision. Progress is streamed to the UI with `realtime.send()` from the worker.
This keeps every job short, makes crash recovery trivial, and means we never need Temporal.

Reconsider Temporal only if we end up with multi-service sagas that must be atomic across
Qdrant + Postgres + TypeDB. `[UNVERIFIED — no such requirement identified yet]`

---

## 8. Observability

### 8.1 Recommendation: OpenTelemetry as the wire, Langfuse as the LLM backend

They are not competitors. Mastra's telemetry emits **OTel spans**
(`03-mastra.md` §2.9); Langfuse ingests OTel natively `[V-search]`. So:

```
Mastra agents ─┐
NestJS API    ─┼─ OTel SDK ─▶ OTel Collector ─┬─▶ Langfuse   (LLM traces, prompts, scores)
Next.js SSR   ─┘                               ├─▶ Tempo/Jaeger (обычные трейсы)
                                               ├─▶ Prometheus  (метрики)
                                               └─▶ Loki        (логи)
```

One instrumentation, several sinks. Verified `[V-npm]`:
`@opentelemetry/sdk-node@0.221.0`, `@opentelemetry/auto-instrumentations-node@0.79.0`,
`@langfuse/otel@5.10.1`, `@langfuse/tracing@5.10.1`, `nestjs-pino@4.6.1`,
`@nestjs/terminus@11.1.1`.

**Do not** rely on "Mastra built-in observability" as the *storage* layer — it is an
exporter, and the useful part (prompt/completion diffing, scoring, dataset curation,
cost-per-run) lives in Langfuse.

### 8.2 The Langfuse version problem in this repo — action required

`infra/docker-compose.yml` pins `langfuse/langfuse:2` with a single Postgres. Docker Hub
shows current tags `4.15` / `4` and `3.225` / `3` `[V-src]`. Facts:

* Langfuse was **acquired by ClickHouse in January 2026**; the core stays MIT and
  self-hostable `[V-search]` https://clickhouse.com/blog/langfuse-and-clickhouse-a-new-data-stack-for-modern-llm-applications
* `LICENSE` confirms: `Copyright (c) 2023-2026 ClickHouse, Inc.` +
  `Portions of this software are licensed as follows:` — **MIT core, proprietary `/ee`**
  `[V-src]`. SSO enforcement, RBAC beyond basics, and some data-retention features are EE.
  Plain self-hosted tracing is MIT.
* v3+ requires **ClickHouse (≥24.3) + Redis + S3/MinIO + langfuse-web + langfuse-worker**
  — six services `[V-search]` https://langfuse.com/self-hosting/deployment/infrastructure/clickhouse
* Recommended footprint: **4+ vCPU, 16 GiB RAM, ≥100 GiB storage** `[V-search]`

**Decision:** keep `langfuse/langfuse:2` for local dev under the existing `observability`
compose profile (it is one container and good enough for a laptop), and deploy **v3/v4 with
ClickHouse in staging/production only**. Document this explicitly, because a silent version
gap between dev and prod on a tracing tool is how you discover schema-incompatible traces
during an incident. Alternative if the ClickHouse footprint is unacceptable on-prem:
**Phoenix (Arize, ELv2)** or plain OTel → Tempo, giving up prompt-level UX.

### 8.3 Minimum instrumentation to ship in v1

| Signal | Where | Why |
|---|---|---|
| `trace_id` propagated browser → Next → Nest → worker → LLM | OTel context, `nestjs-cls@6.2.1` `[V-npm]` | One id joins a user complaint to an agent run |
| `user.id`, `project.id`, `org.id` as span attributes | Nest interceptor | Per-tenant latency/cost attribution |
| LLM cost + token counts per `workflow_run` | Langfuse | Budget per фракция |
| RLS policy timing | `pg_stat_monitor 2.1` (in image `[V-src]`) | Catches the §2.4 regression before users do |
| `audit_log` write on every privileged action | Nest interceptor | §3.4 requirement, not optional |
| Health/readiness | `@nestjs/terminus@11.1.1` | Postgres, Redis, Qdrant, MinIO, LLM endpoint |

**Do not send traces outside the контур.** `TELEMETRY_ENABLED: 'false'` is already set for
Langfuse in the compose `[repo]`; also set `QDRANT__TELEMETRY_DISABLED` (already set),
`DO_NOT_TRACK=1`, and `NEXT_TELEMETRY_DISABLED=1`. Audit every new dependency for
phone-home behaviour — under §3.5 this is a compliance item, not a preference.

---

## 9. Package manifest (all verified on the npm registry, 2026-08-20) `[V-npm]`

```jsonc
// apps/api (NestJS)
"@nestjs/core":            "^11.2.1",
"@nestjs/passport":        "^11.0.5",
"@nestjs/websockets":      "^11.2.1",   // только если понадобится socket.io для collab
"@nestjs/bullmq":          "^11.0.5",
"@nestjs/schedule":        "^6.1.3",
"@nestjs/terminus":        "^11.1.1",
"@nestjs/throttler":       "^6.5.0",
"passport-jwt":            "^4.0.1",
"jwks-rsa":                "^4.1.0",
"nestjs-pino":             "^4.6.1",
"nestjs-cls":              "^6.2.1",
"helmet":                  "^8.3.0",
"@supabase/supabase-js":   "^2.112.3",  // ТОЛЬКО admin-API и storage, не для данных
"drizzle-orm":             "^0.45.2",
"pg":                      "^8.23.0",
"bullmq":                  "^6.1.2",
"pgmq-js":                 "^1.3.1",
"@aws-sdk/client-s3":      "^3.1115.0",
"@aws-sdk/s3-request-presigner": "^3.1115.0",
"clamscan":                "^2.4.0",
"mammoth":                 "^1.12.1",
"pdf-parse":               "^2.4.5",
"unzipper":                "^0.12.5",
"@opentelemetry/sdk-node": "^0.221.0",
"@opentelemetry/auto-instrumentations-node": "^0.79.0",
"@langfuse/otel":          "^5.10.1",
"@langfuse/tracing":       "^5.10.1"

// apps/web (Next.js)
"@supabase/supabase-js":   "^2.112.3",
"@supabase/ssr":           "^0.12.4",   // cookie-based сессии в App Router

// альтернативы / запасные варианты
"pg-boss":                 "^12.27.0",  // если отказываемся от Redis
"kysely":                  "^0.29.5",   // если понадобится типизированный сложный SQL
"tus-js-client":           "^4.3.1",    // резюмируемые загрузки крупных аудио/видео
"@tus/server":             "^2.4.4",
"openid-client":           "^6.8.7",    // если ЕСИА-шлюз придётся подключать в обход GoTrue
"socket.io":               "^4.8.3"     // apps/collab (Yjs)
```

Images (verified on Docker Hub `[V-src]`):
`supabase/postgres:17.6.1.165`, `langfuse/langfuse:4.15` (prod) / `:2` (dev),
`qdrant/qdrant:v1.16.1`, `redis:8-alpine`, `clamav/clamav:1.4`.

---

## 10. Open questions and risks

### Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **`supabase/postgres` vs Postgres Pro Certified** is an either/or. Certified Russian Postgres does not ship `pgmq`/`pgroonga`/`vector 0.8.2`; Supabase Realtime + GoTrue assume Supabase's schema bootstrap. Choosing wrong costs a rewrite of §2 and §5. | **High** | Decide before the schema hardens. Keep RLS helpers in plain SQL (they are); keep vectors in Qdrant (already decided) so the DB is not the AI dependency; treat `pgmq` as optional (§7.2 works without it). |
| R2 | RLS performance collapse at scale — §2.4's array pattern is a design claim, **not measured**. | Medium-High | Build the `pgtap` suite (§2.8) *and* a load fixture: 200 орг, 5 000 профилей, 20 000 проектов, 2 млн `draft`. Gate merges on `explain (analyze)` regression. |
| R3 | **ЕСИА is a 12–18 month organisational project**, not a sprint. Building v1 assuming it exists will block launch. | High | v1 ships email+TOTP+optional SAML. `profile.esia_oid` reserved now, wiring later. |
| R4 | ФСТЭК № 117 (в силе с 01.03.2026) applies broadly and demands **continuous** аттестация; a floating dependency graph invalidates it. | High | Pin every image by digest, every npm dep exactly, from day one. Reproducible builds. SBOM in CI. |
| R5 | Langfuse v2→v3/v4 gap between dev and prod (§8.2). | Medium | Pin both explicitly; document; plan the ClickHouse footprint in the prod compose. |
| R6 | Realtime `realtime.messages` policy runs `app.conversation_ids()` on **every channel join**. A big org opening 30 conversations = 30 evaluations. | Medium | Cache the array per connection in Nest and issue a short-lived channel token; or denormalise into a `conversation_member_flat` table refreshed by trigger. |
| R7 | **Qdrant has no RLS.** A forgotten tenant filter in one query is a cross-party data leak — the single most damaging failure mode for this product. | **High** | Never call the Qdrant client directly from feature code. One `RetrievalService.search()` that *requires* a `viewerId` and derives the filter from `app.visible_project_ids()`. Lint rule banning direct imports of the Qdrant client outside that module. |
| R8 | MinIO AGPL-3.0 in a state contour may raise objections. | Low-Medium | S3 API is the abstraction; swap to Yandex Object Storage / SeaweedFS with an env change. |
| R9 | `message_read` table growth (§5.3). | Medium | Trigger-enforced participant cap; `pg_partman` on `message`. |
| R10 | Cross-org `project_share` with `expires_at` — expiry is checked in the helper, so a **cached** `visible_project_ids()` array inside a long transaction can outlive the grant. | Low | Grants expire at hour granularity in practice; additionally re-check `app.project_role()` in the write path (already the case). |

### Open questions

1. **Партия → фракция inheritance direction (§2.2).** Upward closure is my proposal. Does
   a Партия administrator expect to see фракция projects by default? This is a political
   question with a one-line SQL consequence — get it answered before launch.
2. **Who may create a cross-party `project_share`?** §2.6 restricts it to project `owner`
   and caps the granted role at `editor`. Is that the right political guardrail, or should
   it require two-person approval (депутат + аппарат)?
3. **Is Doomatel a ГИС?** Determines whether приказ ФСТЭК № 117 applies in full, whether
   реестр отечественного ПО matters, and therefore R1. Needs an answer from the customer,
   not from us.
4. **Retention policy for `message` and `draft_version`.** Законотворческая переписка may
   be subject to archival requirements (ФЗ-125 «Об архивном деле»). Unresearched.
5. **MFA mandatory or optional?** §4.1 has the `aal2` guard ready. Recommend: mandatory for
   `is_verified` deputies, optional for помощники. Product decision.
6. **Does `независимый депутат` need a synthetic organisation row?** The schema has
   `organization_kind = 'independent'`. Cleaner alternative: `organization_id IS NULL` +
   `scope='personal'`. Both are supported by the RLS above; pick one and enforce it with a
   check constraint, or the two paths will drift.
7. **Yjs/collab transport (§5.2)** — confirmed as a separate service, but its auth story is
   unwritten: it needs to verify the same Supabase JWT and call `app.draft_role()` before
   attaching a document. Not covered here.

---

## 11. What to build first (ordering that de-risks the most)

1. `packages/db/migrations/0000_rls_helpers.sql` + `0001_rls_policies.sql` (§2.5–2.6) and
   the `pgtap` suite (§2.8), **including the cross-party fixture**. Everything else is
   easier to change than this.
2. `TxService.asUser()` (§4.3) — because it is what makes those policies actually execute.
3. `SupabaseJwtStrategy` + `Aal2Guard` (§4.1), with the project switched to **asymmetric
   JWT keys** and `SUPABASE_JWT_SECRET` deleted from `.env.example` for non-Auth services.
4. Invitation → verification flow (§3.2) — it is the gate everything else sits behind.
5. `RetrievalService.search()` with the mandatory tenant filter (R7) before any agent can
   call retrieval.
6. Chat: schema additions (§5.3), policies (§5.4), broadcast trigger, client channels.
7. Upload → scan → extract pipeline (§6.4) behind BullMQ (§7.2).
8. OTel + Langfuse wiring (§8.3).
