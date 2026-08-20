-- Права доступа к объектам схемы.
--
-- RLS ограничивает, какие *строки* видны, но не заменяет привилегий на
-- *таблицы*: без GRANT роль получает «permission denied» ещё до проверки
-- политик. Supabase выдаёт такие права по умолчанию для таблиц, созданных
-- через его миграции; при собственном развёртывании их нужно выдать явно.
--
-- Разделение ролей:
--   `authenticated` — обычный пользователь приложения, ограничен политиками;
--   `anon`          — неаутентифицированный, доступа к данным не имеет;
--   `service_role`  — бэкенд, обходит RLS (BYPASSRLS) и пишет всё.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'Роль authenticated отсутствует — выдача прав пропущена.';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public, legal TO authenticated';

  -- Прикладные таблицы: полный набор операций, ограниченный политиками RLS.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated';

  -- Журнал действий неизменяем со стороны клиента: только чтение.
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated';

  -- Корпус законодательства доступен только на чтение; пишет ингест.
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA legal TO authenticated';

  -- Таблицы, создаваемые последующими миграциями, наследуют те же права.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA legal GRANT SELECT ON TABLES TO authenticated';
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public, legal TO service_role';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA public, legal TO service_role';
    EXECUTE 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public, legal TO service_role';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public, legal GRANT ALL ON TABLES TO service_role';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public, legal GRANT ALL ON SEQUENCES TO service_role';
  END IF;
END $$;
--> statement-breakpoint

-- Роль anon не получает доступа к данным: регистрация и вход идут через
-- Supabase Auth, а не через прямые запросы к таблицам.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public, legal FROM anon';
  END IF;
END $$;
