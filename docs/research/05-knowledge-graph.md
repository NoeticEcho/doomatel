# 05 — Правовой граф знаний: TypeDB vs альтернативы, схема российского законодательства

> Исследование для проекта **Doomatel**. Дата: 2026-08-20.
> Легенда достоверности: **[V]** — VERIFIED (проверено в документации / npm / репозитории, есть ссылка); **[U]** — UNVERIFIED (вывод, оценка, экспертное суждение). Все версии пакетов проверены через `npm view` на 2026-08-20.

---

## 0. TL;DR — итог для архитектора

1. **TypeDB 3 существует, живой и активно развивается** (сервер 3.12.3, MPL-2.0). **[V]**
2. **НО: gRPC-драйвер для Node.js застрял на 2.x и НЕ портирован на 3.x.** Официальная документация TypeDB прямо перечисляет Node.js в «temporarily missing features». Единственный путь из TypeScript — **HTTP-драйвер `@typedb/driver-http@3.12.3`**. **[V]**
3. **Рекомендация: НЕ делать TypeDB системой записи (system of record).** Сделать **PostgreSQL (Supabase) единственным SoR** с явной реляционной моделью графа (`legal_edge` + closure table + рекурсивные CTE). Граф-движок — опциональный **производный read-model** за портом `LegalGraphPort`.
4. Модель документа в блочном редакторе — **делать Akoma-Ntoso-совместимой по структуре** (`eId`, иерархия `article/paragraph/point`, FRBR Work/Expression), но **не хранить XML как первичный формат**: хранить нормализованный JSON + детерминированный экспорт в AKN.
5. Российского обязательного стандарта машиночитаемых НПА **нет**. Есть «Концепция развития технологий машиночитаемого права» (2021, рамочный документ без схемы) и **Классификатор правовых актов** (Указ Президента РФ от 15.03.2000 № 511) — его надо использовать как рубрикатор. **[V]**
6. Готовой библиотеки разбора российских правовых ссылок нет ни в npm, ни в PyPI — **пишем свой парсер** (гибрид: регулярная грамматика + морфология). **[V — поиск не дал результатов]**

---

## 1. TypeDB 3.x — проверенные факты

### 1.1 Версии и релизы

| Компонент | Версия | Дата | Источник |
|---|---|---|---|
| TypeDB Server (CE) | **3.12.3** | 2026-08 | GitHub releases **[V]** |
| `@typedb/driver-http` (TS/JS, HTTP) | **3.12.3** | опубликован **2026-08-11** | `npm view @typedb/driver-http` **[V]** |
| `typedb-driver` (Node.js, gRPC, **2.x only**) | **2.29.7** | опубликован **2026-02-18** | `npm view typedb-driver` **[V]** |
| `typedb-driver-http` (**устаревшее имя**) | 3.5.5 | 2025-10-16 | переименован в `@typedb/driver-http` **[V]** |
| TypeDB 3.0.0 (первый релиз ветки 3) | 3.0.0 | 2024-12-20 | **[V]** |

Проверочные команды (воспроизводимо):

```bash
npm view typedb-driver version          # => 2.29.7
npm view typedb-driver dist-tags        # => { latest: '2.29.7' }   ← 3.x НЕТ
npm view @typedb/driver-http version    # => 3.12.3
npm view @typedb/driver-http versions   # => 3.7.0-rc0 … 3.12.3
```

Полный список версий `@typedb/driver-http`: `3.7.0-rc0, 3.7.0-rc1, 3.7.0-rc3, 3.7.0-rc4, 3.7.0, 3.8.0, 3.8.1, 3.8.2-rc0, 3.8.4-rc0, 3.10.0, 3.11.0-rc1, 3.11.1, 3.11.5, 3.12.0-rc0, 3.12.0, 3.12.1, 3.12.2, 3.12.3` **[V]**.
Первая публикация scope-пакета — **2025-08-01** (`0.0.1`), т.е. TS-драйверу для 3.x **~12 месяцев**. **[U — оценка зрелости]**

> ⚠️ **Ловушка именования.** В интернете и в старых гайдах фигурирует `typedb-driver` — это **драйвер для TypeDB 2.x**, он **не работает с сервером 3.x** (изменён и протокол, и модель транзакций). Пакет `typedb-driver-http` тоже устарел — переехал в scope `@typedb/driver-http`. **[V]**

### 1.2 Лицензирование

- **TypeDB Server (Community Edition): Mozilla Public License 2.0 (MPL-2.0)** — подтверждено файлом `LICENSE` в `github.com/typedb/typedb` (`Mozilla Public License Version 2.0`) и секцией README: *«It's released under the Mozilla Public License 2.0 (MPL 2.0)»*. **[V]**
- **TypeQL: MPL-2.0** (`github.com/typedb/typeql/LICENSE`). **[V]**
- **Драйверы: Apache-2.0** (`npm view @typedb/driver-http license` → `Apache-2.0`). **[V]**
- **TypeDB Enterprise / Cloud** — проприетарные, дают кластеризацию/HA/репликацию. В 3.x «Scaling support for Cloud/Enterprise editions under development». **[V]**
- Пользовательский менеджмент (users/roles) в 3.x **вынесен во все редакции**, ранее был Enterprise-only. **[V]**

**Практический вывод по лицензии:** MPL-2.0 — file-level copyleft, **не вирусный для нашего кода**. Для SaaS ограничений нет (в отличие от AGPL). Мы можем свободно self-host'ить CE. Юридически TypeDB CE **чище**, чем Neo4j CE (GPLv3). **[U — не юридическое заключение]**

### 1.3 Что изменилось 2.x → 3.x (важно, ломающе)

Источник: `https://typedb.com/docs/reference/typedb-2-vs-3/diff/` **[V]**

**TypeQL — синтаксис схемы:**

| 2.x | 3.x |
|---|---|
| `person sub entity;` | `entity person;` |
| `friendship sub relation;` | `relation friendship;` |
| `name sub attribute, value string;` | `attribute name, value string;` |
| `value long` | `value integer` |
| `?value-var` | `$value-var` + ключевое слово `let` |
| `define rule …` | **удалено** → `fun` (функции) |
| `owns x as y` / `plays r:a as b` | `as` **больше не применяется** к `owns`/`plays` (только к `relates`) |

**TypeQL — запросы:**
- `get` **удалён**; `match` сам отдаёт строки.
- `fetch` переработан: следует за любой стадией, отдающей строки, синтаксис `fetch { "key": $var, … }` → JSON-документы.
- Появились **pipelines**: последовательность стадий, каждая берёт поток строк и отдаёт поток строк.
- Стадии (из типов `PipelineStage` в TS-драйвере) **[V]**: `match`, `insert`, `delete`, `put`, `update`, `select`, `sort`, `require`, `offset`, `limit`, `distinct`, `reduce`.
- **`put`** — новая стадия: «вставить, если не существует» (upsert-семантика по паттерну). **[V — присутствует в типах драйвера]**
- **Функции** заменили правила (rules) и inference:

```typeql
fun <function-name> ( <optional-arguments> ) -> <return-types>:
<read_pipeline>
return <return-statement>
```

Функции **не могут писать** (нет `insert`/`delete` внутри), могут быть **рекурсивными**, вызываться вложенно, в отрицании, параллельно. Есть query-scoped вариант `with fun … : … ;` прямо в запросе. **[V]**

**Умолчания кардинальностей в 3.x** **[V]**:
- `plays` → `@card(0..)`
- `owns` → `@card(0..1)`
- `relates` → `@card(0..1)`

> 🔴 Это критично для нашей схемы: **по умолчанию `owns` — это 0..1**, а не 0..N как в 2.x. Любой multi-valued атрибут требует явного `@card(0..)`.

**API / модель транзакций:**
- **Sessions удалены.** Теперь только транзакции трёх типов: `"read" | "write" | "schema"`. **[V]**
- Единый интерфейс `transaction.query("…")` — нет `query().insert()` / `query().define()`. **[V]**
- `Thing` → `Instance`; удалены `concept.delete()`, `concept.getHas()`, `type.setLabel()` — всё через TypeQL. **[V]**

**Отсутствующие фичи в 3.x (по состоянию на docs):**
> «Node.js, C, C++, C# drivers not yet available» **[V]** — это прямая цитата из официальной страницы различий 2.x/3.x.

### 1.4 Node.js / TypeScript драйвер — точный API

Единственный поддерживаемый путь: **`@typedb/driver-http@3.12.3`** (ESM+CJS, свои `.d.ts`, **нулевые runtime-зависимости** — `dependencies: null`). **[V — распакован тарбол]**

`package.json` (проверено): `"main": "dist/index.cjs"`, `"module": "dist/index.mjs"`, `"types": "dist/index.d.ts"`, `"type": "module"`, `license: Apache-2.0`.

**Полная сигнатура класса** (из `dist/index.d.ts`, дословно) **[V]**:

```ts
declare class TypeDBHttpDriver {
    constructor(params: DriverParams);

    getDatabases(): Promise<ApiResponse<DatabasesListResponse>>;
    getDatabase(name: string): Promise<ApiResponse<Database>>;
    createDatabase(name: string): Promise<ApiResponse>;
    deleteDatabase(name: string): Promise<ApiResponse>;
    getDatabaseSchema(name: string): Promise<ApiResponse<string>>;
    getDatabaseTypeSchema(name: string): Promise<ApiResponse<string>>;

    getUsers(): Promise<ApiResponse<UsersListResponse>>;
    getCurrentUser(): Promise<ApiResponse<User>>;
    getUser(username: string): Promise<ApiResponse<User>>;
    createUser(username: string, password: string): Promise<ApiResponse>;
    updateUser(username: string, password: string): Promise<ApiResponse>;
    deleteUser(username: string): Promise<ApiResponse>;

    openTransaction(databaseName: string, transactionType: TransactionType,
                    transactionOptions?: TransactionOptions): Promise<ApiResponse<TransactionOpenResponse>>;
    commitTransaction(transactionId: string): Promise<ApiResponse>;
    closeTransaction(transactionId: string): Promise<ApiResponse>;
    rollbackTransaction(transactionId: string): Promise<ApiResponse>;

    analyze(transactionId: string, query: string,
            analyzeOptions?: AnalyzeOptions): Promise<ApiResponse<AnalyzeResponse>>;
    query(transactionId: string, query: string,
          queryOptions?: QueryOptions, givenRows?: GivenRows): Promise<ApiResponse<QueryResponse>>;
    oneShotQuery(query: string, commit: boolean, databaseName: string,
                 transactionType: TransactionType, transactionOptions?: TransactionOptions,
                 queryOptions?: QueryOptions, givenRows?: GivenRows): Promise<ApiResponse<QueryResponse>>;

    health(): Promise<ApiResponse>;
    version(): Promise<ApiResponse<VersionResponse>>;
    getServers(): Promise<ApiResponse<ServersListResponse>>;
}
```

Сопутствующие типы (дословно) **[V]**:

```ts
interface DriverParamsBasic { username: string; password: string; addresses: string[]; }
interface DriverParamsTranslated {
    username: string; password: string;
    translatedAddresses: { external: string; internal: string }[];
}
type DriverParams = DriverParamsBasic | DriverParamsTranslated;

type TransactionType = "read" | "write" | "schema";
interface TransactionOptions { schemaLockAcquireTimeoutMillis?: number; transactionTimeoutMillis?: number; }
interface QueryOptions { includeInstanceTypes?: boolean; includeQueryStructure?: boolean; answerCountLimit?: number; }

type ValueType = "boolean" | "integer" | "double" | "decimal" | "date"
               | "datetime" | "datetime-tz" | "duration" | "string" | "struct";

interface Entity    { kind: "entity";    iid: string; type: EntityType; }
interface Relation  { kind: "relation";  iid: string; type: RelationType; }
interface Attribute { kind: "attribute"; iid: string; value: any; valueType: ValueType; type: AttributeType; }
interface Value     { kind: "value";     value: any; valueType: ValueType; }
type Concept = Type | Entity | Relation | Attribute | Value;

interface ConceptRow { [varName: string]: Concept | undefined; }
interface ConceptRowAnswer { involvedBlocks: number[] | null; data: ConceptRow; }

interface ConceptRowsQueryResponse      extends QueryResponseBase { answerType: "conceptRows";      answers: ConceptRowAnswer[]; }
interface ConceptDocumentsQueryResponse extends QueryResponseBase { answerType: "conceptDocuments"; answers: ConceptDocument[]; }
interface OkQueryResponse               extends QueryResponseBase { answerType: "ok"; }

type ApiOkResponse<OK_RES = {}> = { ok: OK_RES };
declare function isOkResponse<T>(res: ApiResponse<T>): res is ApiOkResponse<T>;
declare function isApiErrorResponse(res: ApiResponse): res is ApiErrorResponse;
```

**Канонический пример использования** (из README пакета, дословно) **[V]**:

```ts
import { TypeDBHttpDriver, isApiErrorResponse } from "@typedb/driver-http";

const driver = new TypeDBHttpDriver({
    username: "admin",
    password: "password",
    addresses: [ "localhost:1729" ],
});

const transactionResponse = await driver.openTransaction("database-name", "read");
if (isApiErrorResponse(transactionResponse)) throw transactionResponse.err;
const transactionId = transactionResponse.ok.transactionId;

const answerResponse = await driver.query(transactionId, "match entity $x;");
if (isApiErrorResponse(answerResponse)) throw answerResponse.err;
const answer = answerResponse.ok;

if (answer.answerType === "conceptRows") {
   answer.answers.forEach((row) => { console.log(row.data) })
}
```

