-- ═══════════════════════════════════════════════════════════════════════════
-- Разграничение доступа на уровне строк (RLS).
--
-- Принципы:
--  1. Прикладные записи выполняет сервис NestJS сервисной ролью; RLS — второй
--     рубеж защиты и обязательное условие для прямых запросов из браузера.
--  2. Все проверки принадлежности вынесены в функции SECURITY DEFINER.
--     Это единственный способ избежать бесконечной рекурсии политик:
--     политика на `project` обращается к `project_member`, политика на
--     `project_member` — к `project`, и без обхода RLS внутри функции
--     PostgreSQL уходит в рекурсию.
--  3. Функции помечены STABLE и обращаются к таблицам напрямую, поэтому
--     планировщик кеширует их результат в пределах запроса.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Вспомогательные функции ────────────────────────────────────────────────

-- Идентификатор текущего пользователя. Работает и в Supabase (auth.uid()),
-- и при прямом подключении с выставленным request.jwt.claims.
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;
--> statement-breakpoint

-- Числовой вес роли: чем больше, тем шире полномочия.
CREATE OR REPLACE FUNCTION public.role_weight(p_role public.member_role)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner'       THEN 60
    WHEN 'admin'       THEN 50
    WHEN 'editor'      THEN 40
    WHEN 'contributor' THEN 30
    WHEN 'reviewer'    THEN 20
    WHEN 'viewer'      THEN 10
    ELSE 0
  END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.role_at_least(
  p_role public.member_role,
  p_min  public.member_role
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.role_weight(p_role) >= public.role_weight(p_min)
$$;
--> statement-breakpoint

-- Организации, в которых пользователь состоит, включая дочерние
-- (администратор партии видит проекты её фракций).
CREATE OR REPLACE FUNCTION public.user_organization_ids(p_user uuid)
RETURNS TABLE (organization_id uuid, role public.member_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE direct AS (
    SELECT m.organization_id, m.role
    FROM public.membership m
    WHERE m.user_id = p_user AND m.status = 'active'
  ),
  tree AS (
    SELECT d.organization_id, d.role FROM direct d
    UNION
    -- Полномочия администратора распространяются на дочерние организации.
    SELECT o.id, t.role
    FROM public.organization o
    JOIN tree t ON o.parent_id = t.organization_id
    WHERE public.role_at_least(t.role, 'admin')
  )
  -- Один пользователь может получить доступ к организации по нескольким
  -- основаниям; берём наиболее широкую роль.
  SELECT DISTINCT ON (t.organization_id) t.organization_id, t.role
  FROM tree t
  ORDER BY t.organization_id, public.role_weight(t.role) DESC
$$;
--> statement-breakpoint

-- Упрощённая проверка членства — используется в политиках, где роль неважна.
CREATE OR REPLACE FUNCTION public.is_organization_member(p_org uuid, p_user uuid DEFAULT public.current_user_id())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_organization_ids(p_user) u
    WHERE u.organization_id = p_org
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_workgroup_member(p_workgroup uuid, p_user uuid DEFAULT public.current_user_id())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workgroup_member wm
    WHERE wm.workgroup_id = p_workgroup
      AND wm.user_id = p_user
      AND wm.status = 'active'
  )
$$;
--> statement-breakpoint

-- ── Ключевая функция: роль пользователя в проекте ──────────────────────────
--
-- Учитываются четыре независимых основания доступа. Именно последнее
-- (`project_share`) делает возможной совместную работу депутатов разных
-- партий: проект остаётся во владении одной организации, но доступ выдаётся
-- другой организации или межфракционной рабочей группе целиком.
--
-- Итоговая роль — максимальная из всех оснований.
CREATE OR REPLACE FUNCTION public.project_role(p_project uuid, p_user uuid DEFAULT public.current_user_id())
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

  SELECT * INTO v_project FROM public.project WHERE id = p_project;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 1. Владелец проекта.
  IF v_project.owner_id = p_user THEN
    v_best := public.role_weight('owner');
  END IF;

  -- 2. Прямое участие в проекте (в том числе приглашённые из других партий).
  SELECT public.role_weight(pm.role) INTO v_weight
  FROM public.project_member pm
  WHERE pm.project_id = p_project AND pm.user_id = p_user;
  IF v_weight IS NOT NULL AND v_weight > v_best THEN
    v_best := v_weight;
  END IF;

  -- 3. Членство в организации-владельце (для проектов партии или фракции).
  IF v_project.organization_id IS NOT NULL THEN
    SELECT max(public.role_weight(u.role)) INTO v_weight
    FROM public.user_organization_ids(p_user) u
    WHERE u.organization_id = v_project.organization_id;
    IF v_weight IS NOT NULL AND v_weight > v_best THEN
      v_best := v_weight;
    END IF;
  END IF;

  -- 4. Членство в рабочей группе-владельце.
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

  -- 5. Проект передан в доступ организации или рабочей группе целиком.
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

CREATE OR REPLACE FUNCTION public.can_read_project(p_project uuid, p_user uuid DEFAULT public.current_user_id())
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.project_role(p_project, p_user) IS NOT NULL
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.can_write_project(p_project uuid, p_user uuid DEFAULT public.current_user_id())
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.role_at_least(
    coalesce(public.project_role(p_project, p_user), 'viewer'),
    'contributor'
  ) AND public.project_role(p_project, p_user) IS NOT NULL
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.can_manage_project(p_project uuid, p_user uuid DEFAULT public.current_user_id())
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.project_role(p_project, p_user) IS NOT NULL
     AND public.role_at_least(public.project_role(p_project, p_user), 'admin')
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation uuid, p_user uuid DEFAULT public.current_user_id())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participant cp
    WHERE cp.conversation_id = p_conversation
      AND cp.user_id = p_user
      AND cp.left_at IS NULL
  )
