-- Укрепление функций проверки доступа.
--
-- Что исправляется.
--
-- 1. Вспомогательные функции принимают `p_user uuid DEFAULT current_user_id()`.
--    Это удобно внутри политик, но означает, что любой аутентифицированный
--    пользователь мог вызвать `public.project_role(<проект>, <чужой uuid>)`
--    и узнать роль другого депутата в чужом проекте. Все функции в схеме
--    `public` доступны как RPC-методы PostgREST, поэтому вызвать их можно
--    прямо из браузера. Добавляется проверка: спрашивать можно только о себе,
--    исключение — сервисная роль, которой это нужно для прикладной логики.
--
-- 2. Вводится `public.visible_project_ids(uuid)` — единственный источник
--    сведений о том, какие проекты видит пользователь. Тем же перечнем
--    ограничивается и выдача векторного поиска. Раньше это правило
--    существовало только на словах: политики базы и фильтр поиска считали
--    видимость независимо, и их расхождение никак не обнаруживалось.
--
-- Замечание о `LANGUAGE sql` против `plpgsql`.
-- Проверено экспериментом на PostgreSQL 16 (EXPLAIN VERBOSE):
--   * обычная функция `LANGUAGE sql STABLE` встраивается планировщиком —
--     условие сворачивается в Index Scan;
--   * та же функция с `SECURITY DEFINER` **не встраивается** — вызов остаётся
--     в плане как Filter, и граница прав сохраняется.
-- Следовательно, требование переписывать все вспомогательные функции
-- на plpgsql ради сохранения границы прав не обосновано: достаточно
-- `SECURITY DEFINER`. Функции оставлены на `LANGUAGE sql`.

-- ── Проверка «спрашиваю о себе» ─────────────────────────────────────────────

/*
 * Признак обращения от имени сервиса.
 *
 * Роль здесь проверять нельзя: `assert_self` вызывается изнутри функций
 * `SECURITY DEFINER`, а внутри них `current_user` уже равен владельцу функции,
 * и любая проверка роли всегда даёт «сервис». Это подтвердилось на практике:
 * первая версия проверки не срабатывала именно по этой причине.
 *
 * Различие проводится по наличию удостоверения: PostgREST всегда выставляет
 * `request.jwt.claims`, а прикладной сервис подключается сервисными
 * учётными данными и не выставляет их. Обращение без удостоверения
 * возможно только со стороны сервиса, у которого эти данные и так есть.
 */