**Замечания по эргономике драйвера** **[U — оценка]**:
- Ошибки возвращаются как значения (`{ ok } | { err }`), **не бросаются** → нужен свой хелпер `unwrap()`, иначе каждый вызов обрастает `if (isApiErrorResponse(...))`.
- **Нет пула соединений, нет стриминга** результатов, нет `AsyncIterable`. Ответ приходит целиком (`answers: ConceptRowAnswer[]`) → большие выборки надо резать вручную через `answerCountLimit` + `offset`/`limit` в самом TypeQL.
- **Нет типобезопасности схемы**: `ConceptRow` — это `{ [varName: string]: Concept | undefined }`, `Attribute.value` — `any`. Никакой генерации типов из схемы (в отличие от Prisma/Drizzle/Kysely). Всё придётся оборачивать в Zod-парсеры.
- Транзакцию надо закрывать вручную (`closeTransaction`) — нет `using`/`Symbol.asyncDispose`. Легко течёт при исключениях.

### 1.5 Docker и self-host

**[V]** Образ: `typedb/typedb` на Docker Hub (для 3.x; в 2.x был `vaticle/typedb`).

```bash
docker volume create typedb-data
docker create --name typedb \
  -v typedb-data:/opt/typedb-all-linux-x86_64/server/data \
  -p 1729:1729 -p 8000:8000 \
  typedb/typedb:3.12.3
docker start typedb
```

- **1729** — родной (gRPC) порт; **8000** — HTTP API (его использует `@typedb/driver-http`). **[V]**
- Для arm64 путь тома: `/opt/typedb-server-linux-arm64/server/data`. **[V]**
- Дистрибутивы также в Cloudsmith. **[V]**

> ⚠️ Заметьте: в README драйвера `addresses: ["localhost:1729"]`, хотя HTTP-порт — 8000. Драйвер выводит origin из адреса (`remoteOrigin`, `hostPortFromOrigin`, `resolveOrigin`, `allOrigins` — экспортируются публично). **Проверить на практике, какой порт реально нужен HTTP-драйверу.** **[U — противоречие в документации]**

**Отсутствует** (значимо для прод-эксплуатации) **[U]**:
- Нет managed-хостинга в РФ (Yandex Cloud / VK Cloud / Selectel не предлагают TypeDB). Neo4j/Postgres — предлагают.
- HA/репликация — только Enterprise (проприетарно), в 3.x «under development».
- PITR/логическая репликация/`pg_dump`-эквивалент — экосистема бэкапов бедная по сравнению с Postgres.

---

## 2. Честная оценка: стоит ли брать TypeDB в прод в 2026?

### 2.1 Матрица сравнения

| Критерий | **TypeDB 3.12** | **Neo4j 2026.x** | **Apache AGE** (на PG) | **Чистый Postgres** (CTE + closure) | **RDF/SPARQL** (Oxigraph / GraphDB) |
|---|---|---|---|---|---|
| Версия (проверено) | 3.12.3 **[V]** | 2026.05.0 **[U]** | PG 11–18 **[V]** | PG 17/18 | `oxigraph@0.5.9` (npm) **[V]** |
| TS/JS драйвер | `@typedb/driver-http@3.12.3`, **HTTP-only**, ~12 мес **[V]** | `neo4j-driver@6.2.0`, bolt, зрелый **[V]** | через `pg@8.23.0` **[V]** | `pg@8.23.0` / `kysely@0.29.5` / `drizzle-orm@0.45.2` **[V]** | `oxigraph@0.5.9` (WASM/native), `sparqljs@3.7.4`, `n3@2.2.5` **[V]** |
| Лицензия ядра | **MPL-2.0** ✅ | **GPLv3** (CE) / коммерческая (EE) **[V]** | Apache-2.0 ✅ | PostgreSQL License ✅ | MIT/Apache (Oxigraph) ✅ / GraphDB — проприетарная |
| Кластер/HA в OSS | ❌ Enterprise | ❌ Enterprise | ✅ (наследует PG) | ✅ | Oxigraph — ❌ single-node |
| Managed в РФ | ❌ **[U]** | частично **[U]** | ✅ (любой PG) | ✅ Supabase/YDB-PG/любой | ❌ |
| Интеграция с Supabase RLS/auth | ❌ отдельный контур | ❌ | ✅ **в той же БД** | ✅ **в той же БД** | ❌ |
| Транзакции с основными данными | ❌ 2 источника истины | ❌ | ✅ одна транзакция | ✅ одна транзакция | ❌ |
| Рекурсивные обходы | ✅ `fun` рекурсивные | ✅ `*`/`apoc.path` | ✅ Cypher `*` | ✅ `WITH RECURSIVE` | ✅ property paths `+`/`*` |
| Выразительность онтологии (наследование типов, роли) | 🥇 **лучшая в классе** | 🥉 labels, нет наследования | 🥉 | 🥉 руками | 🥈 OWL/RDFS, reasoner |
| Экосистема / найм / SO-ответы | 🔴 крошечная | 🟢 огромная | 🟡 средняя | 🟢 огромная | 🟡 нишевая, но академически сильная |
| Стабильность API | 🔴 3.0→3.12 за ~20 мес, 2.x→3.x — полный слом **[V]** | 🟢 | 🟢 | 🟢 | 🟢 (W3C-стандарт с 2013) |
| Соответствие legal-стандартам (AKN/ELI/LegalRuleML) | ❌ свой формализм | ❌ | ❌ | ❌ | 🥇 **родной** — ELI/LegalRuleML сами RDF **[V]** |
| Vector search рядом | ❌ | 🟡 native vector index | ✅ pgvector | ✅ pgvector | ❌ |

### 2.2 Что у TypeDB объективно хорошо

**[U — экспертная оценка, но основано на [V]-фактах о синтаксисе]**

Правовая онтология — это именно тот случай, где TypeDB блистает:
- **Наследование типов сущностей и ролей.** `entity нпа; entity федеральный_закон, sub нпа; entity указ_президента, sub нпа;` — и запрос `match $a isa нпа;` автоматически ловит все подтипы. В Neo4j это делается многометками и руками; в Postgres — таблицей типов и `WHERE type IN (...)`.
- **N-арные отношения с именованными ролями.** «Поправка вносится депутатом X к статье Y законопроекта Z на заседании комитета W» — это натурально одно отношение с 4+ ролями. В property-графе это узел-реификация. В TypeDB — первоклассная конструкция `relation … relates … relates …`.
- **Специализация ролей** (`relates … as …`) — «субъект законодательной инициативы» специализируется в «депутат-инициатор», «Правительство РФ», «Президент РФ».
- **Рекурсивные функции** идеально ложатся на транзитивное замыкание «изменяет»/«ссылается на».

Это реальные преимущества, а не маркетинг.

### 2.3 Что делает TypeDB опасным выбором для этого продукта

**[U — оценка рисков]**

1. **🔴 Риск №1 — драйвер.** Официальная документация TypeDB на момент исследования **сама указывает Node.js-драйвер как отсутствующий** для 3.x **[V]**. Мы бы строили TS-продукт на HTTP-обёртке, которой год, без стриминга, без пула, без типобезопасности, без `AsyncDisposable`. Для системы, где юрист смотрит на экран и ждёт ответа — это неприемлемо тонкий слой.
2. **🔴 Риск №2 — два источника истины.** Supabase даёт Postgres + Auth + RLS + Realtime + Storage. Если граф живёт в TypeDB, то:
   - права доступа (кто из депутатов какой законопроект видит) придётся **дублировать** — в TypeDB нет RLS;
   - нет распределённой транзакции «сохранить законопроект И его рёбра» → нужен outbox/сага;
   - Realtime-подписки на изменения графа отсутствуют.
3. **🔴 Риск №3 — vendor concentration.** Один вендор (TypeDB Ltd), один продукт, малое комьюнити. Если вендор уйдёт/сменит лицензию — миграция с TypeQL некуда: **TypeQL несовместим ни с Cypher, ни с SPARQL, ни с GQL (ISO/IEC 39075)**. Мы бы попали в самый глубокий lock-in из всех вариантов. Neo4j-Cypher хотя бы конвертируется в openCypher/AGE; SPARQL — стандарт W3C.
4. **🟡 Риск №4 — темп ломающих изменений.** 3.0 (2024-12) → 3.12 (2026-08) **[V]**. За ~20 месяцев 12 минорных версий, причём драйвер и сервер версионируются в лок-степе (3.12.3 ↔ 3.12.3) — значит **апгрейд сервера требует апгрейда драйвера**, и наоборот. Для продукта госсектора, где обновления согласуются кварталами, это трение.
5. **🟡 Риск №5 — найм и эксплуатация в РФ.** Найти инженера с TypeQL — почти невозможно. Найти с SQL — тривиально. Аттестация/сертификация ПО для госзаказчика с экзотической СУБД в стеке — дополнительная головная боль. **[U]**
6. **🟢 Не-риск: объём данных.** RusLawOD — **304 382 акта, 194 425 905 токенов за 1991–2025** **[V]**. Даже с разбором до уровня пунктов это **порядка 10⁷ структурных единиц и 10⁷–10⁸ рёбер**. Postgres на нормальном железе это переваривает без разговоров. **Аргумента «нужен специализированный граф ради масштаба» здесь просто нет.**

### 2.4 Рекомендация

> ## ✅ РЕШЕНИЕ: PostgreSQL (Supabase) — единственная система записи. Граф моделируется реляционно (`legal_edge` + closure table + рекурсивные CTE). TypeDB / Neo4j / AGE — **опциональный** производный read-model за портом `LegalGraphPort`, включаемый флагом, если и когда упрёмся в производительность обходов.

**Обоснование в одну строку:** выразительность TypeDB реальна, но не окупает потерю RLS, транзакционной целостности с основными данными, зрелого драйвера и возможности мигрировать. **[U]**

**Если очень хочется граф-движок — брать не TypeDB, а Apache AGE** (расширение к тому же Postgres: одна транзакция, один бэкап, Apache-2.0, Cypher). Второй кандидат — Neo4j, если нужен зрелый драйвер и готовые алгоритмы. **RDF/Oxigraph — брать отдельно и целенаправленно**, если решим публиковать данные как Linked Data по ELI (см. §3.3).

### 2.5 Порт `LegalGraphPort` — абстракция, дружелюбная к миграции

Ключ: **не абстрагировать «запросы», абстрагировать «вопросы предметной области».** Попытка сделать generic-обёртку над Cypher/TypeQL/SQL всегда проваливается. Вместо этого фиксируем ~12 доменных операций.

```ts
// packages/legal-graph/src/port.ts
import { z } from "zod";                       // zod@4.4.3 [V]

export type NodeId = string & { readonly __brand: "NodeId" };

export type EdgeKind =
  | "изменяет"              // amends
  | "признаёт_утратившим_силу" // repeals
  | "ссылается_на"          // cites
  | "вводится_в_действие"   // brought-into-force-by
  | "толкует"               // interprets
  | "является_редакцией"    // is-version-of
  | "внесён"                // sponsored-by
  | "направлен_в_комитет"   // referred-to-committee
  | "содержит";             // structural containment

export interface TraversalOptions {
  readonly maxDepth: number;          // ВСЕГДА обязателен — защита от взрыва
  readonly asOf?: Date;               // темпоральный срез
  readonly kinds?: readonly EdgeKind[];
  readonly limit?: number;
}

export interface GraphPath {
  readonly nodes: readonly NodeId[];
  readonly edges: readonly { kind: EdgeKind; from: NodeId; to: NodeId }[];
}

export interface LegalGraphPort {
  /** §6.1 — что этот законопроект меняет */
  changeSetOfBill(billId: NodeId, opts?: { asOf?: Date }): Promise<ChangeSetItem[]>;

  /** §6.2 — кто зависит от этой структурной единицы (обратные ссылки) */
  dependentsOf(unitId: NodeId, opts: TraversalOptions): Promise<GraphPath[]>;

  /** §6.3 — полный радиус поражения законопроекта */
  blastRadius(billId: NodeId, opts: TraversalOptions): Promise<BlastRadiusReport>;

  /** Действующая редакция НПА на дату */
  expressionAsOf(workId: NodeId, at: Date): Promise<NodeId | null>;

  /** Цепочка редакций */
  versionChain(workId: NodeId): Promise<NodeId[]>;

  /** Конфликтующие законопроекты, трогающие те же единицы */
  conflictingBills(billId: NodeId): Promise<NodeId[]>;

  /** Прямые исходящие/входящие рёбра (для UI-графа) */
  neighbourhood(nodeId: NodeId, opts: TraversalOptions): Promise<GraphPath[]>;
}
```

Реализации: `PgLegalGraph` (по умолчанию, §4.3), `AgeLegalGraph`, `TypeDbLegalGraph` (§4.2), `Neo4jLegalGraph`. **Домен и агенты Mastra зависят только от `LegalGraphPort`.** **[U — архитектурное предложение]**

---

## 3. Стандарты машиночитаемых правовых документов

### 3.1 Akoma Ntoso / OASIS LegalDocML

**[V]** Akoma Ntoso Version 1.0 — OASIS Committee Specification, утверждена **06.06.2017**; вместе с ней Akoma Ntoso Naming Convention Version 1.0.
Namespace: `http://docs.oasis-open.org/legaldocml/ns/akn/3.0` **[V]**.

**Корневые элементы документов** **[V]**: `act`, `bill`, `amendment`, `debate`, `judgment`, `doc`, `documentCollection`, `portion`.