$$;
--> statement-breakpoint

-- ── Включение RLS ──────────────────────────────────────────────────────────

ALTER TABLE public.profile                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workgroup                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workgroup_member         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_member           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_share            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_version            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_yjs_update         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_suggestion         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reaction         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comment             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segment       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_run             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_step            ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── Профили ────────────────────────────────────────────────────────────────
-- Пользователь видит себя и тех, с кем состоит в общей организации,
-- рабочей группе или проекте. Каталог депутатов не открыт целиком.

CREATE POLICY profile_select ON public.profile FOR SELECT TO authenticated
USING (
  id = public.current_user_id()
  OR EXISTS (
    SELECT 1
    FROM public.membership mine
    JOIN public.membership theirs ON theirs.organization_id = mine.organization_id
    WHERE mine.user_id = public.current_user_id() AND mine.status = 'active'
      AND theirs.user_id = public.profile.id AND theirs.status = 'active'
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_member mine
    JOIN public.project_member theirs ON theirs.project_id = mine.project_id
    WHERE mine.user_id = public.current_user_id()
      AND theirs.user_id = public.profile.id
  )
);
--> statement-breakpoint

CREATE POLICY profile_update_self ON public.profile FOR UPDATE TO authenticated
USING (id = public.current_user_id())
WITH CHECK (id = public.current_user_id());
--> statement-breakpoint

CREATE POLICY profile_insert_self ON public.profile FOR INSERT TO authenticated
WITH CHECK (id = public.current_user_id());
--> statement-breakpoint

-- ── Организации ────────────────────────────────────────────────────────────

CREATE POLICY organization_select ON public.organization FOR SELECT TO authenticated
USING (public.is_organization_member(id));
--> statement-breakpoint

CREATE POLICY organization_update ON public.organization FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_organization_ids(public.current_user_id()) u
    WHERE u.organization_id = public.organization.id
      AND public.role_at_least(u.role, 'admin')
  )
)
WITH CHECK (true);
--> statement-breakpoint

