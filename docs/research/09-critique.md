# 09 — Completeness critique of the Doomatel research corpus

**Reviewed:** `00-network-access-notes.md`, `01-sozd-data-sources.md`, `03-mastra.md`,
`04-retrieval.md`, `05-knowledge-graph.md`, `06-collab-editor.md`, `07-platform.md`,
`08-media-and-plugins.md` (11 484 lines total), plus the current scaffold
(`packages/db`, `packages/ingest`, `packages/legal`, `packages/retrieval`,
`apps/agents`, `infra/docker-compose.yml`, `.env.example`).

**What this document is.** An adversarial completeness review, not a summary. Its job is
to name what is missing, what is asserted without evidence, where two streams disagree,
and which recommendations are actively dangerous *for this specific customer* — a system
operated in the Russian Federation for Государственная Дума deputies.

**Overall verdict.** The technical depth of the seven streams is unusually high — the
package-level verification discipline (`[V-npm]`, `[V-src]`, reading `.d.ts` from unpacked
tarballs) is better than most production architecture work. The gaps are almost entirely
*non-technical or cross-cutting*: nobody researched the product, the users, the regulatory
perimeter beyond ФЗ-152, the money, the people, or the accessibility obligations. Seven
documents describe seven products and no one describes **one** product. That, not any
individual technology choice, is the leading cause-of-failure candidate.

---

## 1. The hole where document 02 should be

There is no `02-*.md`. `01-sozd-data-sources.md` refers to "the stack research (doc 02)"
in a decision rationale, and task #2 in the tracker ("Research: stack") is still `pending`
while task #5 ("Scaffold monorepo") is `in_progress`. So the scaffold was built ahead of a
research stream that was never delivered.

Judging by what the other six documents do **not** cover, doc 02 was carrying:

- Frontend architecture. `Next.js` appears 6 times in `03`, 6 in `07`, 2 in `08`, **0 times
  in the other five documents.** There is no research on router choice, SSR under a ГОСТ TLS
  terminator, state management, form handling, the component library (and its licence), the
  design system, print styles, or the Next.js↔NestJS↔Mastra call topology from the browser's
  point of view.
- Product and user research. Who is the user — депутат, помощник, аппарат фракции, аппарат
  комитета? What do they do today (Word + email + СОЗД + КонсультантПлюс), and what is the
  migration path off it? None of the seven documents contains a single user workflow.
- Testing and CI/CD strategy as a whole (see §6.7).
- The MVP definition. `MVP` appears in three documents, each time meaning a different scope.

**Do not proceed to feature work without writing 02.** It is not optional polish; four of
the "must resolve" items below cannot be answered without it.

---

## 2. Cross-stream contradictions

### C1 — Where do consolidated (in-force) texts come from? Two documents give incompatible answers. **(blocking)**

- `01` decides: *"Use RusLawOD for development only. Build the production corpus
  independently from publication.pravo.gov.ru,"* and sequences `pravo-api` **first** as
  "the fastest path to a working vertical slice."
- `05` verifies the opposite constraint: *"Official pravo.gov.ru publishes acts as TIFF/PDF
  without a text layer,"* and *"RusLawOD contains only first versions of acts (as were
  initially signed),"* concluding that consolidated texts exist de facto only inside
  КонсультантПлюс/Гарант.
- `04` independently names this the single largest quality lever in the system.

So `01`'s "fastest vertical slice" produces a corpus of **amending acts and first
redactions** — a corpus that cannot answer «что действует сегодня», which is the only
question a drafting copilot exists to answer. Two of three streams flagged this as their
top risk; the ingest stream, which owns the fix, did not flag it at all.

Unresolved sub-question nobody chased: **ИПС «Законодательство России»** (the
`pravo.gov.ru` subsystem that RusLawOD derives from) does present редакции to human users.
`01` §5 mentions the ИПС but never asks whether current редакции are retrievable
programmatically. That single question may be worth more than the rest of the ingest
research combined.

### C2 — `01` still specifies TypeDB as the graph store

`01` §12.2 is titled «Граф знаний (TypeDB)» and the schema sketch assumes it. `05` then
rejects TypeDB decisively and with good evidence (no 3.x gRPC Node driver; the only TS path
is a ~12-month-old HTTP wrapper with no pooling, no streaming, `Attribute.value: any`,
errors-as-values). `01` was never amended. Anyone implementing from `01` in isolation will
build the rejected thing.

### C3 — Qdrant version skew between research and infrastructure

`04` verified Qdrant capabilities against **v1.19.0**; `infra/docker-compose.yml` pins
`qdrant/qdrant:v1.16.1`. The BM25 sparse-vector surface (`modifier: "idf"`, the `language`
/ `stemmer` / `stopwords` embedder parameters) and Query-API `prefetch[]` fusion semantics
are exactly the kind of thing that moved across those minor versions. Every "VERIFIED"
capability in `04` §4 is verified against a server we are not running.

### C4 — Foreign egress is forbidden in two documents and designed-in by two others **(blocking)**