**Иерархические элементы** (полный список из спецификации) **[V]**:
`book, title, tome, part, chapter, section, paragraph, article, clause, division, level, list, subtitle, subpart, subchapter, subsection, subparagraph, subclause, sublist, point, indent, alinea`
плюс родовой `hcontainer` с обязательным атрибутом `name` — «запасной выход» для национальных структур, не покрытых словарём.

**Ссылки и модификации** **[V]**: `ref` (одиночная ссылка), `mref` (множественная), `rref` (диапазонная), `mod` (модификация/поправка), `quotedText`, `quotedStructure`.

**FRBR** **[V]**: четыре уровня IFLA — **Work** (абстрактный акт: «ФЗ № 149-ФЗ»), **Expression** (конкретная редакция на дату/язык), **Manifestation** (формат: XML/PDF), **Item** (конкретный файл). В XML — контейнеры `FRBRWork`, `FRBRExpression`, `FRBRManifestation` внутри `<meta><identification>`.

**Идентификаторы** **[V]**: `eId` — идентификатор элемента для внутренних ссылок; `wId` — идентификатор на уровне Work (устойчивый между редакциями). Это ключевой механизм: **`wId` позволяет сказать «статья 15 как таковая», а `eId` — «статья 15 в этой конкретной редакции»**.

### 3.2 LegalRuleML

**[V]** **LegalRuleML Core Specification Version 1.0** — **OASIS Standard, опубликован 30.08.2021** (анонс 08.09.2021, одобрение 28.09.2021). Редакторы: Monica Palmirani, Guido Governatori, Tara Athan, Harold Boley, Adrian Paschke, Adam Wyner.

Суть: XML-схема (XSD + Relax NG) поверх Consumer RuleML 1.02 + **RDFS-метамодель**. Моделирует **деонтические спецификации**: `Obligation`, `Permission`, `Prohibition`, `SuborderList` и их булевы комбинации. Разделяет **Legal Norm** (нормативное предписание) и **Legal Rule** (его формальное представление) — это важно: одна норма может иметь несколько формализаций, и они версионируются отдельно. **[V]**

**Оценка применимости к Doomatel [U]:** LegalRuleML — про **формализацию содержания нормы** (что обязательно/запрещено/разрешено, кому, при каких условиях). Это **вторая фаза** продукта, не MVP. Формализовать российское законодательство в деонтическую логику — исследовательская задача на годы. **Рекомендация: НЕ включать в MVP**, но заложить в схему граф-узел `правовое_понятие` и оставить место для будущей привязки норм.

### 3.3 ELI — European Legislation Identifier

**[V]** ELI расширяет словарь RDA/FRBR: `eli:LegalResource` (= Work), `eli:LegalExpression` (= Expression), `eli:Format` (= Manifestation). Онтология — RDF/OWL, публикуется Publications Office of the EU (`data.europa.eu/eli/ontology`).

**Шаблон URI** (RFC 6570 URI Templates) **[V]**:

```
/eli/{jurisdiction}/{agent}/{sub-agent}/{year}/{month}/{day}/{type}/{natural identifier}/{level 1…}/{point in time}/{version}/{language}
```
Все компоненты **опциональны** и порядок **не предопределён** — каждая юрисдикция выбирает свой профиль. Пример (Испания): `https://www.boe.es/eli/es/lo/2013/12/20/9`.

**Почему это для нас важно [U]:** ELI даёт **готовый рецепт устойчивых идентификаторов НПА**, отделяющих «акт» от «редакции». Даже не публикуя RDF, мы должны заимствовать URI-схему — это решает главную боль российского права (см. §3.4).

### 3.4 Есть ли российский стандарт?

**Короткий ответ: обязательного машиночитаемого стандарта НПА в РФ нет. [V/U]**

Что есть:

1. **«Концепция развития технологий машиночитаемого права»** — утверждена **Правительственной комиссией по цифровому развитию** в **сентябре 2021 г.**, разработана Минэкономразвития России. **[V]**
   Первый официальный документ РФ в этой сфере. Определяет машиночитаемое право как *«нормы права, которые изложены на формальном языке — на языках программирования и разметки текста, применимых для ЭВМ»*. Области применения: стандартизация и сертификация; сделки в машиночитаемом формате; контрольно-надзорная деятельность; отчётность и обмен данными; административное производство и судопроизводство; **нормотворчество и управление изменениями**; взаимодействие ГИС с цифровыми платформами. **[V]**
   ⚠️ Это **рамочный, целеполагающий документ. Конкретной XML/RDF-схемы он не задаёт.** **[U]**

2. **Классификатор правовых актов** — одобрен **Указом Президента РФ от 15.03.2000 № 511 «О классификаторе правовых актов»** (ред. от 28.06.2005). **[V]**
   Рекомендован органам госвласти «для использования при формировании банков данных правовой информации и при автоматизированном обмене правовой информацией». Пятиуровневый код вида `XXX.XXX.XXX.XXX.XXX`. Примеры: `010.010.000` — Конституция Российской Федерации; `210.000.000` — Индивидуальные правовые акты по кадровым вопросам, вопросам награждения, помилования, гражданства. **[V]**
   👉 **Это наш рубрикатор. Используем как есть — это единственный официальный контролируемый словарь тематики.** В RusLawOD он присутствует как `classifierByIPS`. **[V]**

3. **RusLawOD (irlcode/RusLawOD)** — «Russian Law as Open Data», v3. **[V]**
   - **304 382 акта, 194 425 905 токенов, 1991–2025**, обновлено из источника в конце января 2026.
   - Источник: ИПС «Законодательство России» (часть портала pravo.gov.ru), **не является официальной публикацией**.
   - Явно опирается на Akoma Ntoso, **но признаёт неполноту**: *«so far our corpus is not entirely compatible with it: we do not mark-up the internal document structure yet»*.
   - Формат — собственный XML `<act><meta>…<body>` с полями `pravogovruNd`, `issuedByIPS`, `docdateIPS`, `docNumberIPS`, `headingIPS`, `doc_typeIPS`, `doc_author_normal_formIPS`, `signedIPS`, `statusIPS`, `actual_datetimeIPS`, `is_widely_used`, `classifierByIPS`, `keywordByIPS`, `<body><textIPS>` (с инлайн `<ref>`), `<taggedTextIPS>` (CoNLL-U).
   - Лицензия: тексты актов не охраняются авторским правом; материалы проекта — CC BY-NC 4.0. HF: `irlspbru/RusLawOD`; arXiv: **2406.04855**.
   - 🔴 **Критическое ограничение: «Only first versions of acts (as were initially signed) are taken. The corpus does not include consolidated (with further amendments) texts.»** **[V]** — то есть **действующих редакций там нет**. Для Doomatel это значит: RusLawOD годится как исторический корпус и как обучающий набор для парсеров, **но не как источник актуального права**.

4. **Ключевая проблема идентификации** — цитата из RusLawOD **[V]**:
   > *«There is no uniform identification number of a legal act in Russia, the identification might be by three attributes combined: the official document number, the date of signature and the state organ that adopted the document. Pravo.gov.ru ND is an internal database ID, it is not official and may change.»*

   👉 Отсюда прямое проектное следствие: **мы обязаны построить свой канонический идентификатор** и не полагаться на `pravogovruNd`.

### 3.5 Предлагаемая адаптация: RU-ELI + AKN-профиль для российских актов

**[U — авторское проектное предложение]**

#### 3.5.1 Канонический идентификатор Work (по мотивам ELI)

```
akn://ru/act/{тип}/{ГГГГ-ММ-ДД}/{номер}
```
Примеры:
```
akn://ru/act/fz/2006-07-27/149-ФЗ          # Федеральный закон 149-ФЗ
akn://ru/act/fkz/1997-12-17/2-ФКЗ          # Федеральный конституционный закон
akn://ru/act/ukaz/2000-03-15/511           # Указ Президента РФ
akn://ru/act/postanovlenie-prav/2021-06-30/1119
akn://ru/act/kodeks/1994-11-30/51-ФЗ       # ГК РФ (часть первая)
```
Уровень Expression (редакция) — добавляем точку во времени:
```
akn://ru/act/fz/2006-07-27/149-ФЗ/ru@2025-01-01     # редакция, действующая с 01.01.2025
```
Уровень структурной единицы (`eId`, синтаксис AKN Naming Convention):
```
akn://ru/act/fz/2006-07-27/149-ФЗ/ru@2025-01-01#art_15__part_3__point_2
```
Устойчивый `wId` структурной единицы (**переживает редакции**):
```
akn://ru/act/fz/2006-07-27/149-ФЗ#art_15__part_3__point_2
```

Словарь `{тип}` (контролируемый): `fkz | fz | zakon-rf | ukaz | rasporyazhenie-prez | postanovlenie-prav | rasporyazhenie-prav | prikaz | postanovlenie-gd | postanovlenie-sf | kodeks`.

#### 3.5.2 Отображение российских структурных единиц на элементы AKN

| Русская единица | Элемент AKN | `eId`-префикс (AKN NC) | Комментарий |
|---|---|---|---|
| раздел | `part` | `part_` | |
| подраздел | `subpart` | `subpart_` | |
| глава | `chapter` | `chp_` | |
| параграф (§) | `paragraph` ⚠️ | `para_` | ⚠️ ложный друг, см. ниже |
| **статья** | **`article`** | `art_` | ядро |
| **часть** (статьи) | **`paragraph`** | `part_` | 🔴 см. предупреждение |
| **пункт** | **`point`** | `point_` | |
| **подпункт** | **`subpoint`**† / `point` вложенный | `subpoint_` | †нет в словаре AKN → `hcontainer name="subpoint"` |
| абзац | `alinea` | `al_` | |
| примечание | `blockContainer` / `note` | `note_` | |
| приложение | `attachment` / `component` | `att_` | |

> 🔴 **Главная ловушка перевода.** Русская «часть статьи» — это **НЕ** `part` в AKN (`part` = раздел книги, уровень выше главы), а **`paragraph`**. Одновременно русский «параграф (§)» — это тоже AKN `paragraph`. Прямое отображение теряет информацию.
> **Решение:** использовать `hcontainer` с явным русским именем для неоднозначных уровней и хранить русское имя как первичное:
> ```xml
> <article eId="art_15">
>   <num>15</num>
>   <hcontainer name="chast" eId="art_15__part_3">
>     <num>3</num>
>     <point eId="art_15__part_3__point_2"><num>2</num><content><p>…</p></content></point>
>   </hcontainer>
> </article>
> ```
> **[U — проектное решение; AKN явно допускает `hcontainer` для непокрытых национальных структур [V]]**

#### 3.5.3 Должна ли модель блочного редактора быть AKN-совместимой?

**Ответ: совместимой по структуре — да. Хранить AKN XML как первичный формат — нет.** **[U]**

**Почему не хранить XML первично:**
- Блочный редактор (ProseMirror/Lexical/Tiptap) работает с JSON-деревом и работает с ним быстро; XML требует сериализации туда-обратно на каждое нажатие.
- CRDT / operational transform для совместного редактирования поверх XML — боль; поверх JSON-документа с блоками — решённая задача (Yjs).
- AKN 1.0 огромен, и 95% его словаря нам не нужен; строгая валидация XSD в реальном времени убьёт UX.
- Диффы и поправки нам нужны **на уровне блоков**, а не XML-узлов.

**Почему структура обязана быть совместимой:**
- Каждый блок обязан иметь **стабильный `eId` в синтаксисе AKN Naming Convention** и **`wId`**, устойчивый между редакциями. Это единственный способ, чтобы поправка «изложить часть 3 статьи 15 в новой редакции» надёжно указывала на цель.
- Экспорт в AKN должен быть **детерминированным и без потерь** (round-trip тест в CI).
- Это страхует нас, если/когда в РФ появится обязательный формат — конвертер будет чисто механическим.

**Предлагаемая модель документа [U]:**

```ts
// packages/legal-doc/src/model.ts
export type UnitKind =
  | "razdel" | "podrazdel" | "glava" | "paragraf"
  | "statya" | "chast" | "punkt" | "podpunkt" | "abzac"
  | "primechanie" | "prilozhenie";

export interface LegalBlock {
  /** локально-уникальный, стабильный, генерируется один раз и НИКОГДА не меняется */
  readonly id: string;                  // nanoid@6.0.1
  readonly kind: UnitKind;
  /** «15», «3», «2», «а» — как в тексте; может меняться при перенумерации */
  readonly num: string | null;
  /** заголовок (у статей и глав) */
  readonly heading: string | null;
  /** eId в AKN NC, ВЫЧИСЛЯЕМЫЙ из пути num'ов — денормализация, пересчитывается */
  readonly eId: string;                 // "art_15__part_3__point_2"
  /** wId — стабильный идентификатор Work-уровня; переживает перенумерацию */
  readonly wId: string;
  /** содержимое как ProseMirror-совместимый inline-массив */
  readonly content: InlineNode[];
  readonly children: LegalBlock[];
  /** статус в текущей редакции */
  readonly status: "active" | "repealed" | "not_yet_in_force" | "draft";
  readonly inForceFrom: string | null;  // ISO date
  readonly inForceTo: string | null;
}

export type InlineNode =
  | { t: "text"; s: string }
  | { t: "ref"; s: string; href: string; parsed: ParsedReference }  // → AKN <ref>
  | { t: "mod"; s: string; children: InlineNode[] }                  // → AKN <mod>
  | { t: "quotedText"; s: string }
  | { t: "quotedStructure"; blocks: LegalBlock[] };
```