-- ── Членство ───────────────────────────────────────────────────────────────

CREATE POLICY membership_select ON public.membership FOR SELECT TO authenticated
USING (user_id = public.current_user_id() OR public.is_organization_member(organization_id));
--> statement-breakpoint

CREATE POLICY membership_manage ON public.membership FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_organization_ids(public.current_user_id()) u
    WHERE u.organization_id = public.membership.organization_id
      AND public.role_at_least(u.role, 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_organization_ids(public.current_user_id()) u
    WHERE u.organization_id = public.membership.organization_id
      AND public.role_at_least(u.role, 'admin')
  )
);
--> statement-breakpoint

-- ── Рабочие группы ─────────────────────────────────────────────────────────

CREATE POLICY workgroup_select ON public.workgroup FOR SELECT TO authenticated
USING (
  public.is_workgroup_member(id)
  OR (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
);
--> statement-breakpoint

CREATE POLICY workgroup_insert ON public.workgroup FOR INSERT TO authenticated
WITH CHECK (created_by = public.current_user_id());
--> statement-breakpoint

CREATE POLICY workgroup_update ON public.workgroup FOR UPDATE TO authenticated
USING (
  created_by = public.current_user_id()
  OR EXISTS (
    SELECT 1 FROM public.workgroup_member wm
    WHERE wm.workgroup_id = public.workgroup.id
      AND wm.user_id = public.current_user_id()
      AND wm.status = 'active'
      AND public.role_at_least(wm.role, 'admin')
  )
)
WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY workgroup_member_select ON public.workgroup_member FOR SELECT TO authenticated
USING (user_id = public.current_user_id() OR public.is_workgroup_member(workgroup_id));
--> statement-breakpoint

CREATE POLICY workgroup_member_manage ON public.workgroup_member FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workgroup w
    WHERE w.id = public.workgroup_member.workgroup_id
      AND w.created_by = public.current_user_id()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workgroup w
    WHERE w.id = public.workgroup_member.workgroup_id
      AND w.created_by = public.current_user_id()
  )
);
--> statement-breakpoint

-- ── Проекты ────────────────────────────────────────────────────────────────

CREATE POLICY project_select ON public.project FOR SELECT TO authenticated
USING (public.can_read_project(id));
--> statement-breakpoint

CREATE POLICY project_insert ON public.project FOR INSERT TO authenticated
WITH CHECK (
  owner_id = public.current_user_id()
  AND (
    scope = 'personal'
    OR (scope IN ('organization', 'faction') AND organization_id IS NOT NULL
        AND public.is_organization_member(organization_id))
    OR (scope = 'workgroup' AND workgroup_id IS NOT NULL
        AND public.is_workgroup_member(workgroup_id))
  )
);
--> statement-breakpoint

CREATE POLICY project_update ON public.project FOR UPDATE TO authenticated
USING (public.can_manage_project(id))
WITH CHECK (public.can_manage_project(id));
--> statement-breakpoint

CREATE POLICY project_delete ON public.project FOR DELETE TO authenticated
USING (public.project_role(id) = 'owner');
--> statement-breakpoint

CREATE POLICY project_member_select ON public.project_member FOR SELECT TO authenticated
USING (user_id = public.current_user_id() OR public.can_read_project(project_id));
--> statement-breakpoint

CREATE POLICY project_member_manage ON public.project_member FOR ALL TO authenticated
USING (public.can_manage_project(project_id))
WITH CHECK (public.can_manage_project(project_id));
--> statement-breakpoint

CREATE POLICY project_share_select ON public.project_share FOR SELECT TO authenticated
USING (public.can_read_project(project_id));
--> statement-breakpoint

CREATE POLICY project_share_manage ON public.project_share FOR ALL TO authenticated
USING (public.can_manage_project(project_id))
WITH CHECK (public.can_manage_project(project_id) AND granted_by = public.current_user_id());
--> statement-breakpoint