CREATE OR REPLACE FUNCTION public.is_service_context()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_user_id() IS NULL
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.assert_self(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF public.is_service_context() THEN
    RETURN p_user;
  END IF;
  IF p_user IS DISTINCT FROM public.current_user_id() THEN
    RAISE EXCEPTION 'Запрос сведений о правах другого пользователя запрещён'
      USING ERRCODE = '42501';
  END IF;
  RETURN p_user;
END;
$$;
--> statement-breakpoint

-- ── Вспомогательные функции с проверкой ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_organization_ids(p_user uuid)
RETURNS TABLE (organization_id uuid, role public.member_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE checked AS (
    SELECT public.assert_self(p_user) AS uid
  ),
  direct AS (
    SELECT m.organization_id, m.role
    FROM public.membership m, checked c
    WHERE m.user_id = c.uid AND m.status = 'active'
  ),
  tree AS (
    SELECT d.organization_id, d.role FROM direct d
    UNION
    SELECT o.id, t.role
    FROM public.organization o
    JOIN tree t ON o.parent_id = t.organization_id
    WHERE public.role_at_least(t.role, 'admin')
  )
  SELECT DISTINCT ON (t.organization_id) t.organization_id, t.role
  FROM tree t
  ORDER BY t.organization_id, public.role_weight(t.role) DESC
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.project_role(
  p_project uuid,
  p_user uuid DEFAULT public.current_user_id()
)
RETURNS public.member_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_best integer := 0;
  v_weight integer;
  v_project public.project%ROWTYPE;
BEGIN
  IF p_user IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.assert_self(p_user);

  SELECT * INTO v_project FROM public.project WHERE id = p_project;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_project.owner_id = p_user THEN
    v_best := public.role_weight('owner');
  END IF;

  SELECT public.role_weight(pm.role) INTO v_weight
  FROM public.project_member pm
  WHERE pm.project_id = p_project AND pm.user_id = p_user;
  IF v_weight IS NOT NULL AND v_weight > v_best THEN
    v_best := v_weight;
  END IF;

  IF v_project.organization_id IS NOT NULL THEN
    SELECT max(public.role_weight(u.role)) INTO v_weight
    FROM public.user_organization_ids(p_user) u
    WHERE u.organization_id = v_project.organization_id;
    IF v_weight IS NOT NULL AND v_weight > v_best THEN
      v_best := v_weight;
    END IF;
  END IF;

  IF v_project.workgroup_id IS NOT NULL THEN
    SELECT public.role_weight(wm.role) INTO v_weight
    FROM public.workgroup_member wm
    WHERE wm.workgroup_id = v_project.workgroup_id
      AND wm.user_id = p_user
      AND wm.status = 'active';
    IF v_weight IS NOT NULL AND v_weight > v_best THEN
      v_best := v_weight;
    END IF;
  END IF;

  SELECT max(public.role_weight(ps.role)) INTO v_weight
  FROM public.project_share ps
  WHERE ps.project_id = p_project
    AND (ps.expires_at IS NULL OR ps.expires_at > now())
    AND (
      (ps.organization_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_organization_ids(p_user) u
        WHERE u.organization_id = ps.organization_id
      ))
      OR
      (ps.workgroup_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workgroup_member wm
        WHERE wm.workgroup_id = ps.workgroup_id
          AND wm.user_id = p_user
          AND wm.status = 'active'
      ))
    );
  IF v_weight IS NOT NULL AND v_weight > v_best THEN
    v_best := v_weight;
  END IF;

  RETURN CASE
    WHEN v_best >= 60 THEN 'owner'::public.member_role
    WHEN v_best >= 50 THEN 'admin'::public.member_role
    WHEN v_best >= 40 THEN 'editor'::public.member_role
    WHEN v_best >= 30 THEN 'contributor'::public.member_role
    WHEN v_best >= 20 THEN 'reviewer'::public.member_role
    WHEN v_best >= 10 THEN 'viewer'::public.member_role
    ELSE NULL
  END;
END;
$$;
--> statement-breakpoint

/*
 * Единственный источник сведений о видимости проектов.
 *
 * Этой же функцией ограничивается выдача векторного поиска: сервис получает
 * из неё перечень идентификаторов и подставляет его в фильтр Qdrant.
 * Пока правило существовало только в описании архитектуры, расхождение
 * между политиками базы и фильтром поиска не мог обнаружить никто.
 */
CREATE OR REPLACE FUNCTION public.visible_project_ids(
  p_user uuid DEFAULT public.current_user_id()
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(p.id), ARRAY[]::uuid[])
  FROM public.project p
  WHERE public.project_role(p.id, public.assert_self(p_user)) IS NOT NULL
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.visible_tenant_ids(
  p_user uuid DEFAULT public.current_user_id()
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Публичный корпус доступен всем аутентифицированным пользователям,
  -- поэтому «public» присутствует в перечне всегда.
  SELECT ARRAY['public']::text[] || coalesce(
    (SELECT array_agg(u.organization_id::text)
     FROM public.user_organization_ids(public.assert_self(p_user)) u),
    ARRAY[]::text[]
  )
$$;
--> statement-breakpoint

-- ── Ограничение вызова функций ─────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    -- Неаутентифицированному пользователю функции доступа не нужны вовсе.
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon';
  END IF;
END $$;