`ref`/`mod`/`quotedText`/`quotedStructure` названы **точно как элементы AKN** — это делает экспортёр тривиальным.

---

## 4. Схема графа

### 4.1 Концептуальная модель

**Сущности (entities):**

| Узел | Описание | FRBR-уровень |
|---|---|---|
| `нпа` | Нормативный правовой акт как абстракция | **Work** |
| `редакция` | Редакция НПА, действующая в интервале дат | **Expression** |
| `структурная_единица` | статья / часть / пункт / подпункт / абзац / глава / раздел | Work + Expression |
| `законопроект` | Законопроект в СОЗД | Work |
| `поправка` | Поправка ко второму чтению | Work |
| `субъект_законодательной_инициативы` | абстракция инициатора | — |
| `депутат` | ↳ подтип | — |
| `фракция` | Фракция ГД | — |
| `комитет` | Комитет ГД / СФ | — |
| `орган` | Президент, Правительство, ВС РФ, законодательный орган субъекта РФ | — |
| `заседание` | Пленарное заседание / заседание комитета | — |
| `голосование` | Результат голосования | — |
| `рубрика` | Узел Классификатора правовых актов (№ 511) | — |
| `правовое_понятие` | Легально определённый термин | — |
| `созыв` | Созыв Государственной Думы | — |

**Отношения (relations):**

| Отношение | Роли | Смысл |
|---|---|---|
| `изменяет` | `изменяющая` (структурная единица), `изменяемая` (структурная единица) | + `вид_изменения` |
| `признаёт_утратившим_силу` | `отменяющая`, `отменяемая` | подтип `изменяет` |
| `ссылается_на` | `источник`, `цель` | перекрёстная ссылка |
| `вводится_в_действие` | `вводимое`, `вводящее` | вводный закон / отдельная статья |
| `толкует` | `толкующая`, `толкуемая` | разъяснения, постановления КС/ВС |
| `является_редакцией` | `редакция`, `акт` | Expression → Work |
| `содержит` | `контейнер`, `элемент` | структурная вложенность |
| `внесён` | `законопроект`, `инициатор` | sponsored-by |
| `направлен_в_комитет` | `законопроект`, `комитет`, `роль_комитета` | ответственный / соисполнитель |
| `рассмотрен` | `законопроект`, `заседание`, `чтение` | |
| `проголосовано` | `голосование`, `предмет`, `заседание` | |
| `подал_поправку` | `поправка`, `автор`, `законопроект`, `цель` | 4-арное |
| `состоит_во_фракции` | `депутат`, `фракция`, `созыв` | темпоральное |
| `классифицирован` | `акт`, `рубрика` | № 511 |
| `определяет_понятие` | `единица`, `понятие` | легальная дефиниция |
| `становится_законом` | `законопроект`, `нпа` | связь СОЗД → НПА |

### 4.2 TypeQL 3.x схема

> Синтаксис проверен по документации TypeDB 3.x **[V]**. Обратите внимание на **обязательный `@card(0..)` для multi-valued атрибутов** — умолчание `owns` в 3.x равно `@card(0..1)` **[V]**.

```typeql
define

# ─────────────────────────── АТРИБУТЫ ───────────────────────────
attribute uri,              value string;      # akn://ru/act/fz/2006-07-27/149-ФЗ
attribute eid,              value string;      # art_15__part_3__point_2
attribute wid,              value string;      # стабильный Work-id единицы
attribute наименование,     value string;
attribute номер,            value string;      # "149-ФЗ", "15", "3", "а"
attribute дата_подписания,  value date;
attribute дата_опубликования, value date;
attribute действует_с,      value date;
attribute действует_по,     value date;
attribute текст,            value string;
attribute вид_единицы,      value string
    @values("razdel","podrazdel","glava","paragraf","statya",
            "chast","punkt","podpunkt","abzac","primechanie","prilozhenie");
attribute вид_акта,         value string
    @values("fkz","fz","zakon-rf","ukaz","rasporyazhenie-prez",
            "postanovlenie-prav","rasporyazhenie-prav","prikaz",
            "postanovlenie-gd","postanovlenie-sf","kodeks");
attribute статус,           value string
    @values("действует","утратил силу","не вступил в силу","приостановлен");
attribute вид_изменения,    value string
    @values("дополнить","изложить в новой редакции","признать утратившим силу",
            "исключить","заменить слова","дополнить словами","приостановить");
attribute код_рубрики,      value string @regex("^\\d{3}(\\.\\d{3}){4}$");   # № 511
attribute номер_сокращённый, value string;                                   # "ГК РФ", "АПК"
attribute номер_законопроекта, value string @regex("^\\d{6}-\\d+$");         # СОЗД: 123456-8
attribute чтение,           value integer @range(1..3);
attribute результат_голосования, value string @values("принято","отклонено","не набрало голосов");
attribute за,               value integer;
attribute против,           value integer;
attribute воздержалось,     value integer;
attribute фио,              value string;
attribute номер_созыва,     value integer;
attribute роль_в_комитете,  value string @values("ответственный","соисполнитель","профильный");
attribute дата,             value date;
attribute порядковый_номер, value integer;

# ─────────────────────────── СУЩНОСТИ ───────────────────────────

# --- Work-уровень: акт как абстракция ---
entity нпа,
    owns uri @key,
    owns вид_акта @card(1),
    owns наименование @card(1),
    owns номер @card(1),
    owns номер_сокращённый @card(0..),
    owns дата_подписания @card(1),
    owns дата_опубликования,
    owns статус @card(1),
    plays является_редакцией:акт,
    plays классифицирован:акт,
    plays становится_законом:результат,
    plays вводится_в_действие:вводимое,
    plays вводится_в_действие:вводящее;

entity федеральный_закон,               sub нпа;
entity федеральный_конституционный_закон, sub нпа;
entity кодекс,                          sub федеральный_закон;
entity указ_президента,                 sub нпа;
entity постановление_правительства,     sub нпа;
entity ведомственный_акт,               sub нпа;

# --- Expression-уровень: редакция ---
entity редакция,
    owns uri @key,
    owns действует_с @card(1),
    owns действует_по,
    plays является_редакцией:редакция,
    plays содержит:контейнер;

# --- Структурная единица ---
entity структурная_единица,
    owns uri @key,
    owns eid @card(1),
    owns wid @card(1),
    owns вид_единицы @card(1),
    owns номер,
    owns наименование,
    owns текст,
    owns статус @card(1),
    owns действует_с,
    owns действует_по,
    owns порядковый_номер,
    plays содержит:контейнер,
    plays содержит:элемент,
    plays изменяет:изменяющая,
    plays изменяет:изменяемая,
    plays ссылается_на:источник,
    plays ссылается_на:цель,
    plays толкует:толкующая,
    plays толкует:толкуемая,
    plays определяет_понятие:единица,
    plays подал_поправку:цель;

# --- Законотворчество ---
entity законопроект,
    owns uri @key,
    owns номер_законопроекта @key,
    owns наименование @card(1),
    owns дата @card(1),
    owns статус @card(1),
    plays внесён:законопроект,
    plays направлен_в_комитет:законопроект,
    plays рассмотрен:законопроект,
    plays подал_поправку:законопроект,
    plays становится_законом:проект,
    plays содержит:контейнер;

entity поправка,
    owns uri @key,
    owns номер,
    owns текст,
    owns вид_изменения,
    plays подал_поправку:поправка,
    plays проголосовано:предмет;

# --- Акторы ---
entity субъект_законодательной_инициативы,
    owns наименование @card(1),
    plays внесён:инициатор;

entity депутат, sub субъект_законодательной_инициативы,
    owns uri @key,
    owns фио @card(1),
    plays состоит_во_фракции:депутат,
    plays подал_поправку:автор,
    plays член_комитета:депутат;

entity орган, sub субъект_законодательной_инициативы,
    owns uri @key;

entity фракция,
    owns uri @key,
    owns наименование @card(1),
    plays состоит_во_фракции:фракция;

entity комитет,
    owns uri @key,
    owns наименование @card(1),
    plays направлен_в_комитет:комитет,
    plays член_комитета:комитет;

entity созыв,
    owns номер_созыва @key,
    owns действует_с,
    owns действует_по,
    plays состоит_во_фракции:созыв;

entity заседание,
    owns uri @key,
    owns дата @card(1),
    plays рассмотрен:заседание,
    plays проголосовано:заседание;

entity голосование,
    owns uri @key,
    owns результат_голосования @card(1),
    owns за, owns против, owns воздержалось,
    plays проголосовано:голосование;

entity рубрика,
    owns код_рубрики @key,
    owns наименование @card(1),
    plays классифицирован:рубрика,
    plays содержит:контейнер,
    plays содержит:элемент;

entity правовое_понятие,
    owns uri @key,
    owns наименование @card(1),
    plays определяет_понятие:понятие;

# ─────────────────────────── ОТНОШЕНИЯ ───────────────────────────

relation содержит,
    relates контейнер @card(1),
    relates элемент   @card(1),
    owns порядковый_номер;

relation является_редакцией,
    relates редакция @card(1),
    relates акт      @card(1);

relation изменяет,
    relates изменяющая @card(1),
    relates изменяемая @card(1),
    owns вид_изменения @card(1),
    owns действует_с,
    owns текст;                       # новая редакция / добавляемый текст

relation признаёт_утратившим_силу, sub изменяет,
    relates отменяющая as изменяющая,
    relates отменяемая as изменяемая;

relation ссылается_на,
    relates источник @card(1),
    relates цель     @card(1),
    owns текст;                       # исходная подстрока ссылки

relation вводится_в_действие,
    relates вводимое @card(1),
    relates вводящее @card(1),
    owns действует_с;

relation толкует,
    relates толкующая @card(1),
    relates толкуемая @card(1);

relation внесён,
    relates законопроект @card(1),
    relates инициатор    @card(1..),
    owns дата;

relation направлен_в_комитет,
    relates законопроект @card(1),
    relates комитет      @card(1),
    owns роль_в_комитете @card(1),
    owns дата;

relation рассмотрен,
    relates законопроект @card(1),
    relates заседание    @card(1),
    owns чтение,
    owns дата;

relation проголосовано,
    relates голосование @card(1),
    relates предмет     @card(1),
    relates заседание   @card(0..1);

relation подал_поправку,
    relates поправка     @card(1),
    relates автор        @card(1..),
    relates законопроект @card(1),
    relates цель         @card(0..);   # структурные единицы, которые правит

relation состоит_во_фракции,
    relates депутат @card(1),
    relates фракция @card(1),
    relates созыв   @card(1),
    owns действует_с, owns действует_по;

relation член_комитета,
    relates депутат @card(1),
    relates комитет @card(1),
    owns роль_в_комитете;

relation классифицирован,
    relates акт     @card(1),
    relates рубрика @card(1);

relation определяет_понятие,
    relates единица @card(1),
    relates понятие @card(1);

relation становится_законом,
    relates проект    @card(1),
    relates результат @card(1);

# ─────────────────────────── ФУНКЦИИ ───────────────────────────
# Рекурсивное транзитивное замыкание структурного вложения
fun все_подчинённые($u: структурная_единица) -> { структурная_единица }:
  match
    {
      содержит (контейнер: $u, элемент: $child);
    } or {
      содержит (контейнер: $u, элемент: $mid);
      let $child in все_подчинённые($mid);
    };
  return { $child };

# Всё, что (транзитивно) ссылается на данную единицу
fun зависимые($u: структурная_единица) -> { структурная_единица }:
  match
    {
      ссылается_на (источник: $dep, цель: $u);
    } or {
      ссылается_на (источник: $mid, цель: $u);
      let $dep in зависимые($mid);
    };
  return { $dep };

# Число входящих ссылок — метрика «центральности» нормы
fun число_ссылок($u: структурная_единица) -> integer:
  match ссылается_на (источник: $s, цель: $u);
  return count;
```

**Пример запроса на TypeQL 3.x** — «что меняет законопроект 123456-8 и насколько это центральные нормы»:

```typeql
match
  $bill isa законопроект, has номер_законопроекта "123456-8";
  подал_поправку (законопроект: $bill, цель: $target);
  $target isa структурная_единица, has eid $eid, has вид_единицы $kind;
  $act isa нпа, has наименование $act_name;
  содержит (контейнер: $rev, элемент: $target);
  является_редакцией (редакция: $rev, акт: $act);
let $refs = число_ссылок($target);
sort $refs desc;
limit 50;
fetch {
  "акт": $act_name,
  "единица": $eid,
  "вид": $kind,
  "входящих_ссылок": $refs
};
```

### 4.3 Эквивалентная схема PostgreSQL (**рекомендуемая к реализации**)

Стратегия: **одна таблица узлов на «род» + универсальная таблица рёбер `legal_edge` + closure-таблица для структурного вложения.** Это даёт и производительность, и простые рекурсивные CTE.