-- ── Приглашения ────────────────────────────────────────────────────────────

CREATE POLICY invitation_select ON public.invitation FOR SELECT TO authenticated
USING (
  invited_by = public.current_user_id()
  OR (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  OR (project_id IS NOT NULL AND public.can_manage_project(project_id))
);
--> statement-breakpoint

CREATE POLICY invitation_manage ON public.invitation FOR ALL TO authenticated
USING (invited_by = public.current_user_id())
WITH CHECK (invited_by = public.current_user_id());
--> statement-breakpoint

-- ── Журнал действий: только чтение, только по своим объектам ───────────────

CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated
USING (
  actor_id = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_manage_project(project_id))
  OR (organization_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_organization_ids(public.current_user_id()) u
    WHERE u.organization_id = public.audit_log.organization_id
      AND public.role_at_least(u.role, 'admin')
  ))
);
--> statement-breakpoint

-- Записи журнала неизменяемы: политик INSERT/UPDATE/DELETE для роли
-- authenticated нет, писать может только сервисная роль.

-- ── Документы проекта ──────────────────────────────────────────────────────

CREATE POLICY draft_select ON public.draft FOR SELECT TO authenticated
USING (public.can_read_project(project_id));
--> statement-breakpoint

CREATE POLICY draft_insert ON public.draft FOR INSERT TO authenticated
WITH CHECK (public.can_write_project(project_id) AND created_by = public.current_user_id());
--> statement-breakpoint

CREATE POLICY draft_update ON public.draft FOR UPDATE TO authenticated
USING (public.can_write_project(project_id))
WITH CHECK (public.can_write_project(project_id));
--> statement-breakpoint

CREATE POLICY draft_delete ON public.draft FOR DELETE TO authenticated
USING (public.can_manage_project(project_id));
--> statement-breakpoint

CREATE POLICY draft_version_select ON public.draft_version FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.draft d
  WHERE d.id = public.draft_version.draft_id AND public.can_read_project(d.project_id)
));
--> statement-breakpoint

CREATE POLICY draft_version_insert ON public.draft_version FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.draft d
  WHERE d.id = public.draft_version.draft_id AND public.can_write_project(d.project_id)
));
--> statement-breakpoint

CREATE POLICY draft_yjs_update_all ON public.draft_yjs_update FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.draft d
  WHERE d.id = public.draft_yjs_update.draft_id AND public.can_read_project(d.project_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.draft d
  WHERE d.id = public.draft_yjs_update.draft_id AND public.can_write_project(d.project_id)
));
--> statement-breakpoint

-- Предложение правки может создать и рецензент — в этом смысл режима поправок:
-- вносить изменения в документ он не вправе, а предлагать их обязан.
CREATE POLICY draft_suggestion_select ON public.draft_suggestion FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.draft d
  WHERE d.id = public.draft_suggestion.draft_id AND public.can_read_project(d.project_id)
));
--> statement-breakpoint

CREATE POLICY draft_suggestion_insert ON public.draft_suggestion FOR INSERT TO authenticated
WITH CHECK (
  created_by = public.current_user_id()
  AND EXISTS (
    SELECT 1 FROM public.draft d
    WHERE d.id = public.draft_suggestion.draft_id
      AND public.role_at_least(coalesce(public.project_role(d.project_id), 'viewer'), 'reviewer')
      AND public.project_role(d.project_id) IS NOT NULL
  )
);
--> statement-breakpoint

CREATE POLICY draft_suggestion_update ON public.draft_suggestion FOR UPDATE TO authenticated
USING (
  created_by = public.current_user_id()
  OR EXISTS (
    SELECT 1 FROM public.draft d
    WHERE d.id = public.draft_suggestion.draft_id AND public.can_write_project(d.project_id)
  )
)
WITH CHECK (true);
--> statement-breakpoint

-- ── Беседы и сообщения ─────────────────────────────────────────────────────

