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
  select app.role_max(v_role, min_by.role) into v_role
  from (
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
  ) as min_by;

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
  select app.role_max(v_role, g.role) into v_role
  from (
    select a.role from public.draft_acl a
    where a.draft_id = p_draft
      and a.effect = 'grant'
      and (a.expires_at is null or a.expires_at > now())
      and (   a.user_id = v_uid
           or a.organization_id = any (v_orgs)
           or a.workgroup_id    = any (v_wgs))
    order by app.role_rank(a.role)
    limit 1
  ) g;

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