```sql
-- ═══════════════════════ РАСШИРЕНИЯ ═══════════════════════
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "ltree";      -- пути структурных единиц
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- нечёткий поиск по наименованиям
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- EXCLUDE по диапазонам дат

CREATE SCHEMA IF NOT EXISTS legal;
SET search_path = legal, public;

-- ═══════════════════════ СПРАВОЧНИКИ ═══════════════════════
CREATE TYPE вид_акта_t AS ENUM (
  'fkz','fz','zakon-rf','ukaz','rasporyazhenie-prez',
  'postanovlenie-prav','rasporyazhenie-prav','prikaz',
  'postanovlenie-gd','postanovlenie-sf','kodeks');

CREATE TYPE вид_единицы_t AS ENUM (
  'razdel','podrazdel','glava','paragraf','statya',
  'chast','punkt','podpunkt','abzac','primechanie','prilozhenie');

CREATE TYPE статус_t AS ENUM (
  'действует','утратил силу','не вступил в силу','приостановлен','проект');

CREATE TYPE вид_изменения_t AS ENUM (
  'дополнить','изложить в новой редакции','признать утратившим силу',
  'исключить','заменить слова','дополнить словами','приостановить');

CREATE TYPE вид_ребра_t AS ENUM (
  'изменяет','признаёт_утратившим_силу','ссылается_на','вводится_в_действие',
  'толкует','является_редакцией','содержит','внесён','направлен_в_комитет',
  'рассмотрен','проголосовано','подал_поправку','состоит_во_фракции',
  'классифицирован','определяет_понятие','становится_законом','член_комитета');

-- ═══════════════════════ WORK: НПА ═══════════════════════
CREATE TABLE act (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uri             text NOT NULL UNIQUE,          -- akn://ru/act/fz/2006-07-27/149-ФЗ
  вид             вид_акта_t NOT NULL,
  наименование    text NOT NULL,
  номер           text NOT NULL,                 -- '149-ФЗ'
  сокращения      text[] NOT NULL DEFAULT '{}',  -- {'ГК РФ','ГК'}
  дата_подписания date NOT NULL,
  дата_опубликования date,
  статус          статус_t NOT NULL DEFAULT 'действует',
  -- внешние идентификаторы (нестабильные!)
  pravo_gov_nd    text,
  sozd_number     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT act_natural_key UNIQUE (вид, дата_подписания, номер)
);
CREATE INDEX act_name_trgm  ON act USING gin (наименование gin_trgm_ops);
CREATE INDEX act_abbrev_gin ON act USING gin (сокращения);
CREATE INDEX act_date       ON act (дата_подписания DESC);

-- ═══════════════════════ EXPRESSION: редакция ═══════════════
CREATE TABLE expression (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  act_id       uuid NOT NULL REFERENCES act(id) ON DELETE CASCADE,
  uri          text NOT NULL UNIQUE,
  -- полуинтервал [действует_с, действует_по) ; NULL сверху = бессрочно
  период       daterange NOT NULL,
  -- какой акт породил эту редакцию
  введена_актом uuid REFERENCES act(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- гарантия непересечения редакций одного акта
  CONSTRAINT expr_no_overlap EXCLUDE USING gist (act_id WITH =, период WITH &&)
);
CREATE INDEX expr_act_period ON expression USING gist (период);

-- ═══════════════ СТРУКТУРНАЯ ЕДИНИЦА ════════════════════════
CREATE TABLE unit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expression_id uuid NOT NULL REFERENCES expression(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES unit(id) ON DELETE CASCADE,
  -- AKN eId — уникален внутри редакции
  eid           text NOT NULL,             -- 'art_15__part_3__point_2'
  -- стабильный Work-id, переживает редакции и перенумерацию
  wid           text NOT NULL,
  вид           вид_единицы_t NOT NULL,
  номер         text,                      -- '15','3','а'
  наименование  text,
  текст         text,
  -- материализованный путь для быстрых поддеревьев
  path          ltree NOT NULL,
  порядковый_номер int NOT NULL DEFAULT 0,
  статус        статус_t NOT NULL DEFAULT 'действует',
  период        daterange,
  -- денормализация для быстрых джойнов (избавляет от 2 хопов)
  act_id        uuid NOT NULL REFERENCES act(id) ON DELETE CASCADE,
  UNIQUE (expression_id, eid)
);
CREATE INDEX unit_path_gist  ON unit USING gist (path);
CREATE INDEX unit_parent     ON unit (parent_id);
CREATE INDEX unit_wid        ON unit (wid);
CREATE INDEX unit_act        ON unit (act_id, вид);
CREATE INDEX unit_expr       ON unit (expression_id);
CREATE INDEX unit_text_fts   ON unit USING gin (to_tsvector('russian', coalesce(текст,'')));

-- ═══════════ УНИВЕРСАЛЬНАЯ ТАБЛИЦА РЁБЕР ══════════════════
-- Полиморфные концы: (kind, id). Проверка целостности — триггером.
CREATE TABLE legal_edge (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  вид           вид_ребра_t NOT NULL,
  src_kind      text NOT NULL,   -- 'unit' | 'act' | 'bill' | 'amendment' | 'deputy' | …
  src_id        uuid NOT NULL,
  dst_kind      text NOT NULL,
  dst_id        uuid NOT NULL,
  -- свойства ребра
  вид_изменения вид_изменения_t,
  цитата        text,            -- исходная подстрока ссылки
  период        daterange,       -- когда ребро действительно
  уверенность   real NOT NULL DEFAULT 1.0 CHECK (уверенность BETWEEN 0 AND 1),
  источник      text NOT NULL DEFAULT 'parser',  -- 'parser'|'manual'|'llm'
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (вид, src_kind, src_id, dst_kind, dst_id)
);
CREATE INDEX edge_out    ON legal_edge (src_kind, src_id, вид);
CREATE INDEX edge_in     ON legal_edge (dst_kind, dst_id, вид);
CREATE INDEX edge_kind   ON legal_edge (вид);
CREATE INDEX edge_period ON legal_edge USING gist (период);
CREATE INDEX edge_payload ON legal_edge USING gin (payload jsonb_path_ops);

-- ═══════════ CLOSURE TABLE для структурного вложения ══════
-- Материализуется триггером на unit; даёт O(1) «все потомки/предки».
CREATE TABLE unit_closure (
  ancestor_id   uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  descendant_id uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  depth         int  NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX closure_desc ON unit_closure (descendant_id, depth);

-- ═══════════ ЗАКОНОТВОРЧЕСТВО ══════════════════════════════
CREATE TABLE bill (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uri            text NOT NULL UNIQUE,
  sozd_number    text NOT NULL UNIQUE,        -- '123456-8'
  наименование   text NOT NULL,
  дата_внесения  date NOT NULL,
  стадия         text NOT NULL,
  созыв          int  NOT NULL,
  результат_act_id uuid REFERENCES act(id)    -- если стал законом
);
CREATE INDEX bill_name_trgm ON bill USING gin (наименование gin_trgm_ops);

CREATE TABLE amendment (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id    uuid NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
  номер      text,
  текст      text,
  вид        вид_изменения_t,
  чтение     int CHECK (чтение BETWEEN 1 AND 3),
  результат  text
);

CREATE TABLE deputy (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uri     text NOT NULL UNIQUE,
  фио     text NOT NULL,
  sozd_id text
);
CREATE INDEX deputy_fio_trgm ON deputy USING gin (фио gin_trgm_ops);

CREATE TABLE faction   (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uri text UNIQUE, наименование text NOT NULL);
CREATE TABLE committee (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uri text UNIQUE, наименование text NOT NULL);
CREATE TABLE sitting   (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uri text UNIQUE, дата date NOT NULL, вид text);

CREATE TABLE vote (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_id uuid REFERENCES sitting(id),
  предмет_kind text NOT NULL,   -- 'bill' | 'amendment'
  предмет_id   uuid NOT NULL,
  результат  text NOT NULL,
  за int, против int, воздержалось int, не_голосовало int,
  дата timestamptz
);

-- Классификатор правовых актов (Указ Президента РФ № 511)
CREATE TABLE rubric (
  код          text PRIMARY KEY CHECK (код ~ '^\d{3}(\.\d{3}){4}$'),
  наименование text NOT NULL,
  parent_код   text REFERENCES rubric(код),
  path         ltree NOT NULL
);
CREATE INDEX rubric_path ON rubric USING gist (path);

CREATE TABLE legal_concept (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uri          text NOT NULL UNIQUE,
  наименование text NOT NULL,
  -- единица, дающая легальную дефиницию
  defined_in_unit_id uuid REFERENCES unit(id)
);
```

**Триггер поддержки closure-таблицы:**

```sql
CREATE OR REPLACE FUNCTION legal.unit_closure_ins() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- сам на себя, depth 0
  INSERT INTO legal.unit_closure(ancestor_id, descendant_id, depth)
  VALUES (NEW.id, NEW.id, 0);
  -- все предки родителя + 1
  IF NEW.parent_id IS NOT NULL THEN
    INSERT INTO legal.unit_closure(ancestor_id, descendant_id, depth)
    SELECT c.ancestor_id, NEW.id, c.depth + 1
    FROM legal.unit_closure c
    WHERE c.descendant_id = NEW.parent_id;
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER unit_closure_ai AFTER INSERT ON legal.unit
FOR EACH ROW EXECUTE FUNCTION legal.unit_closure_ins();
```

**Эквивалент в property-graph (Cypher / Apache AGE)** — для справки:

```cypher
// Узлы
CREATE (:Act:НПА {uri:'akn://ru/act/fz/2006-07-27/149-ФЗ', вид:'fz',
                  наименование:'Об информации…', номер:'149-ФЗ',
                  датаПодписания: date('2006-07-27'), статус:'действует'})
CREATE (:Expression {uri:'…/ru@2025-01-01', действуетС: date('2025-01-01')})
CREATE (:Unit {eid:'art_15__part_3__point_2', wid:'…', вид:'punkt', номер:'2'})
CREATE (:Bill {sozdNumber:'123456-8'})
CREATE (:Deputy {фио:'Иванов И.И.'})

// Рёбра
(:Expression)-[:ЯВЛЯЕТСЯ_РЕДАКЦИЕЙ]->(:Act)
(:Unit)-[:СОДЕРЖИТ {порядок:1}]->(:Unit)
(:Unit)-[:ИЗМЕНЯЕТ {видИзменения:'изложить в новой редакции', действуетС: date('2025-01-01')}]->(:Unit)
(:Unit)-[:ССЫЛАЕТСЯ_НА {цитата:'пунктом 2 части 3 статьи 15…'}]->(:Unit)
(:Bill)-[:ВНЕСЁН]->(:Deputy)
(:Bill)-[:НАПРАВЛЕН_В_КОМИТЕТ {роль:'ответственный'}]->(:Committee)

// Индексы (Neo4j)
CREATE CONSTRAINT act_uri  IF NOT EXISTS FOR (a:Act)  REQUIRE a.uri IS UNIQUE;
CREATE CONSTRAINT unit_uri IF NOT EXISTS FOR (u:Unit) REQUIRE u.uri IS UNIQUE;
CREATE INDEX unit_wid      IF NOT EXISTS FOR (u:Unit) ON (u.wid);
```

> ⚠️ **Про Apache AGE:** Cypher-запросы оборачиваются в `SELECT * FROM cypher('graph_name', $$ … $$) AS (v agtype);` и **типизация результата — `agtype`**, что требует ручного разбора. Плюс AGE **не поддерживает** часть openCypher (например, `MERGE` с `ON MATCH` в старых версиях). Проверить на целевой версии PG. **[U]**

---

## 5. Извлечение правовых ссылок из русского текста

### 5.1 Состояние экосистемы

**Готовой библиотеки нет.** Поиск по npm, PyPI и GitHub не выявил зрелого парсера российских правовых ссылок. **[V — по результатам поиска]**

Что есть релевантного:

| Инструмент | Что даёт | Пригодность |
|---|---|---|
| **`natasha/yargy`** (github.com/natasha/yargy) | Rule-based извлечение фактов для русского языка, аналог Томита-парсера. Python 3.7+, PyPy3, зависит только от `pymorphy2`. **[V]** | 🥇 **Лучший готовый инструмент**, но грамматику пишем сами |
| **`natasha/natasha`** | NER, морфология, синтаксис; внутри использует yargy **[V]** | вспомогательно (нормализация ФИО, организаций) |
| **`vas3k/python-glr-parser`** | GLR-парсер для русского **[V]** | альтернатива yargy, менее живая **[U]** |
| **`openlegaldata/legal-reference-extraction`** | Извлечение ссылок из **немецких** судебных актов **[V]** | 🥈 **источник архитектурных идей**, не кода |
| **`freelawproject/eyecite`** | Парсер **американских** цитат **[V]** | источник идей (resolution/normalization pipeline) |
| **Gist `kuk/554499843fb3875ad3861e2b403126cc`** | Тестовое задание с **train.jsonl из 1000 размеченных предложений** со ссылками вида «ч. 3 ст.19 АПК РФ», «ст.ст. 15, 309 ГК РФ» + целевой JSON-формат **[V]** | 🥇 **готовый небольшой gold-set для регрессионных тестов** |
| **RusLawOD `<textIPS>`** | Текст с инлайн `<ref>linked text</ref>` — **готовая разметка ссылок из ИПС** **[V]** | 🥇 **дистанционный supervision: сотни тысяч примеров ссылок** |

> 💡 **Ключевая находка для реализации:** RusLawOD хранит текст с уже проставленными `<ref>` (в основном на изменяющие акты) **[V]**. Это даёт нам **бесплатный обучающий/валидационный корпус** для парсера без ручной разметки. Плюс gold-set из gist'а на 1000 предложений.

### 5.2 Анатомия российской правовой ссылки

Разбор целевого примера:

```
в соответствии с пунктом 2 части 3 статьи 15 Федерального закона от 27.07.2006 N 149-ФЗ
                └─────┬────┘ └────┬───┘ └───┬────┘ └──────────────┬──────────────────┘
                  point=2     part=3    article=15         акт-дескриптор
```

**Правило порядка:** в русском юридическом узусе структурные единицы идут **от мелкой к крупной** (пункт → часть → статья), затем — **дескриптор акта**. Это **противоположно** английскому. Грамматика должна это учитывать.