CREATE POLICY conversation_select ON public.conversation FOR SELECT TO authenticated
USING (public.is_conversation_participant(id));
--> statement-breakpoint

CREATE POLICY conversation_insert ON public.conversation FOR INSERT TO authenticated
WITH CHECK (created_by = public.current_user_id());
--> statement-breakpoint

CREATE POLICY conversation_update ON public.conversation FOR UPDATE TO authenticated
USING (created_by = public.current_user_id())
WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY conversation_participant_select ON public.conversation_participant FOR SELECT TO authenticated
USING (user_id = public.current_user_id() OR public.is_conversation_participant(conversation_id));
--> statement-breakpoint

CREATE POLICY conversation_participant_manage ON public.conversation_participant FOR ALL TO authenticated
USING (
  user_id = public.current_user_id()
  OR EXISTS (
    SELECT 1 FROM public.conversation c
    WHERE c.id = public.conversation_participant.conversation_id
      AND c.created_by = public.current_user_id()
  )
)
WITH CHECK (
  user_id = public.current_user_id()
  OR EXISTS (
    SELECT 1 FROM public.conversation c
    WHERE c.id = public.conversation_participant.conversation_id
      AND c.created_by = public.current_user_id()
  )
);
--> statement-breakpoint

CREATE POLICY message_select ON public.message FOR SELECT TO authenticated
USING (public.is_conversation_participant(conversation_id));
--> statement-breakpoint

CREATE POLICY message_insert ON public.message FOR INSERT TO authenticated
WITH CHECK (
  public.is_conversation_participant(conversation_id)
  AND (author_id = public.current_user_id() OR role <> 'user')
);
--> statement-breakpoint

-- Редактировать и удалять можно только собственные сообщения.
CREATE POLICY message_update_own ON public.message FOR UPDATE TO authenticated
USING (author_id = public.current_user_id())
WITH CHECK (author_id = public.current_user_id());
--> statement-breakpoint

CREATE POLICY message_reaction_all ON public.message_reaction FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.message m
  WHERE m.id = public.message_reaction.message_id
    AND public.is_conversation_participant(m.conversation_id)
))
WITH CHECK (user_id = public.current_user_id());
--> statement-breakpoint

-- ── Задачи ─────────────────────────────────────────────────────────────────

CREATE POLICY task_select ON public.task FOR SELECT TO authenticated
USING (
  assignee_id = public.current_user_id()
  OR created_by = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_read_project(project_id))
  OR (workgroup_id IS NOT NULL AND public.is_workgroup_member(workgroup_id))
  OR (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
);
--> statement-breakpoint

CREATE POLICY task_insert ON public.task FOR INSERT TO authenticated
WITH CHECK (
  created_by = public.current_user_id()
  AND (
    (project_id IS NOT NULL AND public.can_write_project(project_id))
    OR (workgroup_id IS NOT NULL AND public.is_workgroup_member(workgroup_id))
    OR (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
    OR (project_id IS NULL AND workgroup_id IS NULL AND organization_id IS NULL)
  )
);
--> statement-breakpoint

CREATE POLICY task_update ON public.task FOR UPDATE TO authenticated
USING (
  assignee_id = public.current_user_id()
  OR created_by = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_write_project(project_id))
)
WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY task_delete ON public.task FOR DELETE TO authenticated
USING (
  created_by = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_manage_project(project_id))
);
--> statement-breakpoint

CREATE POLICY task_comment_select ON public.task_comment FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.task t WHERE t.id = public.task_comment.task_id));
--> statement-breakpoint

CREATE POLICY task_comment_insert ON public.task_comment FOR INSERT TO authenticated
WITH CHECK (author_id = public.current_user_id());
--> statement-breakpoint

-- ── Материалы, совещания, расшифровки ──────────────────────────────────────

CREATE POLICY asset_select ON public.asset FOR SELECT TO authenticated
USING (
  uploaded_by = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_read_project(project_id))
  OR (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
);
--> statement-breakpoint