- `07` §3.4: no foreign processor may touch ПДн; the self-hosted LLM endpoint "must stay the
  default"; backups stay in РФ.
- `08` B.6.3 rule 1: *"Production runtime has no egress to github.com, npmjs.com,
  huggingface.co, registry.modelcontextprotocol.io."*

Against that:

- `00-network-access-notes.md` promotes **`r.jina.ai`** (a foreign SaaS reader proxy) to a
  first-class interchangeable transport, and `.env.example` ships `JINA_API_KEY` /
  `INGEST_USE_JINA`. Every page fetched that way is visible to a foreign third party, and
  in an аттестованный контур an outbound dependency on a foreign host is not a config flag,
  it is a finding.
- `08` B.7 designs Doomatel as an MCP server whose stated consumers are **Claude Desktop,
  ChatGPT, Cursor** — i.e. deliberate export of Duma working data to foreign model hosts,
  by a document that on the previous page bans egress to `github.com`. Those services are
  also not practically available to RF government users at all, so the design targets a
  client that cannot exist here.

### C5 — The collaboration service is described two different ways

`06` specifies Hocuspocus 4.6.0 (crossws/`ws`) as `apps/collab`, with a complete
`onAuthenticate` → Supabase JWKS → per-document ACL design. `07` summarises the same
component as *"socket.io still wins for the collaborative editor"* (Hocuspocus does not use
socket.io) and then lists *"Auth story for the apps/collab Yjs service … Not designed in
this pass"* as an open question — a question `06` had already answered. Two owners, no
handshake.

### C6 — RLS helper doctrine vs. the RLS code already merged

`07` mandates `LANGUAGE plpgsql + SECURITY DEFINER + STABLE + SET search_path = ''` for
every helper, on the stated ground that a `LANGUAGE sql` helper "can be INLINED by the
planner, which destroys the DEFINER boundary."

`packages/db/migrations/0001_rls.sql` ships `public.user_organization_ids`,
`public.is_organization_member`, `public.is_workgroup_member`,
`public.is_conversation_participant` as **`LANGUAGE sql` `SECURITY DEFINER`
`SET search_path = public, pg_temp`**, in the **`public`** schema, not `app`.

Two problems, in opposite directions:

1. The code contradicts the doctrine and nobody noticed.
2. **The doctrine itself is probably wrong as stated.** PostgreSQL's `inline_function()`
   declines to inline a function when `prosecdef` is true *or* when the function carries a
   `SET` clause (`proconfig`). If that is correct, every one of those helpers is already
   non-inlinable twice over, and the plpgsql mandate is cargo cult. This must be settled by
   a five-minute `EXPLAIN` experiment, not by doctrine, because "rewrite all helpers in
   plpgsql" is a real cost and a real regression risk.

Related, and genuinely wrong regardless: `SET search_path = public, pg_temp` inside a
`SECURITY DEFINER` function is weaker than `SET search_path = ''` with schema-qualified
names, and putting the helpers in `public` makes them PostgREST RPC endpoints the moment
PostgREST is exposed. `07` R12's `assert_self()` guard — needed because every helper takes
an explicit `p_user uuid DEFAULT …`, so any authenticated caller can probe another user's
role — **is not implemented anywhere.**

### C7 — Three overlapping data models for the same entities

| Stream | Model |
|---|---|
| `01` §12 | `bill` / `bill_event` / `document` / `act` (eo_number) / `chunk` (struct_path, simhash) |
| `04` §5.3 | `LegalChunk` — `act_id` / `redaction_id` / `path_ltree` / bitemporal / `covers` / `char_offset_*` |
| `05` §4.3 | `act` / `expression` / `unit` / `legal_edge` / **`unit_closure`** / `daterange` EXCLUDE |

`packages/db/src/schema/` has already silently picked a merge
(`legal_work` / `legal_expression` / `legal_unit` / `legal_edge` / `chunk` + the `01`
bill/act tables) **without an ADR**, and in doing so dropped `05`'s `unit_closure` — the
table that `05`'s own performance argument for containment queries rests on. Nobody owns
the merged model, so nobody will notice the next thing that gets dropped.

### C8 — RusLawOD is characterised inconsistently

`01` presents it as the best corpus bootstrap (304 382 acts, CoNLL-U morphosyntax) and
recommends it for retriever training and evaluation, without mentioning the first-versions-
only limitation that `05` verified. An eval set built on first-version texts will
systematically mis-measure retrieval over consolidated law — which is the corpus we will
actually serve.

### C9 — Agent memory sits outside the whole RLS model

`03` recommends pgvector-in-Supabase for Mastra semantic recall and notes that Mastra tables
do not use RLS (isolation via `schemaName` + role grants). `07` builds the entire
confidentiality story on RLS and on one function (`app.visible_project_ids()`) being the
single source of visibility truth. Conversation history — which contains chat content,
стенограммы fragments, ФИО, and draft text — therefore lives in the one store that the
safety model does not cover. Neither document reconciles this.

### C10 — The "one function drives Postgres and Qdrant" guarantee is already broken

