-- Связь профиля с пользователем Supabase Auth.
--
-- Выполняется отдельно, потому что таблицей `auth.users` управляет Supabase,
-- а развёртывание без Supabase (собственный Postgres) должно оставаться
-- работоспособным — в этом случае внешний ключ просто не создаётся.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profile_id_auth_users_fk'
  ) THEN
    ALTER TABLE public.profile
      ADD CONSTRAINT profile_id_auth_users_fk
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