CREATE POLICY asset_insert ON public.asset FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = public.current_user_id()
  AND (project_id IS NULL OR public.can_write_project(project_id))
);
--> statement-breakpoint

CREATE POLICY asset_delete ON public.asset FOR DELETE TO authenticated
USING (
  uploaded_by = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_manage_project(project_id))
);
--> statement-breakpoint

CREATE POLICY meeting_select ON public.meeting FOR SELECT TO authenticated
USING (
  created_by = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_read_project(project_id))
  OR (workgroup_id IS NOT NULL AND public.is_workgroup_member(workgroup_id))
  OR (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
);
--> statement-breakpoint

CREATE POLICY meeting_insert ON public.meeting FOR INSERT TO authenticated
WITH CHECK (created_by = public.current_user_id());
--> statement-breakpoint

CREATE POLICY transcript_select ON public.transcript FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.meeting m WHERE m.id = public.transcript.meeting_id));
--> statement-breakpoint

CREATE POLICY transcript_segment_select ON public.transcript_segment FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.transcript t WHERE t.id = public.transcript_segment.transcript_id));
--> statement-breakpoint

-- ── Рабочие процессы ───────────────────────────────────────────────────────

CREATE POLICY workflow_run_select ON public.workflow_run FOR SELECT TO authenticated
USING (
  started_by = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_read_project(project_id))
);
--> statement-breakpoint

CREATE POLICY workflow_run_insert ON public.workflow_run FOR INSERT TO authenticated
WITH CHECK (
  started_by = public.current_user_id()
  AND (project_id IS NULL OR public.can_write_project(project_id))
);
--> statement-breakpoint

CREATE POLICY workflow_step_select ON public.workflow_step FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.workflow_run r WHERE r.id = public.workflow_step.run_id));
--> statement-breakpoint

-- ── Корпус законодательства ────────────────────────────────────────────────
--
-- Официальные документы общедоступны (пункт 5 статьи 1259 Гражданского
-- кодекса Российской Федерации исключает их из объектов авторского права),
-- поэтому чтение открыто всем аутентифицированным пользователям.
-- Запись выполняет только сервис ингеста сервисной ролью.

ALTER TABLE legal.bill                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.bill_event            ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.bill_document         ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.bill_initiator        ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.bill_committee        ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.document              ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.act                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.legal_work            ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.legal_expression      ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.legal_unit            ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.legal_edge            ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal.chunk                 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY bill_read           ON legal.bill             FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY bill_event_read     ON legal.bill_event       FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY bill_document_read  ON legal.bill_document    FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY bill_initiator_read ON legal.bill_initiator   FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY bill_committee_read ON legal.bill_committee   FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY document_read       ON legal.document         FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY act_read            ON legal.act              FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY legal_work_read     ON legal.legal_work       FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY legal_expr_read     ON legal.legal_expression FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY legal_unit_read     ON legal.legal_unit       FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY legal_edge_read     ON legal.legal_edge       FOR SELECT TO authenticated USING (true);--> statement-breakpoint

-- Чанки содержат в том числе рабочие черновики депутатов, поэтому здесь
-- проверяется видимость: публичные — всем, остальные — по правам на проект.
CREATE POLICY chunk_read ON legal.chunk FOR SELECT TO authenticated
USING (
  visibility = 'public'
  OR owner_user_id = public.current_user_id()
  OR (project_id IS NOT NULL AND public.can_read_project(project_id))
);
--> statement-breakpoint

-- ── Триггеры обновления updated_at ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER organization_touch BEFORE UPDATE ON public.organization
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER profile_touch BEFORE UPDATE ON public.profile
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER membership_touch BEFORE UPDATE ON public.membership
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER workgroup_touch BEFORE UPDATE ON public.workgroup
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER project_touch BEFORE UPDATE ON public.project
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER draft_touch BEFORE UPDATE ON public.draft
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER task_touch BEFORE UPDATE ON public.task
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