`07`'s central defence against cross-party leakage (R3) is that the Qdrant tenant filter is
derived from **the same** `app.visible_project_ids()` that RLS uses. The implemented policy
uses `public.can_read_project(project_id)` and `public.current_user_id()`; no
`visible_project_ids` array function exists; `packages/retrieval/src/filters/dsl.ts` was
written before either. The invariant is stated in prose and enforced nowhere.

### C11 — Research decisions are not propagating into the scaffold

Symptomatic drift, all currently in the repo:
`ASR_MODEL=gigaam-v2-rnnt` (`08` recommends `v3_e2e_rnnt`);
`SUPABASE_JWT_SECRET` still present in `.env.example` (`07` says delete it for every
service except GoTrue); `EMBEDDINGS_BASE_URL` is OpenAI-compatible while `RERANKER_URL` is a
bespoke `/rerank` and `04` recommends a Python sidecar — three shapes, no interface
contract; `POSTGRES_INITDB_ARGS: --locale=ru_RU.UTF-8` in the standalone compose profile
while `supabase/postgres` initialises differently, so Cyrillic `ORDER BY`, `ILIKE` and
unique-index behaviour differ between dev and prod.

---

## 3. Unverified claims presented as fact

The `[V]` / `VERIFIED` tagging is disciplined but overloaded: across all documents it means
**"found in a source I read"**, not **"observed working."** For `01` in particular the two
are very far apart, because no primary host was reachable.

| # | Claim | Actual status |
|---|---|---|
| U1 | `01`: "Rate limit **VERIFIED** at 50 000 calls/day", "exact request template **VERIFIED**", status codes "**VERIFIED**" | All recovered from third-party mirrors and old scrapers. The same document states api.duma.gov.ru liveness in 2026 is unverified and that every 2025–26 scraper avoids the API. A quota cannot be more verified than the endpoint's existence. |
| U2 | `04`: primary embedder choice | The document honestly reports two contradictory ruMTEB figures for the same model — and the choice is nonetheless already hard-coded into `.env.example`. Confidence stated as "medium"; encoded into config as certainty. |
| U3 | `04`: Qdrant Russian lexical config is solved | **`ё`/`е` folding is not addressed at all.** `ascii_folding` is Latin-only. Russian legal texts mix `ё`/`е` inconsistently, so `утверждённый` vs `утвержденный` will miss on exact-term BM25 — precisely the citation/term-of-art path `04` §4.1 calls non-negotiable. `01` §10.3 raises it as `[INFERRED]`; the retrieval stream never picks it up. Same gap on the Postgres side. |
| U4 | `07`: "`LANGUAGE sql` helpers get inlined, destroying the DEFINER boundary" | Contested — see C6. Load-bearing enough to mandate a rewrite; never tested. |
| U5 | `07`: приказ ФСТЭК № 117 scope and continuous-аттестация claims | Sourced from **one secondary blog** (`securitymedia.org`). This claim drives image-digest pinning, SBOM, OS choice and release cadence. Must be checked against the primary приказ text and with the аттестующая организация. |
| U6 | `07`: ФЗ-152 penalties "6 млн ₽ / 18 млн ₽ on repeat" | Sourced from a `klerk.ru` blog post. The 2024–25 amendment package changed the penalty structure substantially (including turnover-linked fines for leaks and new criminal liability). The cited figure may belong to a different состав than локализация. Needs primary sources and counsel before it appears in any customer-facing risk memo. |
| U7 | `08`: SaluteSpeech fallback architecture | Endpoints, OAuth scopes, format enums and speaker-separation support are explicitly unverified — yet the entire cloud-fallback design depends on them. |
| U8 | `08`: GigaAM is the primary ASR | WER evidence is one blog aggregation plus the vendor's own model card. There is no measurement on *our* audio classes (многочасовое пленарное заседание, ВКС-созвон, диктофон в кабинете). |
| U9 | `05`: "Russia has NO mandatory machine-readable legislation standard" | Absence of evidence from a sandbox that could not reach `.ru` hosts. Should be re-checked from inside РФ before being used to justify inventing RU-ELI. |
| U10 | `01` §8.1's own legal citation | The document corrects «п.5» → «п.6» (correct and valuable) but then renders the target inconsistently as «п.6 пп.1» and «п. 6 **ч. 1** ст. 1259 ГК РФ». Статья 1259 has no части. The correct form is «подпункт 1 пункта 6 статьи 1259 ГК РФ». This is instructed to be copied into the UI. Fix before it propagates. |
| U11 | `06`: ст. 105 / ст. 120 / гл. 13 Регламента ГД | Cited as VERIFIED with no **редакция date**. The Регламент is amended often. Pin the редакция and record it, or the amendment-form validator will silently encode a repealed rule. |
| U12 | `03`: pin exact Mastra versions + "bi-weekly upgrade window with eval runs" | The eval harness that makes this safe does not exist, is not designed, and is not budgeted in any document. |

---

## 4. Decisions with thin or missing rationale