**Классы форм:**

1. **Полная ссылка с датой и номером**
   `Федерального закона от 27.07.2006 N 149-ФЗ`
   `Федерального конституционного закона от 21.07.1994 N 1-ФКЗ`
   `Указа Президента Российской Федерации от 15.03.2000 N 511`
   `постановления Правительства Российской Федерации от 30.06.2021 N 1119`
2. **Кодекс по имени** (без даты/номера)
   `Гражданского кодекса Российской Федерации`, `ГК РФ`, `АПК РФ`, `КоАП РФ`, `НК РФ`
3. **Само-ссылка** — `настоящего Федерального закона`, `настоящего Кодекса`, `настоящей статьи`, `настоящей части`
4. **Сокращённая** — `ст. 15`, `ч.3 ст.19`, `п. 2 ч. 3 ст. 15`, `абз. 2 п. 1 ст. 8`
5. **Множественная** (AKN `mref`) — `статей 15, 16 и 17`, `ст.ст. 15, 309 ГК РФ`, `частями 6, 7 статьи 210`
6. **Диапазонная** (AKN `rref`) — `статьями 15 — 20`, `пунктах 1 – 3 части 2`
7. **Ранее введённая аббревиатура** — `(далее — Закон о связи)` → затем `Закона о связи`
8. **Ссылка внутри поправки** — `в части 3 статьи 15 слова "…" заменить словами "…"`

**Морфологическая вариативность** (главная сложность):

| лемма | падежные формы, встречающиеся в текстах |
|---|---|
| статья | стать**я**, стать**и**, стать**е**, стать**ю**, стать**ёй**/стать**ей**, стать**ями**, стать**ей** (род. мн.), стать**ях** |
| часть | час**ть**, час**ти**, час**тью**, час**тей**, час**тями**, час**тях** |
| пункт | пункт, пункт**а**, пункт**у**, пункт**ом**, пункт**е**, пункт**ах**, пункт**ами**, пункт**ов** |
| подпункт | подпункт, подпункт**а**, … |
| абзац | абзац, абзац**а**, абзац**ем**, абзац**е**, абзац**ах** |
| глава | глав**а**, глав**ы**, глав**е**, глав**ой**, глав**ах** |

### 5.3 Грамматика (EBNF)

```ebnf
(* ══════════ ВЕРХНИЙ УРОВЕНЬ ══════════ *)
Reference       ::= UnitChain? ActDescriptor
                  | UnitChain SelfMarker
                  | UnitChain                     (* внутридокументная, акт из контекста *)

(* ══════════ ЦЕПОЧКА СТРУКТУРНЫХ ЕДИНИЦ (мелкая → крупная) ══════════ *)
UnitChain       ::= UnitGroup ( Sep? UnitGroup )*
UnitGroup       ::= UnitWord Nums
UnitWord        ::= AbzacW | PodpunktW | PunktW | ChastW | StatyaW
                  | ParagrafW | GlavaW | RazdelW | PrilozhenieW | PrimechanieW
Sep             ::= "," | "и" | "а также"

(* ══════════ НОМЕРА: одиночные, списки, диапазоны ══════════ *)
Nums            ::= NumItem ( NumSep NumItem )*
NumItem         ::= NumToken ( Dash NumToken )?     (* диапазон → rref *)
NumSep          ::= "," | "и" | ";"
Dash            ::= "-" | "—" | "–" | "‒"
NumToken        ::= ArabicNum         (* 15, 15.1, 15.2-1 *)
                  | RomanNum          (* IV *)
                  | RuLetter          (* а), б), в) *)
ArabicNum       ::= DIGIT+ ( ( "." | "-" ) DIGIT+ )*
RuLetter        ::= [а-яё] ")"?

(* ══════════ ДЕСКРИПТОР АКТА ══════════ *)
ActDescriptor   ::= FullActRef | CodexRef | NamedActRef | AbbrevRef

FullActRef      ::= ActTypeWord Issuer? DateClause NumClause
ActTypeWord     ::= "Федерального закона" | "Федерального конституционного закона"
                  | "Закона Российской Федерации" | "Указа" | "Постановления"
                  | "Распоряжения" | "Приказа" | "Кодекса"  (* + все падежные формы *)
Issuer          ::= "Президента Российской Федерации"
                  | "Правительства Российской Федерации"
                  | "Российской Федерации" | "РФ"
                  | OrganName
DateClause      ::= "от" Date
Date            ::= DD "." MM "." YYYY
                  | DD MonthNameRu YYYY G?          (* «27 июля 2006 года» *)
NumClause       ::= ( "N" | "№" | "N." ) ActNumber
ActNumber       ::= DIGIT+ ( "-" ( "ФЗ" | "ФКЗ" | "ЗРФ" ) )?
                  | DIGIT+ "/" DIGIT+
                  | DIGIT+ RuLetter?

CodexRef        ::= CodexFullName | CodexAbbrev
CodexFullName   ::= ( "Гражданского" | "Уголовного" | "Налогового" | "Трудового"
                    | "Семейного" | "Жилищного" | "Земельного" | "Бюджетного"
                    | "Градостроительного" | "Лесного" | "Водного" | "Воздушного"
                    | "Таможенного" | "Арбитражного процессуального"
                    | "Гражданского процессуального" | "Уголовно-процессуального"
                    | "Уголовно-исполнительного" ) "кодекса" RF?
                  | "Кодекса Российской Федерации об административных правонарушениях"
CodexAbbrev     ::= ( "ГК" | "УК" | "НК" | "ТК" | "СК" | "ЖК" | "ЗК" | "БК"
                    | "ГрК" | "ЛК" | "ВК" | "ТмК" | "АПК" | "ГПК" | "УПК"
                    | "УИК" | "КоАП" | "КАС" ) RF?
RF              ::= "РФ" | "Российской Федерации"

NamedActRef     ::= "Федерального закона" Quote Title Quote     (* «О связи» *)
AbbrevRef       ::= PreviouslyDefinedAbbrev                      (* из «(далее — …)» *)

SelfMarker      ::= "настоящего Федерального закона" | "настоящего Кодекса"
                  | "настоящей статьи" | "настоящей части" | "настоящего пункта"
```

### 5.4 Реализация: гибридный конвейер

**[U — авторское проектное предложение]**

```
                    ┌────────────────────────────────────────────┐
текст ─────────────▶│ 1. Токенизация + морфоразбор              │
                    │    (natasha / pymorphy2 / RuBERT-lemmatizer)│
                    └───────────────────┬────────────────────────┘
                                        ▼
                    ┌────────────────────────────────────────────┐
                    │ 2. Кандидаты: скользящие регулярные окна   │
                    │    вокруг якорей (статья|часть|пункт|…)    │
                    └───────────────────┬────────────────────────┘
                                        ▼
                    ┌────────────────────────────────────────────┐
                    │ 3. Разбор грамматикой §5.3 → ParsedReference│
                    └───────────────────┬────────────────────────┘
                                        ▼
                    ┌────────────────────────────────────────────┐
                    │ 4. РАЗРЕШЕНИЕ (resolution):                │
                    │    • акт-дескриптор → act.id по (вид,дата,№)│
                    │    • «настоящий …» → из контекста документа │
                    │    • сокращения → таблица «(далее — …)»     │
                    │    • eId цепочки → unit.id в нужной редакции│
                    └───────────────────┬────────────────────────┘
                                        ▼
                    ┌────────────────────────────────────────────┐
                    │ 5. LLM-арбитр ТОЛЬКО для нераспознанного    │
                    │    (< 5% случаев) + confidence < 0.8        │
                    └───────────────────┬────────────────────────┘
                                        ▼
                              legal_edge (вид='ссылается_на')
```

> 🔑 **Принципиально: LLM — НЕ основной экстрактор.** Правовые ссылки — регулярная, формализованная конструкция; детерминированная грамматика даёт воспроизводимость, скорость и объяснимость. LLM подключается как fallback на «хвост» (нестандартные формулировки, ссылки на утратившие силу акты, неоднозначные аббревиатуры). Для юридического продукта воспроизводимость критична. **[U]**

**Целевой тип результата:**

```ts
// packages/legal-refs/src/types.ts
import { z } from "zod";   // zod@4.4.3 [V]

export const StructuralUnitRef = z.object({
  kind: z.enum(["razdel","podrazdel","glava","paragraf","statya",
                "chast","punkt","podpunkt","abzac","primechanie","prilozhenie"]),
  /** одиночный номер, или список, или диапазон */
  nums: z.array(z.union([
    z.object({ t: z.literal("single"), n: z.string() }),
    z.object({ t: z.literal("range"),  from: z.string(), to: z.string() }),
  ])).min(1),
});

export const ActRef = z.discriminatedUnion("t", [
  z.object({ t: z.literal("full"),
             actType: z.string(),          // 'fz' | 'fkz' | 'ukaz' | …
             issuer:  z.string().nullable(),
             date:    z.string(),          // ISO 'YYYY-MM-DD'
             number:  z.string() }),       // '149-ФЗ'
  z.object({ t: z.literal("codex"),  name: z.string() }),          // 'ГК' | 'АПК'
  z.object({ t: z.literal("named"),  title: z.string() }),         // «О связи»
  z.object({ t: z.literal("abbrev"), abbrev: z.string() }),        // 'Закон о связи'
  z.object({ t: z.literal("self"),   scope: z.enum(["act","article","part","point"]) }),
]);

export const ParsedReference = z.object({
  /** [start, end) в исходном тексте — как в gold-set из gist'а kuk */
  span:  z.tuple([z.number().int(), z.number().int()]),
  raw:   z.string(),
  /** цепочка от мелкой к крупной, как в тексте */
  units: z.array(StructuralUnitRef),
  act:   ActRef.nullable(),
  /** после стадии разрешения */
  resolved: z.object({
    actId:  z.string().uuid().nullable(),
    unitIds: z.array(z.string().uuid()),
    /** канонический AKN-URI */
    uri: z.string().nullable(),
  }).nullable(),
  confidence: z.number().min(0).max(1),
});
export type ParsedReference = z.infer<typeof ParsedReference>;
```

**Ядро регулярных выражений (TypeScript, Unicode-aware):**

```ts
// packages/legal-refs/src/patterns.ts

/** Морфологические варианты названий структурных единиц. Ключ — канонический kind. */
export const UNIT_WORDS: Record<string, string> = {
  statya:   String.raw`стат(?:ья|ьи|ье|ью|ьёй|ьей|ьями|ьях|ей)|ст\.?\s*ст\.?|ст\.`,
  chast:    String.raw`част(?:ь|и|ью|ей|ями|ях)|ч\.`,
  punkt:    String.raw`пункт(?:а|у|ом|е|ах|ами|ов)?|п\.`,
  podpunkt: String.raw`подпункт(?:а|у|ом|е|ах|ами|ов)?|пп\.|подп\.`,
  abzac:    String.raw`абзац(?:а|у|ем|е|ах|ами|ев)?|абз\.`,
  paragraf: String.raw`параграф(?:а|у|ом|е|ах)?|§`,
  glava:    String.raw`глав(?:а|ы|е|у|ой|ах|ами)|гл\.`,
  razdel:   String.raw`раздел(?:а|у|ом|е|ах|ами|ов)?|разд\.`,
  prilozhenie: String.raw`приложени(?:е|я|ю|ем|и|ях|ями)|прил\.`,
  primechanie: String.raw`примечани(?:е|я|ю|ем|и|ях)`,
};

/** Номер: 15, 15.1, 15.2-1, IV, а) */
export const NUM = String.raw`\d+(?:[.\-]\d+)*|[IVXLC]+|[а-яё]\)`;

/** Список/диапазон номеров */
export const NUM_LIST = String.raw`(?:${NUM})(?:\s*(?:[-—–]\s*(?:${NUM}))?` +
                        String.raw`(?:\s*(?:,|и|;)\s*(?:${NUM})(?:\s*[-—–]\s*(?:${NUM}))?)*)`;

/** Одна структурная группа: «пунктом 2», «частями 6, 7», «статьями 15 — 20» */
export const unitGroup = (kind: keyof typeof UNIT_WORDS) =>
  String.raw`(?<${kind}>(?:${UNIT_WORDS[kind]})\s*(?<${kind}_nums>${NUM_LIST}))`;

/** Дескриптор акта: полная форма */
export const FULL_ACT = String.raw`
  (?<actType>
      [Фф]едеральн(?:ого|ый|ым|ом)\s+конституционн(?:ого|ый|ым|ом)\s+закон(?:а|у|ом|е)?
    | [Фф]едеральн(?:ого|ый|ым|ом)\s+закон(?:а|у|ом|е)?
    | [Зз]акон(?:а|у|ом|е)?\s+Российской\s+Федерации
    | [Уу]каз(?:а|у|ом|е)?
    | [Пп]остановлени(?:я|е|ю|ем|и)
    | [Рр]аспоряжени(?:я|е|ю|ем|и)
    | [Пп]риказ(?:а|у|ом|е)?
    | [Кк]одекс(?:а|у|ом|е)?
  )
  (?:\s+(?<issuer>
      Президента\s+Российской\s+Федерации
    | Правительства\s+Российской\s+Федерации
    | Российской\s+Федерации
    | РФ
  ))?
  \s+от\s+(?<date>\d{2}\.\d{2}\.\d{4}
           |\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля
                       |августа|сентября|октября|ноября|декабря)\s+\d{4}(?:\s*г(?:ода|\.)?)?)
  \s*(?:N|№|N\.)\s*(?<actNum>\d+(?:-(?:ФЗ|ФКЗ|ЗРФ))?|\d+/\d+|\d+[а-яё]?)
