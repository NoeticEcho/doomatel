#!/usr/bin/env bash
# Поднимает локальный PostgreSQL для тестов политик RLS и печатает строку
# подключения. Используется в CI и при локальной разработке без Docker.
#
#   eval "$(scripts/test-db.sh)" && pnpm --filter @doomatel/db test
set -euo pipefail

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGDATA="${PGDATA:-/var/tmp/doomatel-pgdata}"
PGPORT="${PGPORT:-55432}"
PGDB="${PGDB:-doomatel_test}"

export PATH="$PG_BIN:$PATH"

if [ ! -d "$PGDATA/base" ]; then
  mkdir -p "$PGDATA"
  initdb -D "$PGDATA" -U postgres --encoding=UTF8 --locale=C.UTF-8 -A trust >/dev/null
fi

if ! pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA" -o "-p $PGPORT" -l "$PGDATA/server.log" start -w -t 30 >/dev/null
fi

psql -h 127.0.0.1 -p "$PGPORT" -U postgres -q <<SQL >/dev/null
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END \$\$;
SQL

if ! psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc "select 1 from pg_database where datname='$PGDB'" | grep -q 1; then
  createdb -h 127.0.0.1 -p "$PGPORT" -U postgres "$PGDB"
fi

# Схема auth имитирует Supabase Auth: приложение ссылается на auth.users.
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$PGDB" -q <<'SQL' >/dev/null
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
grant usage on schema auth to authenticated, service_role;
grant select on auth.users to authenticated;
SQL

echo "export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:$PGPORT/$PGDB"