- **`04`: hot/history collection split.** Justified by a "~15 редакций per статья" inflation
  estimate the document itself marks UNVERIFIED. A two-collection design is expensive to
  undo; the measurement must precede the design.
- **`04`: agentic loop caps** (4 sub-queries, 2 retries, 12 Qdrant calls, 30 s wall clock).
  Explicitly "guesses". Fine as defaults, but they are the latency and cost contract of the
  product and nothing else in the corpus constrains them.
- **`07`: BullMQ + Redis over pgmq**, when `pgmq 1.5.1` ships free in the image, `pg_cron` is
  already the scheduler of record, and `07` R11 simultaneously worries about extra
  components in a state contour. The rationale (rate limiting, flows, priorities) is real
  but the counterweight — one fewer stateful service to attest — is never weighed.
- **`07`: MinIO over Supabase Storage** on the basis of upload-size limits, while noting in
  R11 that MinIO's server is AGPL-3.0 and may draw objections. Two competing constraints,
  one of them decided by convenience.
- **`06`: build track changes from scratch** (own estimate: 3–6 weeks for a strong
  ProseMirror engineer, "plus a long tail"). The alternative (buy Tiptap Pro Tracked
  Changes) is rejected on sovereignty grounds — correct — but the cost side of the
  build decision is stated once and never enters any plan.
- **`01`: crawl budgets** (0.5 / 1 / 2 rps per host) are presented as policy, derived from
  "observations in repositories", against `robots.txt` files nobody has read.
- **`03`: Mastra over LangGraph.js.** The reasoning is good, but the decisive risk —
  tool-calling quality on the models we are actually allowed to use — is unmeasured, and
  Mastra's entire multi-agent mechanism *is* tool-calling. The framework decision is
  logically downstream of a benchmark that has not been run.

---

## 5. Mandated coverage audit

### 5.1 Data sovereignty / ФЗ-152 — **good**, with one unbuilt keystone

`07` §3.4 is the strongest section in the corpus: ч.5 ст.18 localisation, the
asynchronous-replica rule, a requirement→implementation table, and the correct
identification that **the LLM boundary, not the database, is the real exposure**.

Missing: the ПДн-redaction NER step that the whole "GigaChat as fallback" design depends on
is marked `[UNVERIFIED — design proposal]` and exists nowhere. Also missing: a data
classification scheme (ПДн / служебная информация / ДСП / открытые данные) — `03` casually
posits "a ДСП-corpus agent" with no classification model behind it — and the collision
between **право на удаление (ФЗ-152)**, an **append-only `doc_update` CRDT log** (`06`),
and an **immutable audit trail** (`07`). Those three requirements are mutually incompatible
as designed and no document notices.

### 5.2 Import substitution / реестр отечественного ПО — **very thin**

«реестр отечественного ПО» appears twice, both times as an open question. «Импортозамещение»
appears zero times. Not mentioned anywhere: ПП РФ № 1236 (запрет на допуск иностранного ПО
для госнужд), ПП РФ № 325 (доп. требования, совместимость с отечественными ОС/СУБД),
Указ № 166, Указ № 250 (в т.ч. ограничения на СЗИ из недружественных стран), and the
question of whether **Doomatel itself must be entered into the реестр to be procurable at
all** — which in turn constrains ownership of exclusive rights, the OS/DBMS compatibility
matrix, and therefore `07`'s R1 fork.

This matters more than `07` allows, because it is not merely a Postgres-vs-Postgres-Pro
question. If registry inclusion is required, the *entire* dependency posture (Supabase
images, MinIO, Qdrant, Redis, LibreOffice, HF weights) has to be justified as bundled OSS
rather than procured foreign software, and the certified СЗИ around it (Kaspersky /
КриптоПро / Astra Linux / Postgres Pro) become priced line items — see §5.7.

### 5.3 ФЗ-187 / КИИ / ГосСОПК — **completely absent** ⚠️ **biggest regulatory blind spot**

Zero occurrences of `КИИ`, `187-ФЗ`, `ГосСОПК`, `категорирование` across 11 484 lines.

Государственная Дума's information infrastructure is a plausible **объект КИИ**. If the
system is значимый (any category), the consequences dwarf everything in `07` §3.5:
категорирование and notification to ФСТЭК, подключение к ГосСОПК with incident reporting
timelines, приказы ФСТЭК № 235/239 requirements, and the Указ № 166 restriction on foreign
software on значимые объекты КИИ. This is a go/no-go question for the architecture, and it
is not in any document. Ask it first, and in writing.

### 5.4 Security threat model — **exists, but only for plugins**

`08` B.6.1 is a genuinely good threat model (T1–T13) for the extension subsystem, with the
best single insight in the corpus: *ignore third-party `allowed-tools` for enforcement*.

What does not exist is a **system-level** threat model. Specifically missing:

- **Формат.** For a state IS the deliverable is a «модель угроз и модель нарушителя»
  following ФСТЭК's «Методика оценки угроз безопасности информации» (2021) against the
  **БДУ ФСТЭК**. Nobody mentions either. An ad-hoc STRIDE table will not be accepted at
  аттестация.