`.replace(/\s+|#.*$/gm, (m) => (m.startsWith("#") ? "" : ""));  // строится через RegExp с флагом x-эмуляцией

/** Кодексы: сокращения */
export const CODEX_ABBREV =
  String.raw`(?<codex>ГК|УК|НК|ТК|СК|ЖК|ЗК|БК|ГрК|ЛК|ВК|ТмК|АПК|ГПК|УПК|УИК|КоАП|КАС)` +
  String.raw`(?:\s*(?:РФ|Российской\s+Федерации))?`;

/** Само-ссылка */
export const SELF_REF =
  String.raw`настоящ(?:его|ей|ем|им)\s+` +
  String.raw`(?<selfScope>Федерального\s+закона|Кодекса|стать[иеюй]|част[иью]|пункт[аеу])`;
```

**Полное правило-сборка** (порядок групп: мелкая → крупная, затем акт):

```ts
// packages/legal-refs/src/grammar.ts
import { unitGroup, FULL_ACT, CODEX_ABBREV, SELF_REF } from "./patterns";

const CHAIN = [
  unitGroup("abzac"),
  unitGroup("podpunkt"),
  unitGroup("punkt"),
  unitGroup("chast"),
  unitGroup("statya"),
  unitGroup("paragraf"),
  unitGroup("glava"),
  unitGroup("razdel"),
].map((g) => `(?:${g}\\s*)?`).join("");

export const REFERENCE_RE = new RegExp(
  `${CHAIN}(?:${FULL_ACT}|${CODEX_ABBREV}|${SELF_REF})?`,
  "giu"
);
```

**Разбор целевого примера — ожидаемый результат:**

```jsonc
// вход: "в соответствии с пунктом 2 части 3 статьи 15 Федерального закона от 27.07.2006 N 149-ФЗ"
{
  "span": [17, 89],
  "raw": "пунктом 2 части 3 статьи 15 Федерального закона от 27.07.2006 N 149-ФЗ",
  "units": [
    { "kind": "punkt",  "nums": [{ "t": "single", "n": "2"  }] },
    { "kind": "chast",  "nums": [{ "t": "single", "n": "3"  }] },
    { "kind": "statya", "nums": [{ "t": "single", "n": "15" }] }
  ],
  "act": { "t": "full", "actType": "fz", "issuer": null,
           "date": "2006-07-27", "number": "149-ФЗ" },
  "resolved": {
    "actId": "…uuid…",
    "unitIds": ["…uuid…"],
    "uri": "akn://ru/act/fz/2006-07-27/149-ФЗ#art_15__part_3__point_2"
  },
  "confidence": 0.98
}
```

Обратите внимание: **`eId` собирается из цепочки в ОБРАТНОМ порядке** (крупная → мелкая), как требует AKN Naming Convention: `art_15__part_3__point_2`. **[U]**

### 5.5 Разрешение (resolution) — самое сложное

Разбор — 30% работы. 70% — превратить `ParsedReference` в `unit.id`. **[U]**

```sql
-- Шаг 1: акт по (вид, дата, номер) — используем natural key
SELECT id FROM legal.act
WHERE вид = $1::legal.вид_акта_t AND дата_подписания = $2::date AND номер = $3;

-- Шаг 1b: кодекс по сокращению
SELECT id FROM legal.act WHERE $1 = ANY(сокращения) AND вид = 'kodeks';

-- Шаг 2: редакция, действующая на дату документа-источника
SELECT id FROM legal.expression
WHERE act_id = $1 AND период @> $2::date;

-- Шаг 3: структурная единица по eId в этой редакции
SELECT id FROM legal.unit WHERE expression_id = $1 AND eid = $2;

-- Шаг 3-fallback: если eId не совпал (перенумерация) — по wid
SELECT u.id FROM legal.unit u
JOIN legal.expression e ON e.id = u.expression_id
WHERE u.wid = $1 AND e.act_id = $2 AND e.период @> $3::date;
```

**Правила разрешения неоднозначностей [U]:**
1. **Темпоральное правило.** Ссылка разрешается в редакцию, действовавшую **на дату подписания документа-источника**, а не на сегодня. Иначе исторические ссылки поедут.
2. **Само-ссылки.** `настоящего Федерального закона` → `act_id` текущего документа. `настоящей статьи` → ближайший предок-`statya` текущей единицы (по `unit_closure`).
3. **Таблица аббревиатур.** Сканировать документ на `\(далее\s*[-—–]\s*(?<abbrev>[^)]+)\)` и строить локальный словарь до основного прохода.
4. **Ненайденный акт.** НЕ отбрасывать — создавать «висячее» ребро с `dst_kind='unresolved'` и `payload` = разобранный дескриптор, `уверенность < 1`. Позже, когда акт появится в БД, фоновый джоб дошивает связь.
5. **Диапазоны.** `статьями 15 — 20` разворачивается в N рёбер, но помечается `payload->>'rref' = 'true'` для корректного экспорта в AKN `<rref>`.

### 5.6 Тестовая стратегия

**[U]**

| Слой | Данные | Метрика |
|---|---|---|
| Unit | ~200 рукописных случаев (по одному на каждую форму из §5.2) | 100% |
| Gold-set | 1000 предложений из gist `kuk/554499843…` **[V]** | span F1 ≥ 0.95, structure F1 ≥ 0.92 |
| Distant supervision | `<ref>` из `<textIPS>` RusLawOD **[V]** | recall ≥ 0.90 против разметки ИПС |
| Regression | снапшоты разбора 500 реальных законопроектов | 0 регрессий в CI |

---

## 6. Анализ воздействия (impact analysis)

Два зеркальных вопроса:
- **Прямой:** *«Что этот законопроект меняет?»* → `ChangeSet`
- **Обратный:** *«Что ещё зависит от изменяемого?»* → `BlastRadius`

### 6.1 Прямой: извлечение ChangeSet из законопроекта

Российский законопроект «о внесении изменений» имеет **жёстко регулярную структуру**:

```
Статья 1
Внести в Федеральный закон от 27 июля 2006 года N 149-ФЗ «Об информации, …»
(Собрание законодательства Российской Федерации, 2006, N 31, ст. 3448; …)
следующие изменения:
1) в статье 10:
   а) часть 1 изложить в следующей редакции:
      «1. …новый текст…»;
   б) дополнить частью 1.1 следующего содержания:
      «1.1. …»;
2) статью 15.1 признать утратившей силу;
3) в части 3 статьи 15 слова «…» заменить словами «…».

Статья 2
Настоящий Федеральный закон вступает в силу с 1 сентября 2026 года.
```

**Грамматика операций изменения:**

```ebnf
ChangeStatement ::= TargetSpec Operation
TargetSpec      ::= "в" UnitChain ":"                    (* контекст-заголовок *)
                  | UnitChain                             (* прямая цель *)
Operation       ::= "изложить в следующей редакции" ":" QuotedStructure
                  | "признать утративш" Infl "силу"
                  | "дополнить" UnitWord Nums "следующего содержания" ":" QuotedStructure
                  | "дополнить" "словами" QuotedText
                  | "исключить"
                  | "слова" QuotedText "заменить словами" QuotedText
                  | "приостановить действие" ("до" Date)?
QuotedStructure ::= "«" ... "»"    (* → AKN <quotedStructure> *)
QuotedText      ::= "«" ... "»"    (* → AKN <quotedText>      *)
```

> 🔑 **Стековая семантика вложенности.** `1) в статье 10:` открывает контекст; `а) часть 1 …` — цель относительна ему. Разбор ведётся стеком контекстов, ровно как в парсере блочной разметки. Это **не** плоский список. **[U]**

```ts
export interface ChangeSetItem {
  /** цель — стабильный wId; unitId может быть null, если акт ещё не в БД */
  readonly targetWid: string;
  readonly targetUnitId: NodeId | null;
  readonly targetActUri: string;
  readonly operation:
    | { t: "replace";  newText: string }
    | { t: "repeal" }
    | { t: "insert";   kind: UnitKind; num: string; text: string; after: string | null }
    | { t: "delete" }
    | { t: "replaceWords"; from: string; to: string }
    | { t: "appendWords";  text: string }
    | { t: "suspend";  until: string | null };
  readonly inForceFrom: string | null;   // из «Статья N. Вступление в силу»
  readonly sourceSpan: [number, number]; // где в тексте законопроекта
  readonly confidence: number;
}
```

**Материализация в граф:** каждый `ChangeSetItem` → строка в `legal_edge`:

```sql
INSERT INTO legal.legal_edge
  (вид, src_kind, src_id, dst_kind, dst_id, вид_изменения, период, payload, уверенность, источник)
VALUES
  ('изменяет', 'bill', $bill_id, 'unit', $target_unit_id,
   $вид_изменения::legal.вид_изменения_t,
   daterange($in_force_from::date, NULL, '[)'),
   jsonb_build_object('newText', $new_text, 'sourceSpan', $span),
   $confidence, 'parser');
```

### 6.2 Обратный: BlastRadius через рекурсивные CTE

**Уровень 1 — структурные потомки цели** (правя статью, правим все её части и пункты):

```sql
-- O(1) благодаря closure-таблице
SELECT u.* FROM legal.unit u
JOIN legal.unit_closure c ON c.descendant_id = u.id
WHERE c.ancestor_id = $target_unit_id;
```

**Уровень 2 — транзитивные входящие ссылки** (кто на нас ссылается, и кто ссылается на них):

```sql
WITH RECURSIVE dependents AS (
    -- база: прямые ссылки на цель и на её структурных потомков
    SELECT e.src_id            AS unit_id,
           1                   AS depth,
           ARRAY[e.src_id]     AS path,
           e.вид               AS via
    FROM legal.legal_edge e
    JOIN legal.unit_closure c
      ON c.descendant_id = e.dst_id
    WHERE c.ancestor_id = $1::uuid          -- целевая единица
      AND e.dst_kind = 'unit'
      AND e.src_kind = 'unit'
      AND e.вид IN ('ссылается_на','толкует','вводится_в_действие')
      AND (e.период IS NULL OR e.период @> $2::date)   -- темпоральный срез

  UNION ALL

    -- шаг: кто ссылается на найденных
    SELECT e.src_id,
           d.depth + 1,
           d.path || e.src_id,
           e.вид
    FROM dependents d
    JOIN legal.legal_edge e
      ON e.dst_kind = 'unit' AND e.dst_id = d.unit_id
     AND e.src_kind = 'unit'
    WHERE d.depth < $3::int                  -- ОБЯЗАТЕЛЬНЫЙ предел глубины
      AND NOT (e.src_id = ANY(d.path))       -- защита от циклов
      AND e.вид IN ('ссылается_на','толкует')
      AND (e.период IS NULL OR e.период @> $2::date)
)
SELECT DISTINCT ON (d.unit_id)
       d.unit_id,
       d.depth,
       d.via,
       u.eid,
       u.вид        AS вид_единицы,
       u.наименование,
       a.наименование AS акт,
       a.номер        AS номер_акта,
       a.uri          AS акт_uri
FROM dependents d
JOIN legal.unit u ON u.id = d.unit_id
JOIN legal.act  a ON a.id = u.act_id
ORDER BY d.unit_id, d.depth ASC;   -- кратчайший путь до каждого зависимого
```

> ⚠️ **`d.depth < $3` и `NOT (… = ANY(d.path))` — не опциональны.** Правовой граф насыщен циклами (взаимные ссылки между кодексами). Без ограничителей запрос не завершится. **[U]**

**Уровень 3 — подзаконные акты, изданные «во исполнение»:**

```sql
SELECT a2.*
FROM legal.legal_edge e
JOIN legal.unit u2 ON u2.id = e.src_id
JOIN legal.act  a2 ON a2.id = u2.act_id
WHERE e.вид = 'вводится_в_действие'
  AND e.dst_kind = 'unit'
  AND e.dst_id IN (SELECT descendant_id FROM legal.unit_closure WHERE ancestor_id = $1);
```

**Уровень 4 — конфликтующие законопроекты** (другие проекты в работе, трогающие те же нормы):

```sql
SELECT DISTINCT b.id, b.sozd_number, b.наименование, b.стадия,
       count(*) OVER (PARTITION BY b.id) AS пересечений
FROM legal.legal_edge e
JOIN legal.bill b ON b.id = e.src_id AND e.src_kind = 'bill'
WHERE e.вид = 'изменяет'
  AND e.dst_kind = 'unit'
  AND e.dst_id IN (
      SELECT c.descendant_id FROM legal.unit_closure c
      WHERE c.ancestor_id = ANY($1::uuid[])     -- все цели нашего законопроекта
  )
  AND b.id <> $2::uuid                          -- кроме нас самих
  AND b.стадия NOT IN ('отклонён','снят с рассмотрения','подписан');
```

**Уровень 5 — ранжирование по значимости.** Не все зависимости равны. Метрика «центральности» нормы:

```sql
-- Материализованное представление, обновляется по расписанию
CREATE MATERIALIZED VIEW legal.unit_centrality AS
SELECT u.id AS unit_id,
       count(*) FILTER (WHERE e.вид = 'ссылается_на') AS входящих_ссылок,
       count(DISTINCT u2.act_id)                       AS ссылающихся_актов,
       count(*) FILTER (WHERE e.вид = 'толкует')       AS толкований
FROM legal.unit u
LEFT JOIN legal.legal_edge e ON e.dst_kind = 'unit' AND e.dst_id = u.id
LEFT JOIN legal.unit u2      ON u2.id = e.src_id
GROUP BY u.id;
CREATE UNIQUE INDEX ON legal.unit_centrality (unit_id);
```

