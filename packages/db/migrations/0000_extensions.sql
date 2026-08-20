-- Расширения PostgreSQL, необходимые схеме.
-- Файл применяется первым (лексический порядок: «extensions» < «initial»).

-- Иерархические пути к структурным единицам актов.
CREATE EXTENSION IF NOT EXISTS ltree;
-- Нечёткий поиск по наименованиям законопроектов и депутатов.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Генерация UUID (в Postgres 13+ есть gen_random_uuid, расширение — для совместимости).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