- **Insider threat**, which is the dominant risk here: a помощник with legitimate access
  exfiltrating another фракция's unpublished draft; a departing staffer; screenshot/print
  exfiltration; the аппарат-vs-депутат privilege split. `07`'s RLS work is about
  *authorisation*, not about *misuse of granted authority*. No DLP, no watermarking, no
  anomalous-access detection, no export throttling.
- **Prompt injection from ingested legislative documents** (обращения граждан,
  ведомственные письма, PDFs from СОЗД). `03` names it as a risk; `08` handles it only for
  skill text. The ingest path is the higher-volume vector and has no defence designed.
- **Secrets and key management.** `.env.example` ships `INTERNAL_SERVICE_SECRET=change-me`.
  There is no KMS/Vault design, no key rotation, no service-role key custody model, no
  design for the ГОСТ crypto material `07` assumes at the ingress.
- **Supply chain for our own code.** `08` protects third-party plugins by digest pinning and
  counter-signature; the application's own npm/pnpm dependency tree, base images and build
  pipeline get no equivalent policy — while `07` R5 says continuous аттестация requires
  exactly that, with an SBOM, "from day one."
- Availability/DoS, incident response, forensic readiness, WORM log retention periods.

### 5.5 LLM provider choice — **mechanically covered, decisionally absent**

`03` §8 is excellent *plumbing*: `OpenAICompatibleConfig`, `DynamicArgument` for GigaChat's
30-minute OAuth token, `MastraModelGateway`, fallback arrays. `.env.example` correctly
defaults to a self-hosted OpenAI-compatible endpoint.

But no document answers **which model, and is it good enough**:

- **No candidate evaluation.** Only GigaChat, YandexGPT and "vLLM + Qwen3-32B" are named.
  Not evaluated, not even mentioned: GigaChat open weights, YandexGPT open-weight releases,
  T-Bank's T-lite/T-pro, Vikhr / ruadapt / Saiga family, or DeepSeek — several of which are
  permissively licensed and Russian-tuned. For a Russian-only legal-drafting workload this
  is the most consequential unexamined choice in the project.
- **Llama is named as a candidate** (`03` §8.2 heading, `.env` comments). Meta's licence is
  not OSI-open and carries an acceptable-use policy; Meta is a designated extremist
  organisation in the Russian Federation. Shipping a Meta-derived model in a product for
  Duma deputies is a political problem before it is a licensing one. Nobody flags it.
- **No capacity or sizing plan.** Concurrent deputies × tokens/request × context length →
  GPU count and VRAM, for the LLM *and* the embedder *and* the reranker *and* GigaAM ASR,
  all of which `04`/`08` place on self-hosted GPUs. Zero numbers anywhere.
- **No generation-quality evaluation.** `04` designs a 200–300 question golden set for
  *retrieval*. There is no eval for the actual product output: законопроект text, поправки,
  пояснительная записка, ФЭО, юридико-техническая правка. A drafting copilot with unmeasured
  drafting quality is the whole risk of the product.
- **The tool-calling benchmark** `03` §12 correctly demands is unowned, unscheduled, and
  gates the framework choice.
- **The fallback contradiction.** `03` recommends `[on-prem vLLM, GigaChat]`; `07` allows
  GigaChat only as a третье лицо under поручение на обработку **and** only if ПДн are
  removed first. So the availability fallback silently changes the compliance posture per
  request, using a redaction step that does not exist.

### 5.6 Accessibility — **zero coverage** ⚠️

`WCAG`, `ГОСТ Р 52872`, `screen reader`, `доступность для инвалидов`: zero hits.
For a state-adjacent web resource in Russia this is not a nice-to-have — **ГОСТ Р 52872-2019**
is the applicable national standard, and a «версия для слабовидящих» is an expectation for
государственные интернет-ресурсы. Beyond compliance:

- The user population skews older; default type size, contrast and density are product
  decisions, not CSS afterthoughts.
- **A ProseMirror document carrying overlapping suggestion marks and widget-decorated
  numbering is genuinely hard to make screen-reader-navigable.** If accessibility is
  retrofitted after the editor is built, it will be rebuilt. This must be designed in `06`'s
  schema now, not later.
- Keyboard-only operation of track changes, comments and the amendment table.

### 5.7 i18n / RU-first — **zero coverage as a topic**, with concrete bugs already latent

`i18n` and `локализация`: zero hits. Everything is implicitly Russian, which is right, but
"RU-first" has hard technical content that nobody assigned:

- **`ё`/`е` folding** in both retrieval paths (see U3) — a live correctness bug.
- **Cyrillic collation**: `ru_RU.UTF-8` (standalone compose) vs whatever `supabase/postgres`
  initialises with. Collation changes require reindexing and silently change `ORDER BY`,
  `ILIKE` and unique-index semantics. Decide once, assert in CI.
- **Legal typography**, which is a formal requirement of the drafting output, not styling:
  «ёлочки», неразрывный пробел before `№` and in `ст. 15`, тире vs дефис, `г.`/`гг.`,
  date formats. Nothing in `06`'s DOCX pipeline enforces it.