Итоговая оценка риска (эвристика) **[U]**:

```
risk_score = Σ_по зависимым (  w_depth(depth)
                             × w_kind(вид_ребра)
                             × log1p(входящих_ссылок)
                             × w_operation(вид_изменения) )

w_depth      : 1.0 / 0.5 / 0.2 / 0.05        (глубина 1..4)
w_kind       : ссылается_на=1.0, толкует=0.7, вводится_в_действие=1.5
w_operation  : признать утратившим силу=3.0, изложить в новой редакции=2.0,
               заменить слова=1.0, дополнить=0.5
```

### 6.3 Собранный отчёт

```ts
export interface BlastRadiusReport {
  readonly bill: { id: NodeId; sozdNumber: string; наименование: string };
  /** §6.1 — что меняется */
  readonly changes: ChangeSetItem[];
  /** §6.2 ур.1 — структурно затронутые единицы */
  readonly directlyAffected: AffectedUnit[];
  /** §6.2 ур.2 — транзитивно зависящие */
  readonly dependents: Array<AffectedUnit & { depth: number; via: EdgeKind }>;
  /** §6.2 ур.3 — подзаконные акты под угрозой */
  readonly subordinateActs: ActSummary[];
  /** §6.2 ур.4 — конкурирующие законопроекты */
  readonly conflictingBills: Array<{ bill: BillSummary; пересечений: number }>;
  /** §6.2 ур.5 */
  readonly riskScore: number;
  /** «сирые» ссылки, которые парсер не разрешил — требуют внимания юриста */
  readonly unresolved: ParsedReference[];
  readonly computedAt: string;
  /** темпоральный срез, на который считали */
  readonly asOf: string;
}
```

### 6.4 Производительность и практика

**[U — оценки, требуют замера на реальных данных]**

| Приём | Зачем |
|---|---|
| **Всегда `maxDepth`** (по умолчанию 3) | правовой граф цикличен; без предела — зависание |
| **Closure table для `содержит`** | «все потомки статьи» — самый частый запрос; рекурсия здесь избыточна |
| **Рекурсия только для `ссылается_на`** | этот граф разрежен и нерегулярен, closure по нему взорвётся по объёму |
| **Материализовать `unit_centrality`** | пересчёт по расписанию (ночью), не в реальном времени |
| **Кэшировать `BlastRadiusReport` в Redis** по ключу `(billId, asOf, maxDepth)` | отчёт стабилен между правками законопроекта |
| **Темпоральный фильтр `период @> asOf` во ВСЕХ ветках CTE** | иначе смешаются исторические и действующие связи |
| **Пороговать по `уверенность`** | UI должен отделять «точно» от «вероятно» — юрист обязан видеть разницу |
| Проверять план через `EXPLAIN (ANALYZE, BUFFERS)` | рекурсивные CTE в PG материализуются; при плохой селективности `edge_in` план деградирует |

### 6.5 Эквивалент на TypeQL 3.x (для справки)

```typeql
match
  $bill isa законопроект, has номер_законопроекта "123456-8";
  подал_поправку (законопроект: $bill, цель: $target);
  let $dep in зависимые($target);             # рекурсивная функция из §4.2
  $dep isa структурная_единица, has eid $dep_eid;
  содержит (контейнер: $rev, элемент: $dep);
  является_редакцией (редакция: $rev, акт: $dep_act);
  $dep_act has наименование $dep_act_name, has статус "действует";
let $refs = число_ссылок($dep);
sort $refs desc;
limit 200;
fetch { "зависимая_единица": $dep_eid, "акт": $dep_act_name, "вес": $refs };
```

Сравните с §6.2: TypeQL **читается заметно приятнее** — рекурсия спрятана в функцию, нет ручной защиты от циклов. Это честное преимущество TypeDB. Но оно **не перевешивает** рисков §2.3 — и, что важно, **в TypeQL нет встроенного ограничителя глубины**, т.е. защиту от циклов всё равно придётся закладывать в саму функцию. **[U]**

---

## 7. План внедрения

**[U — проектное предложение]**

| Фаза | Работы | Выход |
|---|---|---|
| **0. Фундамент** | DDL §4.3 в Supabase-миграциях; RLS-политики; `LegalGraphPort` + `PgLegalGraph` | схема + порт |
| **1. Загрузка** | Импорт RusLawOD (304 382 акта **[V]**); справочник Классификатора № 511; словарь кодексов | заполненный `act` |
| **2. Структура** | Парсер структуры актов (статья/часть/пункт) → `unit` + `unit_closure` + `eId`/`wId` | заполненный `unit` |
| **3. Ссылки** | Парсер §5; distant supervision на `<ref>` RusLawOD; gold-set из gist'а | `legal_edge` вид `ссылается_на` |
| **4. Редакции** | 🔴 **Отдельная задача:** RusLawOD даёт только первые редакции **[V]**. Нужен другой источник консолидированных текстов | `expression` с реальными периодами |
| **5. Законопроекты** | Импорт СОЗД; парсер ChangeSet §6.1 | `bill`, `amendment`, рёбра `изменяет` |
| **6. Impact** | Запросы §6.2; кэш; UI-отчёт | `BlastRadiusReport` |
| **7. Опционально** | Экспорт в AKN XML (round-trip тест в CI); публикация RU-ELI URI | интероперабельность |

### 🔴 Главный незакрытый риск

**Действующие (консолидированные) редакции НПА.** RusLawOD их **не содержит** — только первоначальные тексты **[V]**. Официальный pravo.gov.ru публикует акты **в графическом виде (TIFF/PDF без текстового слоя)** **[V]**. Консолидированные тексты де-факто есть только у КонсультантПлюс и Гарант — **проприетарных коммерческих систем**.

**Следствие:** либо (а) лицензировать данные у КонсультантПлюс/Гарант, либо (б) **строить консолидацию самостоятельно** — применяя извлечённые `ChangeSet` (§6.1) к первоначальным текстам последовательно по датам. Вариант (б) — это, по сути, реализация «git для законов», и **это ядро ценности продукта**, но и главный технический риск. Вариант (б) технически возможен именно потому, что у нас есть и первоначальные тексты (RusLawOD), и парсер операций изменения. **[U]**

---

## 8. Сводка проверенных версий (на 2026-08-20)

```bash
# ── TypeDB ─────────────────────────────────────────────
npm view @typedb/driver-http version   # 3.12.3   ✅ единственный путь для TS+TypeDB3
npm view typedb-driver version         # 2.29.7   ⚠️ ТОЛЬКО TypeDB 2.x, НЕ 3.x
docker pull typedb/typedb:3.12.3       # сервер CE, MPL-2.0

# ── Альтернативы ───────────────────────────────────────
npm view neo4j-driver version          # 6.2.0
npm view @neo4j/cypher-builder version # 3.3.0
npm view oxigraph version              # 0.5.9    (RDF/SPARQL, встраиваемый)
npm view sparqljs version              # 3.7.4
npm view n3 version                    # 2.2.5

# ── Реляционный путь (рекомендуемый) ───────────────────
npm view pg version                    # 8.23.0
npm view kysely version                # 0.29.5
npm view drizzle-orm version           # 0.45.2

# ── Вспомогательное ────────────────────────────────────
npm view zod version                   # 4.4.3
npm view nanoid version                # 6.0.1
npm view fast-xml-parser version       # 5.11.0   (экспорт/импорт AKN)
npm view saxes version                 # 6.0.0    (потоковый XML для больших дампов)
npm view @xmldom/xmldom version        # 0.9.11
npm view @qdrant/js-client-rest version # 1.19.0
```

Все значения получены командой `npm view` из публичного реестра npm 2026-08-20. **[V]**

---

## 9. Источники

**TypeDB**
- TypeDB 2.x → 3.x differences — https://typedb.com/docs/reference/typedb-2-vs-3/diff/
- TypeDB 3.0 is now live — https://typedb.com/blog/typedb-3-0-is-now-live/
- Функции в TypeDB 3.0 — https://typedb.com/fundamentals/functions-3-0/
- Пайплайны в TypeDB 3.0 — https://typedb.com/fundamentals/pipelines-3-0/
- TypeQL Reference: Fetch stage — https://typedb.com/docs/typeql-reference/pipelines/fetch/
- TypeQL Reference: writing functions — https://typedb.com/docs/typeql-reference/functions/writing
- HTTP TypeScript driver API — https://typedb.com/docs/reference/http-drivers/typescript
- HTTP API Reference — https://typedb.com/docs/reference/http-api
- Установка Community Edition — https://typedb.com/docs/home/install/ce/
- Репозиторий и лицензия (MPL-2.0) — https://github.com/typedb/typedb
- Релизы — https://github.com/typedb/typedb/releases
- Docker Hub — https://hub.docker.com/u/typedb
- npm `@typedb/driver-http` — https://www.npmjs.com/package/@typedb/driver-http
- npm `typedb-driver` (2.x) — https://www.npmjs.com/package/typedb-driver
- TypeDB (Wikipedia) — https://en.wikipedia.org/wiki/TypeDB

**Альтернативы**
- Neo4j — https://github.com/neo4j/neo4j ; https://neo4j.com/open-core-and-neo4j/
- Neo4j (Wikipedia) — https://en.wikipedia.org/wiki/Neo4j
- Apache AGE — https://age.apache.org/ ; https://github.com/apache/age
- AGE roadmap / PG17-PG18 — https://github.com/apache/age/discussions/2305
- Graph Queries in Postgres with Apache AGE — https://www.snowflake.com/en/blog/engineering/graph-queries-postgres-apache-age/
- Apache AGE vs Neo4j — https://www.puppygraph.com/learn/apache-age-vs-neo4j

**Стандарты правовых документов**
- Akoma Ntoso v1.0 Part 1: XML Vocabulary — https://docs.oasis-open.org/legaldocml/akn-core/v1.0/os/part1-vocabulary/akn-core-v1.0-os-part1-vocabulary.html
- Akoma Ntoso XSD — https://docs.oasis-open.org/legaldocml/akn-core/v1.0/os/part2-specs/schemas/akomantoso30.xsd
- Akoma Ntoso Naming Convention v1.0 — https://docs.oasis-open.org/legaldocml/akn-nc/v1.0/akn-nc-v1.0.html
- OASIS Akoma Ntoso v1.0 (standard page) — https://www.oasis-open.org/standard/akn-v1-0/
- OASIS LegalDocML TC — https://www.oasis-open.org/committees/legaldocml/
- LegalRuleML Core Specification v1.0 — https://docs.oasis-open.org/legalruleml/legalruleml-core-spec/v1.0/legalruleml-core-spec-v1.0.html
- LegalRuleML OASIS Standard анонс — https://www.oasis-open.org/2021/09/08/legalruleml-core-specification-v1-0-oasis-standard-published/
- ELI ontology — https://data.europa.eu/eli/ontology
- ELI — EU Vocabularies — https://op.europa.eu/en/web/eu-vocabularies/eli
- ELI Technical Implementation Guide — https://op.europa.eu/documents/2050822/2138819/ELI+-+A+Technical+Implementation+Guide.pdf/
- European Legislation Identifier (Wikipedia) — https://en.wikipedia.org/wiki/European_Legislation_Identifier
- Temporal FRBR/FRBRoo model for component-level versioning of legal norms — https://arxiv.org/html/2506.07853v1
- Legal Knowledge Graph Foundations, Part I (LRMoo F1 → schema.org) — https://arxiv.org/pdf/2508.00827

**Российское право и данные**
- RusLawOD (GitHub) — https://github.com/irlcode/RusLawOD
- RusLawOD README (RU) — https://github.com/irlcode/RusLawOD/blob/master/README_RUS.md
- RusLawOD (Hugging Face) — https://huggingface.co/datasets/irlspbru/RusLawOD
- Saveliev, Kuchakov (2024). The Russian Legislative Corpus — https://arxiv.org/abs/2406.04855 ; https://arxiv.org/html/2406.04855v2
- Указ Президента РФ от 15.03.2000 № 511 «О классификаторе правовых актов» — https://www.consultant.ru/document/cons_doc_LAW_26510/ ; http://kremlin.ru/acts/bank/15256/print
- Классификатор правовых актов (структура) — https://classinform.ru/classifikator-pravovykh-aktov.html
- Концепция развития технологий машиночитаемого права (2021) — https://www.consultant.ru/document/cons_doc_LAW_396491/
- Минэкономразвития: об утверждении Концепции — https://www.economy.gov.ru/material/news/v_pravitelstve_utverdili_koncepciyu_razvitiya_tehnologiy_mashinochitaemogo_prava.html
- Машиночитаемое право: правовой вызов современности (НИУ ВШЭ) — https://publications.hse.ru/articles/547512432

**Извлечение ссылок / NLP**
- natasha/yargy — https://github.com/natasha/yargy
- natasha/natasha — https://github.com/natasha/natasha
- Gold-set российских правовых ссылок (gist) — https://gist.github.com/kuk/554499843fb3875ad3861e2b403126cc
- openlegaldata/legal-reference-extraction — https://github.com/openlegaldata/legal-reference-extraction
- freelawproject/eyecite — https://github.com/freelawproject/eyecite ; whitepaper: https://free.law/pdf/eyecite-whitepaper.pdf
- vas3k/python-glr-parser — https://github.com/vas3k/python-glr-parser