- **ГОСТ Р 7.0.97-2016** (оформление документов) is mentioned once, in `06`, and never
  turned into export requirements (поля, шрифт, реквизиты, нумерация страниц).
- Russian plural forms in UI strings; whether an EN surface is ever needed (international
  delegations, публикация) — probably no, but decide explicitly rather than by omission.

### 5.8 Offline / degraded network — **partial (editor only)**

`06` gets Yjs offline semantics for free and mentions it. Nothing else is covered:

- **No degraded-mode design.** What does the product do when Qdrant is down, the LLM cluster
  is saturated, ASR is backed up, or a source host is unreachable? For a legal tool the
  honest answer — "show retrieved статьи, generate nothing" — is already articulated in
  `04` §7 as a citation-validation fallback and should be generalised into a system-wide
  degradation ladder.
- **Mobile/tablet: zero mentions.** Deputies work from заседания, командировки and регионы.
  At minimum, read/review/approve on a phone must be a designed surface — and the
  suspend/resume approval gates in `03`/`06` are precisely the mobile use case.
- Poor-link behaviour for a Yjs websocket and for SSE token streaming through a ГОСТ TLS
  terminator (idle timeouts — `03` notes `chatRoute` has `heartbeatMs`; nobody checked the
  terminator's behaviour).

### 5.9 Cost model — **absent** ⚠️

Across seven documents the only cost numbers are: Tiptap/BlockNote licence prices (correctly
avoided), Temporal's "€2.5–4.5k/mo", Langfuse v3's footprint, and Qdrant's RAM formula.
There is no BOM and no TCO. Missing entirely:

- GPU inventory and cost for LLM + embeddings + reranker + ASR + diarization.
- Storage growth: audio is the dominant term (hours of заседания/созвоны per week × bitrate
  × retention) and nobody has estimated it, even though `07` §6.2 worries about a 50 MB
  upload limit.
- The **certified** components that ФСТЭК compliance forces and that are *not* free:
  Astra Linux SE / RED OS, Postgres Pro Certified, КриптоПро (ГОСТ TLS), Kaspersky /
  Dr.Web ScanEngine, СЗИ от НСД — plus the аттестация engagement itself.
- OCR compute (`01` names it as an unbudgeted risk and it stays unbudgeted).
- Per-deputy or per-фракция unit economics, which the commercial model needs.

### 5.10 Team and operations reality — **absent** ⚠️ **and this is the top project risk**

Nothing in the corpus addresses staffing, timeline, or operations. Consider what the seven
documents jointly commit to building:

1. A geo-restricted multi-source ingest platform with OCR and a fragile HTML scraper.
2. A hybrid RAG system with a Python inference tier and a custom eval harness.
3. A legal knowledge graph with a bespoke Russian citation grammar and resolver.
4. A **consolidation engine** — "git for laws", replaying ChangeSets over original texts —
   which `05` correctly calls both the core value and the largest technical risk.
5. A Google-Docs-class collaborative legal editor with bespoke track changes, structural
   diff, numbering engine, and Word-redline DOCX export.
6. A multi-tenant government SaaS with a non-trivial RLS model and cross-party sharing.
7. A meeting-intelligence platform (ASR + diarization + extraction).
8. A plugin/skill marketplace, an MCP server, and a private registry.

Each of items 3, 4, 5 and 7 is a product. As scoped this is a multi-year programme for a
team of 20+, requiring a rare skills mix: ProseMirror/CRDT specialist, Postgres/RLS
specialist, Russian NLP/ML engineer, DevSecOps able to work inside an аттестованный контур,
and a практикующий юрист-эксперт по юридической технике embedded full-time. Nothing in the
corpus says who does this or in what order beyond per-document build orders that were
written independently and do not compose.

Also missing on the ops side: environments (dev / stage / attested prod), backup and DR with
stated RPO/RTO (`резервное копирование` appears zero times as a design topic), on-call and
runbooks, and — the sharp one — **how continuous аттестация interacts with CI/CD.** If
`07` R5 is right that аттестация is against a fixed, digest-pinned configuration, then the
release process is a compliance artefact, and `03`'s "bi-weekly Mastra upgrade window"
is not obviously compatible with it. Nobody has drawn that line.

---

## 6. Recommendations that would be serious mistakes in this context

**M1. `08` B.7 — exposing Doomatel as an MCP server for Claude Desktop / ChatGPT / Cursor.**
Direct export of Duma working documents and ПДн to foreign model hosts; contradicts `07`
§3.4 and `08`'s own B.6.3; targets clients unavailable to RF government users. Keep the MCP
server, restrict it to first-party and on-prem clients, and delete the foreign-client
framing.

**M2. `r.jina.ai` as a production ingest transport.** Acceptable as a research crutch from
this sandbox; unacceptable in an attested contour. Gate it behind `NODE_ENV !== 'production'`
and remove the key from the production config template.

**M3. Mirroring third-party plugin marketplaces** (`08` B.3.7 "well-known repos worth
mirroring"). This pulls the largest attack surface in the design (prompt injection, T2/T3/T9)
into a government product for near-zero user value, and `08` itself flags a licence blocker
on `anthropics/skills` document skills. `08`'s own Tier-0/1 model already implies the right
answer: **first-party curated skills only in v1; no third-party catalogue at all.**

**M4. Deferring the Supabase-vs-Postgres-Pro decision** (`07` R1) "until before the schema
hardens." The schema has hardened: migrations `0000`–`0003` exist, they use `auth.uid()`,
Supabase role names, and the Supabase auth-schema FK. Every additional week of Supabase-
specific SQL raises the cost of an answer that only the аттестующая организация and the
customer can give. Ask now; if the answer is Postgres Pro + no GoTrue/Realtime, roughly half
of `07` is void and better voided at 2 000 lines than at 20 000.

**M5. GigaChat as the automatic availability fallback for the primary model.** It silently
changes the ПДн posture per request and depends on an unbuilt redaction step. Until
redaction exists and a поручение на обработку is signed, the fallback must be a *degraded
mode* (retrieval only, no generation), not a different processor.

**M6. Shipping generative drafting with no generation eval and no accountability model.**
There is no measurement of output quality on the real task, no disclosure requirement, no
defined human sign-off record beyond the editor's suggestion layer, and no answer to "an
AI-drafted formulation entered a federal law and it was wrong — who is accountable and what
does the audit trail show?" `04`'s cite-or-abstain and `08`'s verbatim-quote rule are
excellent primitives; they are not an accountability model.

**M7. Trusting the verbatim-quote guard on ASR output.** `08` requires every extracted
поручение to carry an `evidenceQuote` verified as a literal substring of the transcript.
That proves the model did not invent the quote; it does **not** prove the deputy said it,
because the transcript itself may be misrecognised at ~8–9% WER. For anything attributed to
a named person, the guard must also require an audio offset and a human listening to it.
Presenting substring-verification as protection against misattribution is false assurance.

**M8. Building bespoke track changes, a bespoke citation parser, a bespoke consolidation
engine and a bespoke plugin marketplace in the same v1.** Any two of these is an ambitious
year. All four is how this project fails.

**M9. `INTERNAL_SERVICE_SECRET=change-me` and unmanaged service-role keys** in a system
targeting К1/К2. Secrets management must be designed before the third service exists, not
after.

**M10. Hardcoding convocation 8 anywhere.** `01` flags it; it deserves elevation from a
technical footnote to a programme fact: **elections to the 9th convocation are in
September 2026 — weeks from now.** Every deputy account, фракция mapping, committee
membership and bill numbering assumption turns over at once, and the customer base is
replaced. This is simultaneously a data-model risk and the single most important
go-to-market fact in the corpus, and it is discussed only as a parser edge case.

---

## 7. Topics nobody owns

1. **КИИ / ФЗ-187 / ГосСОПК / категорирование** (§5.3).
2. **Product and user research**; the аппарат-vs-депутат model; today's workflow and the
   migration off Word + email + СОЗД + КонсультантПлюс.
3. **Frontend architecture and design system** (the doc-02 hole).
4. **Accessibility** (§5.6) and **RU typography/i18n** (§5.7).
5. **Cost model / BOM / TCO** (§5.9), including priced certified СЗИ.
6. **Team, timeline, MVP scope, ops, DR/RPO/RTO, release process under аттестация** (§5.10).
7. **Data lifecycle and archival law**: ФЗ-125 «Об архивном деле» for законотворческая
   переписка (`07` raises it as an open question and drops it); retention schedules; the
   deletion-vs-immutability conflict (§5.1).
8. **Procurement and commercial route**: 44-ФЗ / 223-ФЗ, реестр отечественного ПО
   registration, who signs, what the licence model is. Mentioned once in passing in `03`.
9. **Legislative-process domain beyond `06`**: the full Регламент ГД lifecycle and сроки,
   заключение Правительства, отзывы субъектов РФ, антикоррупционная экспертиза (ФЗ-172 +
   ПП РФ № 96 перечень коррупциогенных факторов — `packages/legal/src/expertise/
   anticorruption.ts` already exists with **no research document behind it**), and the
   current редакция of the Методические рекомендации по юридико-техническому оформлению.
10. **Evaluation ownership**: three documents demand eval harnesses (retrieval golden set,
    tool-calling benchmark, Mastra upgrade regression) and none assigns them.
11. **Analytics and product telemetry** — what "working" looks like in production.
12. **Prompt injection via ingested legislative documents** (§5.4).

---

## 8. Must resolve before writing more code

Ordered by *cost of being wrong × how early it locks in*.

1. **Consolidated редакции: where do they come from?** (C1) Test whether ИПС
   «Законодательство России» exposes current редакции programmatically; price a
   КонсультантПлюс/Гарант licence; otherwise commit explicitly to building the consolidation
   engine and rescope everything else around it. **Nothing downstream is worth building on a
   corpus of superseded text.**
2. **Regulatory perimeter, in writing from the customer**: is this a ГИС; is it an объект
   КИИ (and of what category); must the product enter the реестр отечественного ПО; does
   ФСТЭК № 117 apply, and at which class. (§5.2, §5.3, `07` R1/R4/R5)
3. **Supabase vs Postgres Pro / Astra Linux** — the direct consequence of item 2 (M4). Decide
   before more Supabase-specific SQL is written.
4. **Verify the sources are reachable and the API is alive, from inside РФ.** api.duma.gov.ru
   liveness, app_token issuance, the four `robots.txt` files, СОЗД behaviour above 1 rps.
   `01`'s entire ingest design is unvalidated until someone runs it from a Russian IP.
   (U1, `01` risks 1–3, 6)
5. **MVP definition and a single build order.** One document that names the first shippable
   slice and explicitly defers everything else — replacing seven independently-written build
   orders that do not compose. (M8, §5.10)
6. **Model strategy**: candidate set (including Russian open-weight models), tool-calling
   benchmark, generation-quality eval on the real drafting task, GPU sizing, and the
   Llama question. Framework choice (`03`) is downstream of this. (§5.5, M5)
7. **One data model, one ADR.** Reconcile `01` §12 / `04` §5.3 / `05` §4.3 with what is
   already in `packages/db`, decide the fate of `unit_closure`, and settle bitemporality and
   `eId`/`wId` stability *before* any content is loaded — retrofitting stable identifiers
   after ingest invalidates every stored reference (`05`'s own warning). (C7)
8. **The visibility invariant, enforced in code**: one function, one name, used by RLS *and*
   by the Qdrant filter; `assert_self()` on every helper taking `p_user`; move helpers to a
   private schema; settle the `LANGUAGE sql` question by experiment; add the CI guard that
   fails when any table lacks RLS. (C6, C10, `07` R3/R12)
9. **System-level модель угроз in the ФСТЭК format** (Методика 2021 + БДУ), covering insider
   threat, ingest-borne prompt injection, secrets/key management, and our own supply chain —
   not just plugins. (§5.4)
10. **ПДн data-flow map and the redaction step.** Where ПДн enter, which stores hold them,
    which model calls can see them, and the actual NER redaction implementation. Then
    reconcile deletion vs. append-only CRDT log vs. immutable audit. (§5.1)
11. **Editor foundation decisions that cannot be retrofitted**: stable block ids / `eId` /
    `wId`, the ProseMirror schema for нормативный текст, accessibility semantics for
    suggestion marks, and one Y.Doc per bill vs per глава (measured on a real codex).
    (§5.6, `06` risks)
12. **Locale, collation and `ё`/`е` policy**, asserted in tests on both the Postgres and
    Qdrant paths, and pinned identically in dev and prod. (C11, U3)
13. **Delete or fence the foreign-egress paths**: Jina in production, the Claude
    Desktop/ChatGPT MCP framing, and the third-party plugin marketplace. (M1, M2, M3)
14. **Fix the ГК РФ citation form** («подпункт 1 пункта 6 статьи 1259») everywhere before it
    reaches the UI, and pin the редакция of every Регламент ГД citation in `06`. (U10, U11)
15. **Write document 02** (frontend + product + testing/CI), and an ops/cost/team document.
16. **A convocation-9 plan**: no hardcoded созыв, a data-migration plan for the September
    2026 turnover, and an explicit product decision about launching into it. (M10)

---

## 9. Can defer

- TypeDB, Neo4j and Apache AGE entirely. `05`'s Postgres-first recommendation is sound;
  build `LegalGraphPort` over recursive CTEs and revisit only if a measured latency budget
  fails. Do not spend another hour on the `@typedb/driver-http` port question.
- miniCOIL / SPLADE learned sparse. Reserve the named vector slot; nothing more.
- Binary quantization. Start at int8 with rescore; measure before optimising RAM.
- The hot/history collection split for редакции — after measuring the real редакция
  distribution (`04`'s own precondition).
- LegalRuleML deontic formalisation. `05` is right that this is a research programme.
- Voiceprint biometrics for speaker naming (`08` already defers it; keep it deferred until
  counsel rules on 152-ФЗ biometrics).
- ЕСИА integration. `07`'s v2 framing is right; reserve `esia_oid` / `snils_hash` and move on.
- Streaming ASR (T-one) and live diarization — batch first.
- The MCP server, the private registry, and any third-party extension mechanism. There is no
  v1 user need that a first-party skill cannot serve.
- Presentations (PPTX) and speech-text generation (`06` §6). Genuinely useful, entirely
  additive, zero architectural coupling.
- pgroonga/rum as a lexical upgrade over Qdrant BM25 — worth revisiting only if measured
  lexical recall blocks the product.
- Publishing our data as RDF/Linked Data under a RU-ELI profile. Keep the URI design; skip
  the triple store.
- Langfuse v3/v4 migration — after the observability requirement is actually exercised;
  just record the dev/prod version gap loudly (`07` R8).
- OpenSearch/Elasticsearch. Correctly rejected for v1; leave rejected.
