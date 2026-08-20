# 04 — Retrieval Architecture for the Doomatel Russian Legal Corpus

**Scope:** semantic + agentic search over законы, законопроекты (СОЗД), сопроводительные документы
(пояснительная записка, финансово-экономическое обоснование, заключения, отзывы, таблицы поправок).

**Assumed scale:** 10^5–10^6 documents, ~10^7 chunks, multi-tenant filtering (фракция / комитет / рабочий проект),
frequent incremental upserts (СОЗД updates daily; редакции of laws update continuously).

**Legend:**
- `VERIFIED` — read directly from vendor docs / model card / config.json / package registry, URL cited.
- `UNVERIFIED` — inference, extrapolation, or a claim only seen in secondary blog/search summaries. Must be
  re-checked before it becomes load-bearing.

Research date: 2026-08-20.

---

## 0. Executive recommendation (TL;DR)

| Layer | Choice | Confidence |
|---|---|---|
| Vector store | **Qdrant** (self-hosted, single collection, payload multitenancy) | high |
| System of record | **Supabase Postgres** — documents, chunks, редакции, ACL, FTS fallback | high |
| Secondary lexical | **Qdrant BM25 sparse vectors** with Snowball `russian` stemmer + russian stopwords | high |
| Dense embedding (primary) | **`deepvk/USER-bge-m3`** — 1024d, 8192 tok, Apache-2.0 | medium-high |
| Dense embedding (cheap/fast) | **`deepvk/USER2-small`** — 34M params, 384d w/ Matryoshka → 256d, 8192 tok, Apache-2.0 | medium |
| Challenger to A/B | `ai-forever/FRIDA` — 1536d but **512 tok cap** | medium |
| Reranker | **`BAAI/bge-reranker-v2-m3`** — Apache-2.0, XLM-R large cross-encoder, 8192 ctx | high |
| Fusion | **RRF** inside a single Qdrant Query API call (`prefetch[] + {"fusion":"rrf"}`) | high |
| Chunking | Structure-aware по статья/часть/пункт/абзац + parent-document retrieval + contextual prefix | high |
| Agentic patterns to build | Query decomposition → NL→filter-DSL → hybrid retrieve → CRAG-style grading → cite-or-abstain | high |
| Temporal model | Component-level bitemporal редакции (`valid_from/valid_to` + `known_from/known_to`) | high |

**Explicitly rejected:** Milvus (operational weight), pgvector-as-primary (filtered-ANN recall + upsert churn),
`jina-reranker-v2-base-multilingual` (CC-BY-NC-4.0 — non-commercial weights).

---

## 1. Vector store: Qdrant vs Milvus vs pgvector/pgvectorscale

### 1.1 Versions and licenses (VERIFIED)

| Component | Latest version seen | License | Evidence |
|---|---|---|---|
| Qdrant server | `v1.19.0` | Apache-2.0 | `git ls-remote --tags https://github.com/qdrant/qdrant` |
| `@qdrant/js-client-rest` | `1.19.0` | Apache-2.0 | `npm view @qdrant/js-client-rest version` |
| Milvus | `v3.0.0` (also `v2.6.22` line) | Apache-2.0 | `git ls-remote --tags https://github.com/milvus-io/milvus` |
| `@zilliz/milvus2-sdk-node` | `3.0.4` | Apache-2.0 | `npm view` |
| pgvector | `v0.8.6` | PostgreSQL License | `git ls-remote --tags https://github.com/pgvector/pgvector` |
| pgvectorscale | `0.9.0` | **PostgreSQL License** | raw `LICENSE` from `timescale/pgvectorscale@main` — "The PostgreSQL License … TIGER DATA" |

> Note: pgvectorscale used to be widely reported as Timescale License. As of the `main` branch fetched today the
> `LICENSE` file is the plain **PostgreSQL License**, i.e. permissive. (VERIFIED by direct fetch.)

### 1.2 Feature matrix for *this* workload

| Criterion | Qdrant 1.19 | Milvus 2.6/3.0 | pgvector 0.8.6 (+pgvectorscale) |
|---|---|---|---|
| Sparse+dense hybrid in **one** request | **Yes** — Query API `prefetch[]` + `{"fusion":"rrf"}` or `dbsf` (VERIFIED, [hybrid-queries](https://qdrant.tech/documentation/concepts/hybrid-queries)) | Yes — `hybrid_search()` with `RRFRanker`/`WeightedRanker` (UNVERIFIED in this session; not re-checked in docs) | **No** — you hand-write two CTEs + a RRF `ORDER BY` in SQL |
| Built-in BM25 sparse vectors | **Yes** — `sparse_vectors: {name: {modifier: "idf"}}` (VERIFIED, [full-text-search](https://qdrant.tech/documentation/search/text-search/full-text-search/)) | Native BM25 function since 2.5 (UNVERIFIED) | `tsvector` + `ts_rank_cd` — real, mature, Russian-aware |
| **Russian stemming for lexical** | **Yes** — Snowball stemmer, Russian is a supported language; russian stopword list; `phrase_matching` (VERIFIED, [indexing#full-text-index](https://qdrant.tech/documentation/concepts/indexing/)) | Analyzer config exists (UNVERIFIED for Russian quality) | `to_tsvector('russian', …)` — Snowball dictionary, ships with PG |
| Filtering during ANN traversal | **Yes** — filter is applied *inside* HNSW traversal, not post-hoc (UNVERIFIED as a hard perf claim, sourced from [multitenancy article](https://qdrant.tech/articles/multitenancy/) summaries) | Yes (partition/scalar filter) | pgvector 0.8 added **iterative index scan** (`hnsw.iterative_scan`, `hnsw.max_scan_tuples`) to stop filtered queries silently returning too few rows (VERIFIED, [pgvector README](https://github.com/pgvector/pgvector)) |
| Tenant-optimized index | **Yes** — `is_tenant: true` keyword payload index + `hnsw_config: {m: 0, payload_m: 16}` (VERIFIED, [multitenancy](https://qdrant.tech/documentation/manage-data/multitenancy/)) | Partition-key based | Partial indexes per tenant → index explosion |
| Quantization | scalar int8 (`memory: "pinned"`), binary (~32× memory reduction), product; `rescore` + `oversampling` at query time (VERIFIED, [quantization](https://qdrant.tech/documentation/manage-data/quantization/)) | scalar/PQ/binary + GPU index build | pgvector: halfvec (fp16), bit/binary + reranking; pgvectorscale: SBQ in StreamingDiskANN |
| Incremental upsert churn | Designed for it; segment optimizer merges in background | Heavy — needs WAL/message queue | HNSW insert into Postgres is fine but vacuum/bloat on 10^7 rows with high churn is real ops work |
| Operational footprint | **Single Rust binary** + volume. Docker/systemd. | etcd + object storage (MinIO/S3) + message queue (Pulsar/Kafka) + multiple node roles (UNVERIFIED for 3.0 — Milvus "Lite"/standalone reduces this) | Zero extra infra *if* already on Postgres |
| Self-hosting in RF (no foreign SaaS) | Trivial — OSS image, air-gappable | Possible but heavy | Trivial |
| Collection limit gotcha | Qdrant Cloud default max **1000 collections/cluster** → do **not** do collection-per-tenant (VERIFIED, multitenancy doc) | — | — |

### 1.3 Sizing math (VERIFIED formulas from Qdrant docs)

Qdrant's own RAM estimate for full-precision vectors ([vertical-scaling](https://qdrant.tech/documentation/scaling/vertical-scaling)):

```
RAM ≈ num_vectors * dimensions * 4 bytes * 1.5
```

For our target (10^7 chunks × 1024d, USER-bge-m3):

```
fp32:      10_000_000 * 1024 * 4  * 1.5  = 61.4 GB     ← too much for a modest box
int8 SQ:   10_000_000 * 1024 * 1  * 1.5  = 15.4 GB     ← recommended, with rescore=true
binary BQ: 10_000_000 * 1024 / 8  * 1.5  =  1.9 GB     ← + oversampling 2–4× and rescore from disk
```

**Recommendation:** start with **scalar int8 quantization + `rescore: true`**, keep original vectors `on_disk: true`.
If RAM pressure appears, move to binary quantization with `oversampling: 3.0, rescore: true` and measure
nDCG@10 drop on the in-domain eval set. Binary quantization on 1024d Russian legal text is **UNVERIFIED** for quality —
must be measured, not assumed.

### 1.4 Recommendation

**Use Qdrant as the primary retrieval engine. Use Supabase Postgres as the system of record.**

Rationale:
1. **Hybrid in one round-trip.** Qdrant expresses dense + BM25-sparse + RRF as a single `POST /points/query`.
   With pgvector you build and maintain that fusion by hand in SQL; with Milvus you pay a large ops bill for
   roughly the same capability.
2. **Russian lexical is first-class.** Snowball `russian` stemmer and russian stopwords are configurable both on
   the full-text payload index *and* on the BM25 sparse embedder (VERIFIED). This is the single most important
   Russian-specific feature and it removes the need for a separate OpenSearch cluster.
3. **Multitenancy matches our shape.** `фракция` / `комитет` / `project_id` map onto `is_tenant` keyword payload
   indexes; `m: 0 + payload_m: 16` gives per-tenant HNSW graphs instead of one wasteful global graph (VERIFIED).
4. **Milvus is over-provisioned for 10^7 vectors.** Its advantage is billion-scale + GPU index build. We are two
   orders of magnitude below that, and every extra moving part (etcd, MinIO, Pulsar) is an extra thing to run
   inside a Russian data centre with no vendor support.
5. **pgvector is not rejected — it is demoted.** Keep pgvector enabled in Supabase (it ships enabled by default,
   VERIFIED via [Supabase pgvector docs](https://supabase.com/docs/guides/database/extensions/pgvector)) and use it for:
   small, strongly-ACL'd per-deputy collections; "similar to this paragraph I just typed" inside the editor;
   and as a disaster-recovery re-index target. **pgvectorscale is NOT available on Supabase managed Postgres**
   (UNVERIFIED — not documented as supported; assume unavailable), so the StreamingDiskANN upside is not
   reachable without self-hosting Postgres, which defeats the point of picking Supabase.

**Deployment sketch:** Qdrant single node, 3 replicas only when SLA demands it. Collections:

- `legal_chunks` — the big one (10^7). Named vectors: `dense` (1024d, Cosine), `bm25` (sparse, `modifier: idf`).
- `bill_docs` — СОЗД attachment chunks, same schema, separate collection so ingestion churn does not
  fragment the statute collection.
- `drafts` — deputy working drafts, small, high write rate, per-user tenancy.

---

## 2. Russian-language embedding models

### 2.1 Verified specs

All rows below: dims/layers from `config.json`, seq length from `sentence_bert_config.json` or model card,
license from HF card metadata. Fetched 2026-08-20.

| Model | Params | Dim | Max tokens | License | Arch | Notes |
|---|---|---|---|---|---|---|
| `deepvk/USER-bge-m3` | 0.4B | **1024** | **8192** (VERIFIED via `sentence_bert_config.json: {"max_seq_length": 8192}`) | **Apache-2.0** | XLM-R, 24 layers, vocab **46 166** (shrunk from 250 002) | Init from `TatonkaHF/bge-m3_en_ru`. **No prefixes needed.** **Dense only** — the HF repo has no `sparse_linear.pt` / `colbert_linear.pt` |
| `BAAI/bge-m3` | ~0.57B | 1024 | 8192 | **MIT** | XLM-R, vocab 250 002 | Has `sparse_linear.pt` + `colbert_linear.pt` + **`onnx/model.onnx`** (VERIFIED via HF file listing) → the only one of these with learned sparse + ColBERT heads |
| `ai-forever/FRIDA` | 0.8B | **1536** (`d_model: 1536`) | **512** | **MIT** | `T5EncoderModel`, 24 layers, gated-gelu | **CLS pooling.** Mandatory prefixes: `search_query: `, `search_document: `, `paraphrase: `, `categorize: `, `categorize_sentiment: `, `categorize_topic: `, `categorize_entailment: ` |
| `deepvk/USER2-base` | 149M | 768 | **8192** | Apache-2.0 | RuModernBERT | **Matryoshka**: [32,64,128,256,384,512,768]. Prefixes: `search_query:`/`search_document:`/`clustering:`/`classification:` |
| `deepvk/USER2-small` | **34M** | **384** | **8192** | Apache-2.0 | RuModernBERT (`modernbert`, 12 layers) | VERIFIED via `config.json` (`hidden_size: 384`) + `sentence_bert_config.json` (`max_seq_length: 8192`). MRL supported |
| `sergeyzh/BERTA` | 0.1B | 768 | 512 | **MIT** | BERT 12L, from `cointegrated/LaBSE-en-ru` | **Distillation of FRIDA** (1536→768). Same prefix vocabulary as FRIDA |
| `intfloat/multilingual-e5-large-instruct` | 0.56B | 1024 | **512** (`max_position_embeddings: 514`) | MIT | XLM-R large | Needs `Instruct: …\nQuery: …` format |
| `sergeyzh/rubert-tiny-turbo` | ~29M | **312** | 2048 | MIT | BERT, **3 layers** | Extremely cheap; quality far below the others |
| `Qwen/Qwen3-Embedding-0.6B` | 0.6B | 1024 (MRL 32–1024) | **32768** | Apache-2.0 | Qwen3 causal LM, 28 layers | Instruction-aware; +1–5% with instructions per card |

### 2.2 Benchmark evidence (and its contradictions)

- `deepvk/USER-bge-m3` card reports **ruMTEB average 0.706 over 30 datasets** vs `BAAI/bge-m3` **0.689**;
  Retrieval avg **0.934** vs bge-m3's **0.945**; STS **0.753** vs **0.735**; PairClassification **0.833** vs **0.784**.
  (VERIFIED, [model card](https://huggingface.co/deepvk/USER-bge-m3))
- `deepvk/USER2-base` card reports **MTEB-rus mean 61.12**, and lists **USER-bge-m3 at 62.80**,
  `multilingual-e5-large-instruct` at **65.00**, `jina-embeddings-v3` at **63.45**. On **MLDR-rus** long-context
  retrieval nDCG@10: USER-bge-m3 **58.53** > USER2-base **54.17** > jina-v3 **49.67**.
  (VERIFIED, [model card](https://huggingface.co/deepvk/USER2-base))
- `sergeyzh/BERTA` card reports **ruMTEB average 0.693**, STS 0.822, retrieval nDCG@10 0.763.
  (VERIFIED, [model card](https://huggingface.co/sergeyzh/BERTA))
- `ai-forever/FRIDA` card claims **top-1 among models ≤3B params on ruMTEB as of 11.08.26** but publishes **no
  score table** — it defers to the [MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard) and
  [rusBEIR](https://huggingface.co/spaces/kaengreg/rusBEIR). (VERIFIED that the claim exists; the number is UNVERIFIED.)
- GigaEmbeddings reported **69.1** on ruMTEB, top position as of Dec 2024 ([arXiv 2510.22369](https://arxiv.org/pdf/2510.22369)) —
  but licensing/self-host availability is **UNVERIFIED** and it is a Sber-internal-leaning artefact.

> ⚠️ **The two cards disagree** (0.706 vs 62.80 for the same model). They are different ruMTEB/MTEB-rus revisions
> with different dataset counts. **Do not treat any of these as decisive.** Build an in-domain eval set
> (§9) before freezing the choice.

### 2.3 Recommendation

**Primary: `deepvk/USER-bge-m3` (1024d, 8192 tokens, Apache-2.0).**

Why, for *legal* Russian specifically:
- **8192-token context is the deciding factor.** A structure-aware chunk = целая статья + contextual prefix +
  citation header routinely exceeds 512 tokens. FRIDA (512) and `multilingual-e5-large-instruct` (514) would
  force us to shred статьи below their natural boundary, destroying exactly the structure we want to preserve.
- Best MLDR-rus long-document retrieval score of the Russian-specialised family (58.53).
- Apache-2.0, no prefix ceremony, shrunk vocabulary (46k vs 250k) → smaller embedding matrix, faster load.
- Its ancestor `BAAI/bge-m3` gives us a drop-in escape hatch with identical dim (1024) and identical max length,
  so the collection schema does not change if we switch.

**Cheap/fast tier: `deepvk/USER2-small` (34M, 8192 tok, Matryoshka).**
Use for: real-time "похожие формулировки" while the deputy types, dedup of поправки, first-pass candidate
generation over 10^7 chunks when latency budget is <30 ms, and clustering of отзывы регионов.
Its native dim is 384; truncate the MRL embedding to **256d** for the fast index. If USER2-small's quality is unacceptable,
fall back to `sergeyzh/BERTA` (768d, MIT, FRIDA-distilled, ruMTEB 0.693) which is stronger but 512-token capped —
acceptable for short-form fast-path work.

**Challenger to A/B, not to ship blind: `ai-forever/FRIDA`.** 1536d, MIT, claimed ruMTEB leader ≤3B.
If our eval shows it wins by >3 nDCG@10 points on ≤512-token chunks, consider a **two-collection** design:
FRIDA over abzats-level chunks, USER-bge-m3 over article-level chunks, fused by RRF.

**Do not use** `Qwen3-Embedding-*` as primary. 32k context is attractive and the license is fine, but it is a
decoder-based LM (0.6B/4B/8B) — inference cost per chunk is materially higher and there is **no ruMTEB evidence**
in what we verified. `rubert-tiny-turbo` (312d, 3 layers) is too weak for legal nuance; keep it only for
cheap near-duplicate detection.

**Operational note:** serve embeddings via a dedicated Python inference sidecar (vLLM / Infinity / TEI) behind a
NestJS-facing HTTP contract, **not** in-process in Node. `onnxruntime-node@1.27.0` + the `onnx/model.onnx`
shipped in `BAAI/bge-m3` is a viable pure-TS path if a Python service is politically unacceptable
(VERIFIED that the ONNX file exists in the bge-m3 repo; VERIFIED `onnxruntime-node` 1.27.0 on npm).
`fastembed@2.1.0` exists on npm as another TS option (VERIFIED version only; Russian model coverage UNVERIFIED).

---

## 3. Rerankers for Russian

| Model | Arch | Ctx | License | Verdict |
|---|---|---|---|---|
| **`BAAI/bge-reranker-v2-m3`** | `XLMRobertaForSequenceClassification`, `_name_or_path: BAAI/bge-m3`, hidden 1024, `max_position_embeddings: 8194` (VERIFIED from `config.json`) | ~8192 | **apache-2.0** (VERIFIED via HF API `cardData.license`; 18.6M downloads) | **Ship this.** |
| `jina-reranker-v2-base-multilingual` | XLM-R cross-encoder | 1024 | **CC-BY-NC-4.0** — weights are non-commercial; production use needs Jina's hosted API or a commercial licence (UNVERIFIED, from search summary) | **Reject.** Non-commercial licence is disqualifying for a paid government product, and the hosted API is a foreign SaaS dependency. |
| `bge-reranker-v2-gemma` / LLM rerankers | decoder LLM | large | varies | Too slow for top-100 reranking at our QPS. |
| Mastra `rerank()` (LLM-as-judge) | `@mastra/rag@2.6.0`, weighted blend of `semantic`/`vector`/`position` (VERIFIED, [reference/rag/rerank](https://mastra.ai/reference/rag/rerank)) | — | — | Useful as a *secondary* agentic re-rank on the final 10, not as the primary top-100 reranker (an LLM call per candidate is unaffordable). |

Reported Russian cross-lingual reranking: `bge-reranker-v2-m3` **68.06 (RU)** vs `jina-reranker-v3` **67.35 (RU)**
— **UNVERIFIED**, from a search-result summary, benchmark unnamed. Treat as "roughly equal", and let the licence decide.

### Recommendation
`BAAI/bge-reranker-v2-m3`, fp16, batch 32, on the **top-100 fused candidates → top-8**.
Same tokenizer family as `USER-bge-m3` (XLM-R), so the tokenization of Russian legal text is consistent
across retrieve and rerank. Its 8192 context means we can feed **the parent статья**, not just the chunk,
to the reranker — a large practical win for legal relevance.

Consider fine-tuning it later on (запрос, статья) pairs mined from real deputy queries; a cross-encoder
fine-tune needs only ~5–10k labelled pairs and typically beats a bigger off-the-shelf model in-domain (UNVERIFIED,
general practice).

---

## 4. Sparse / lexical retrieval over Russian

### 4.1 Why lexical is non-negotiable here

Legal queries are frequently **exact-token** queries that dense retrieval handles badly:
- citations: `149-ФЗ`, `ст. 15.1`, `ч. 2 ст. 12`, `п. 3 ч. 1 ст. 30`
- СОЗД bill numbers: `123456-8` (номер-созыв)
- fixed legal terms of art: `юридическое лицо`, `нормативный правовой акт`, `в редакции`, `утратил силу`
- named entities: `Роскомнадзор`, `Правительство Российской Федерации`

A dense-only system will silently return "similar-sounding" статьи for `ст. 15.1` — the worst failure mode
for a legislative drafting tool.

### 4.2 Options evaluated

**(a) Qdrant BM25 sparse vectors — RECOMMENDED.**
VERIFIED capabilities ([full-text-search](https://qdrant.tech/documentation/search/text-search/full-text-search/),
[indexing](https://qdrant.tech/documentation/concepts/indexing/), [edge-bm25](https://qdrant.tech/documentation/edge/edge-bm25/)):
- Collection-side: `sparse_vectors: { "bm25": { "modifier": "idf" } }` — Qdrant computes the IDF term itself
  across the collection, so document frequencies stay correct through incremental upserts.
- Embedder-side parameters: `language` (drives **stemming + stopwords**), `k` (default 1.2), `b` (default 0.75),
  `avg_len` (default 256), `lowercase` (default true), `ascii_folding` (default false), `stemmer`, `stopwords`,
  `tokenizer` (`word` | `whitespace` | `prefix` | `multilingual`), `min_token_len`, `max_token_len`.
- **Snowball stemmer supports Russian** (VERIFIED — the full-text-index docs name English, Spanish and Russian
  among supported languages, backed by `rust-stemmers`).
- ⚠️ **BM25 defaults to English stemming and English stopwords** — you MUST set Russian explicitly (VERIFIED warning
  in the docs). Silently shipping English defaults over a Russian corpus is a realistic and severe bug.
- ⚠️ **Self-hosting caveat (VERIFIED):** Qdrant *Cloud Inference* can build embeddings server-side from raw text
  (`{"query": {"text": …, "model": "Qdrant/bm25"}}`). On a self-hosted instance, **dense** vectors must be computed
  client-side. Qdrant's docs state "Core BM25 functionality can run on any Qdrant instance, but dense Cloud
  Inference is a Cloud-only feature." So: BM25 sparse — fine self-hosted; dense — compute in our own service.

**(b) Postgres `to_tsvector('russian', …)` — RECOMMENDED as the secondary/authoritative lexical index.**
- `'russian'` is a **Snowball** dictionary shipping with PostgreSQL — stemming only, no lemma dictionary.
- Upgrade path: an **Ispell/Hunspell** Russian dictionary (`DictFile`, `AffFile`, `StopWords`) chained *before*
  the Snowball dictionary — Ispell recognises a limited vocabulary and must be followed by a general dictionary
  that accepts everything (VERIFIED, [PostgreSQL textsearch-dictionaries](https://www.postgresql.org/docs/current/textsearch-dictionaries.html)).
  This matters for Russian: Snowball over-stems (`государственный`/`государство` collide) and under-handles
  irregular morphology.
- Use it for: exact-citation lookup, `ILIKE`/regex fallbacks, admin search, and as the ground truth the vector
  store is reconciled against.

**(c) `pymorphy3` / Natasha / mystem — for *offline* normalisation, not the online path.**
VERIFIED on PyPI: `pymorphy3==2.0.6` (MIT), `pymorphy3-dicts-ru==2.4.417150.4580142` (MIT),
`natasha==1.6.0` (MIT), `razdel==0.5.0` (MIT). `mystem` is Yandex's, **non-free for commercial use** —
avoid. Use `razdel` for Russian sentence/token segmentation during chunking and `natasha` NER for
organisation/law-reference extraction into chunk metadata. Do **not** put pymorphy3 in the query hot path;
it is a Python dependency and the latency does not pay for itself once Snowball+BM25+dense+reranker are in place.

TS-side note: `az@0.2.3` (Az.js, a JS port of the pymorphy family) exists on npm (VERIFIED version only;
maintenance status UNVERIFIED — last published long ago). `natural@8.1.1` and `stopword@3.1.5` exist but
their Russian support is weak. **Do not build Russian morphology in Node.**

**(d) OpenSearch/Elasticsearch with `russian` analyzer — REJECTED for v1.**
It works, and its `russian_morphology` plugin is genuinely better than Snowball, but it means a whole extra JVM
cluster to operate, secure, and license-audit inside Russia, duplicating what Qdrant BM25 already gives us.
Revisit only if lexical recall measurably blocks us.

**(e) miniCOIL / SPLADE++ learned sparse — DEFER.**
`Qdrant/minicoil-v1` exists and produces contextual sparse vectors without vocabulary expansion (VERIFIED that
the model and docs exist: [miniCOIL article](https://qdrant.tech/articles/minicoil/),
[fastembed-minicoil](https://qdrant.tech/documentation/fastembed/fastembed-minicoil/)).
**Russian quality is UNVERIFIED** and the model is English-centric as far as we could confirm. Keep the
sparse vector slot in the schema (`"minicoil"`) reserved so we can add it without a re-index.

### 4.3 Recommended hybrid design — exact fusion strategy

Three prefetch branches fused by **RRF**, then cross-encoder rerank, then parent expansion.

```
                     ┌─ prefetch A: dense   (USER-bge-m3, 1024d)   limit 100 ─┐
query ── filter DSL ─┼─ prefetch B: bm25    (sparse, idf, russian) limit 100 ─┼─ RRF ─► top 100
                     └─ prefetch C: citation (exact ФЗ/статья match) limit 50 ┘
                                                                                  │
                                          bge-reranker-v2-m3 over PARENT статья  ◄┘
                                                                                  │
                                                          top 8 → parent expansion → LLM
```

**Why RRF and not weighted score fusion:** BM25 scores and cosine scores live on incomparable scales, and BM25's
scale drifts as the corpus grows (we upsert daily). RRF is rank-based, therefore scale-free and stable under
corpus growth. Qdrant's `dbsf` (Distribution-Based Score Fusion) normalises by score distribution and can beat RRF
when both branches are well-calibrated — **make it a config flag and measure**, do not guess.

RRF: `score(d) = Σ_branches 1 / (k + rank_branch(d))`, Qdrant default `k = 60`
(the `k=60` default is **UNVERIFIED** — Qdrant's docs show `{"rrf": {}}` "with defaults" without stating the
constant; confirm against the running version before tuning).

**Exact Qdrant request (self-hosted, vectors computed by our service):**

```jsonc
// POST /collections/legal_chunks/points/query
{
  "prefetch": [
    {
      "query": [0.013, -0.042, /* … 1024 floats from USER-bge-m3 … */],
      "using": "dense",
      "filter": { "must": [
        { "key": "tenant_id",   "match": { "value": "fraction_er" } },
        { "key": "doc_kind",    "match": { "any": ["law", "code"] } },
        { "key": "valid_from",  "range": { "lte": "2026-08-20T00:00:00Z" } },
        { "key": "valid_to",    "range": { "gt":  "2026-08-20T00:00:00Z" } }
      ]},
      "limit": 100,
      "params": { "quantization": { "rescore": true, "oversampling": 2.0 } }
    },
    {
      "query": { "indices": [1214, 88301, 4412], "values": [2.71, 1.94, 1.20] }, // BM25 sparse, ru-stemmed
      "using": "bm25",
      "filter": { "must": [ /* same filter */ ] },
      "limit": 100
    },
    {
      "query": { "indices": [990211], "values": [1.0] },   // exact citation token "149-фз"
      "using": "bm25",
      "filter": { "must": [ { "key": "act_number", "match": { "value": "149-ФЗ" } } ] },
      "limit": 50
    }
  ],
  "query": { "fusion": "rrf" },
  "limit": 100,
  "with_payload": true
}
```

TypeScript (`@qdrant/js-client-rest@1.19.0`, VERIFIED API shape from Qdrant docs):

```ts
import { QdrantClient } from "@qdrant/js-client-rest";
const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });

const fused = await client.query("legal_chunks", {
  prefetch: [
    { query: denseVec, using: "dense", filter, limit: 100 },
    { query: { indices: sparse.indices, values: sparse.values }, using: "bm25", filter, limit: 100 },
  ],
  query: { fusion: "rrf" },
  limit: 100,
  with_payload: true,
});
```

**Collection creation (multitenant + hybrid + quantized):**

```ts
await client.createCollection("legal_chunks", {
  vectors: { dense: { size: 1024, distance: "Cosine", on_disk: true } },
  sparse_vectors: { bm25: { modifier: "idf" } },
  hnsw_config: { m: 0, payload_m: 16 },            // per-tenant graphs, no global graph (VERIFIED pattern)
  quantization_config: { scalar: { type: "int8", memory: "pinned" } },
  optimizers_config: { default_segment_number: 8 },
});

await client.createPayloadIndex("legal_chunks", {
  field_name: "tenant_id", field_schema: { type: "keyword", is_tenant: true },
});
await client.createPayloadIndex("legal_chunks", {
  field_name: "text",
  field_schema: {
    type: "text",
    tokenizer: "word",
    lowercase: true,
    min_token_len: 2,
    max_token_len: 30,
    stemmer:   { type: "snowball", language: "russian" },   // ⚠️ MUST be set — default is english
    stopwords: { languages: ["russian"], custom: ["статья", "пункт", "часть", "настоящий", "федеральный"] },
    phrase_matching: true,
  },
});
// plus keyword indexes: act_id, act_number, doc_kind, article_no, project_id, committee_id
// plus datetime indexes: valid_from, valid_to, adopted_at
```

⚠️ Mastra note: `@mastra/qdrant@1.1.2`'s `createPayloadIndex` requires re-upserting vectors after adding a new
index for filtering to take effect (VERIFIED, [metadata-filters reference](https://mastra.ai/reference/rag/metadata-filters)).
Create **all** payload indexes before the bulk load.

---

## 5. Chunking strategy for Russian legal texts

### 5.1 The structural hierarchy to respect

```
Кодекс / Федеральный закон
└─ Раздел
   └─ Глава
      └─ Статья N            ← PARENT unit; the citable, versioned atom
         └─ Часть N          (ч. 1, ч. 2 …)
            └─ Пункт N       (п. 1, п. 2 …)  |  Подпункт "а)", "б)"
               └─ Абзац N    ← smallest addressable unit
Примечание / Приложение
```

For законопроекты (СОЗД) the parallel hierarchy is:
```
Законопроект NNNNNN-C (номер-созыв)
├─ Текст законопроекта  (has its own статьи; "Статья 1. Внести в … следующие изменения:")
├─ Пояснительная записка
├─ Финансово-экономическое обоснование
├─ Перечень актов, подлежащих признанию утратившими силу
├─ Заключение Правительства / Счётной палаты / ГПУ
├─ Отзывы субъектов РФ
└─ Таблицы поправок (принятые / отклонённые)  ← highly structured, chunk row-wise
```

### 5.2 Rules

1. **Never split across статья boundaries.** Статья is the citable atom of Russian law — a chunk that spans
   two статьи is uncitable.
2. **Primary chunk = one часть (or one пункт if the статья has no части).** Median size fits comfortably in
   1024 tokens; USER-bge-m3's 8192 cap means even long статьи like ст. 15 ФЗ-149 are safe.
3. **Oversized часть (>1500 tokens):** split at абзац boundaries with a 1-абзац overlap, and set
   `is_partial: true`, `part_index`, `part_total`.
4. **Undersized статья (<80 tokens, e.g. "Статья 4. Утратила силу."):** merge upward with siblings into one
   chunk, but retain a `covers[]` array of all covered citations so citation lookup still resolves.
5. **Parent-document retrieval.** Embed and index the *child* (часть/пункт) for precision; return the *parent*
   (полная статья) to the LLM for context. Store parent text in Postgres, not in the Qdrant payload
   (payload bloat kills filtering throughput).
6. **Contextual retrieval prefix (Anthropic).** Before embedding, prepend an LLM-generated 1–2 sentence
   situating context. Anthropic reports **−35%** retrieval failures from contextual embeddings alone,
   **−49%** with contextual BM25, and **−67%** with reranking added
   (VERIFIED, [Anthropic: Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)).
   For legal text the context should be *deterministic where possible* — do not let an LLM invent structure it
   can read:

   ```
   [Федеральный закон от 27.07.2006 № 149-ФЗ "Об информации, информационных технологиях
    и о защите информации" | Глава 2 | Статья 15.1 | Часть 2 | ред. от 08.08.2024,
    действует с 01.09.2024]
   <LLM-generated 1–2 sentence gloss of what this часть does and what it modifies>

   <original text of ч. 2 ст. 15.1>
   ```

   The bracketed header is generated by **template from the parsed structure** (zero hallucination risk);
   only the gloss line comes from an LLM, and it is stored separately (`context_gloss`) so it can be
   regenerated or audited without touching the source text.
7. **Prepend the same header to the BM25 text** — this is Anthropic's "contextual BM25" and it is what makes
   `149-ФЗ` and `ст. 15.1` lexically findable on every child chunk.
8. **Таблицы поправок:** one chunk per row (номер поправки, автор, текст поправки, решение комитета),
   never chunk by character count.
9. **Never chunk across редакции.** A chunk belongs to exactly one (статья, редакция) pair. See §8.

### 5.3 Concrete chunk schema

**TypeScript (canonical, shared between NestJS ingest and Mastra tools):**

```ts
export type DocKind =
  | "law" | "code" | "constitution" | "decree" | "regulation"   // действующее право
  | "bill" | "bill_explanatory" | "bill_feo" | "bill_conclusion"
  | "bill_review" | "bill_amendments" | "bill_repeal_list"      // СОЗД
  | "draft";                                                     // рабочий черновик депутата

export interface LegalChunk {
  // ── identity ──────────────────────────────────────────────────────────────
  chunk_id: string;              // uuid v5 of (act_id, redaction_id, path, part_index)
  parent_id: string;             // uuid of the статья-level parent document
  act_id: string;                // stable id of the акт, redaction-independent
  redaction_id: string;          // uuid of the (act_id, redaction_no) pair

  // ── provenance ────────────────────────────────────────────────────────────
  doc_kind: DocKind;
  act_number: string | null;     // "149-ФЗ" | "63-ФЗ" | "195-ФЗ"
  act_date: string | null;       // "2006-07-27"
  act_title: string;             // "Об информации, информационных технологиях и о защите информации"
  project_number: string | null; // СОЗД: "123456-8"
  convocation: number | null;    // созыв: 8
  source_url: string | null;
  source_hash: string;           // sha256 of the source file, for dedup + reproducibility

  // ── structural path (this is what makes citations exact) ──────────────────
  razdel_no: string | null;      // "I"
  glava_no: string | null;       // "2"
  article_no: string | null;     // "15.1"   (string! статьи have 15.1, 15.1-1, 12.2)
  part_no: string | null;        // "2"      часть
  point_no: string | null;       // "3"      пункт
  subpoint_no: string | null;    // "а"      подпункт
  abzac_from: number | null;     // 1-based абзац range covered
  abzac_to: number | null;
  path: string;                  // "ст.15.1/ч.2/п.3"  — canonical, sortable, joinable
  path_ltree: string;            // "a15_1.p2.pt3"     — for Postgres ltree ancestor queries
  depth: number;                 // 0=акт 1=статья 2=часть 3=пункт 4=подпункт

  // ── citation (precomputed, never generated by the LLM) ────────────────────
  citation_short: string;        // "ч. 2 ст. 15.1 ФЗ-149"
  citation_full: string;         // "часть 2 статьи 15.1 Федерального закона от 27.07.2006 № 149-ФЗ
                                 //  «Об информации…» (в ред. Федерального закона от 08.08.2024 № 000-ФЗ)"
  covers: string[];              // additional citations this chunk fully contains (merged small статьи)

  // ── temporal (see §8) ─────────────────────────────────────────────────────
  redaction_no: number;          // monotonically increasing per act_id
  valid_from: string;            // ISO8601, вступление в силу этой редакции данной статьи
  valid_to: string;              // ISO8601, "9999-12-31T00:00:00Z" if currently in force
  known_from: string;            // when WE learned of it (transaction time)
  known_to: string;
  status: "in_force" | "repealed" | "not_yet_in_force" | "suspended"; // утратил силу / приостановлен
  amended_by: string[];          // act_ids of the amending laws
  amends: string[];              // act_ids this chunk amends (for законопроекты)

  // ── multitenancy / ACL ────────────────────────────────────────────────────
  tenant_id: string;             // фракция | комитет | "public"
  visibility: "public" | "fraction" | "committee" | "private";
  owner_user_id: string | null;  // for doc_kind === "draft"
  project_id: string | null;     // рабочий проект / законопроектная инициатива

  // ── content ───────────────────────────────────────────────────────────────
  text: string;                  // raw source text of THIS unit, verbatim, no modification
  context_gloss: string | null;  // LLM-generated situating sentence (auditable, regenerable)
  embed_input: string;           // header + gloss + text — exactly what was embedded
  token_count: number;
  char_offset_start: number;     // offsets into the parent document — REQUIRED for span citations
  char_offset_end: number;
  is_partial: boolean;
  part_index: number;            // 0 when not partial
  part_total: number;

  // ── extracted entities (Natasha NER + rule-based) ─────────────────────────
  refs_out: string[];            // outbound citations found in text: ["ФЗ-152/ст.9", "ГК РФ/ст.421"]
  orgs: string[];                // ["Роскомнадзор", "Правительство Российской Федерации"]
  terms: string[];               // defined legal terms used

  // ── embedding bookkeeping ─────────────────────────────────────────────────
  embed_model: string;           // "deepvk/USER-bge-m3"
  embed_model_rev: string;       // HF commit sha — REQUIRED for safe re-index
  embed_dim: number;             // 1024
  indexed_at: string;
}
```

**Postgres DDL sketch (Supabase — system of record):**

```sql
create extension if not exists vector;
create extension if not exists ltree;
create extension if not exists pg_trgm;

create type doc_kind as enum (
  'law','code','constitution','decree','regulation',
  'bill','bill_explanatory','bill_feo','bill_conclusion',
  'bill_review','bill_amendments','bill_repeal_list','draft'
);
create type norm_status as enum ('in_force','repealed','not_yet_in_force','suspended');

-- Акт: identity that survives all редакции (FRBR "Work")
create table acts (
  act_id        uuid primary key default gen_random_uuid(),
  doc_kind      doc_kind not null,
  act_number    text,                -- '149-ФЗ'
  act_date      date,
  act_title     text not null,
  eo_number     text,                -- номер опубликования на pravo.gov.ru
  project_number text,               -- СОЗД '123456-8'
  convocation   smallint,
  created_at    timestamptz not null default now()
);
create unique index acts_number_date_uk on acts (act_number, act_date)
  where act_number is not null;

-- Редакция акта (FRBR "Expression" / Temporal Version)
create table redactions (
  redaction_id  uuid primary key default gen_random_uuid(),
  act_id        uuid not null references acts(act_id) on delete cascade,
  redaction_no  int  not null,
  amended_by    uuid[] not null default '{}',
  valid_from    timestamptz not null,
  valid_to      timestamptz not null default 'infinity',
  known_from    timestamptz not null default now(),
  known_to      timestamptz not null default 'infinity',
  source_url    text,
  source_hash   text not null,
  unique (act_id, redaction_no)
);
create index redactions_pit on redactions using gist (
  act_id, tstzrange(valid_from, valid_to)
);

-- Component-level версионирование: одна статья одной редакции
create table norm_components (
  component_id  uuid primary key default gen_random_uuid(),
  act_id        uuid not null references acts(act_id) on delete cascade,
  redaction_id  uuid not null references redactions(redaction_id) on delete cascade,
  path          text  not null,              -- 'ст.15.1/ч.2/п.3'
  path_ltree    ltree not null,              -- 'a15_1.p2.pt3'
  depth         smallint not null,
  article_no    text,
  citation_short text not null,
  citation_full  text not null,
  status        norm_status not null default 'in_force',
  valid_from    timestamptz not null,
  valid_to      timestamptz not null default 'infinity',
  body          text not null,               -- verbatim
  body_tsv      tsvector generated always as (to_tsvector('russian', body)) stored,
  unique (redaction_id, path)
);
create index nc_ltree_gist  on norm_components using gist (path_ltree);
create index nc_tsv_gin     on norm_components using gin  (body_tsv);
create index nc_trgm        on norm_components using gin  (citation_short gin_trgm_ops);
create index nc_pit         on norm_components using gist (act_id, tstzrange(valid_from, valid_to));

-- Chunks: the retrieval units. Vector lives in Qdrant; this table is the join target.
create table chunks (
  chunk_id      uuid primary key,
  component_id  uuid not null references norm_components(component_id) on delete cascade,
  parent_id     uuid not null references norm_components(component_id),
  tenant_id     text not null,
  visibility    text not null default 'public',
  project_id    uuid,
  owner_user_id uuid,
  text          text not null,
  context_gloss text,
  embed_input   text not null,
  token_count   int  not null,
  char_offset_start int not null,
  char_offset_end   int not null,
  is_partial    boolean not null default false,
  part_index    int not null default 0,
  part_total    int not null default 1,
  refs_out      text[] not null default '{}',
  embed_model   text not null,
  embed_model_rev text not null,
  indexed_at    timestamptz not null default now(),
  text_tsv      tsvector generated always as (to_tsvector('russian', embed_input)) stored
);
create index chunks_tsv_gin    on chunks using gin (text_tsv);
create index chunks_tenant     on chunks (tenant_id, visibility);
create index chunks_component  on chunks (component_id);

-- Point-in-time reconstruction of an entire act as of date D
create or replace function act_as_of(p_act_id uuid, p_at timestamptz)
returns table (path text, citation_short text, body text, status norm_status)
language sql stable as $$
  select nc.path, nc.citation_short, nc.body, nc.status
  from norm_components nc
  where nc.act_id = p_act_id
    and nc.valid_from <= p_at
    and nc.valid_to   >  p_at
  order by nc.path_ltree;
$$;
```

**Qdrant payload = the *filterable* subset only.** Do not mirror `text`/`embed_input`/`citation_full` into the
payload beyond what filters and the reranker snippet need; fetch full bodies from Postgres by `chunk_id`.
Filterable payload keys: `tenant_id`, `visibility`, `project_id`, `owner_user_id`, `doc_kind`, `act_id`,
`act_number`, `article_no`, `path`, `status`, `valid_from`, `valid_to`, `redaction_no`, `convocation`,
`project_number`, plus `text` (indexed as `type: "text"` with the Russian stemmer, for `MatchText`/phrase filters).

---

## 6. Agentic search patterns — what to implement, and in what order

| Pattern | Reference | Value here | Verdict |
|---|---|---|---|
| **Query decomposition** | Agentic RAG survey, [arXiv 2501.09136](https://arxiv.org/abs/2501.09136) | Deputy questions are compound: *"какие законопроекты 8-го созыва меняют ст. 15.1 ФЗ-149 и какие заключения дало Правительство"* → 2–3 sub-retrievals | **Phase 1 — build first** |
| **NL → structured filter DSL** | — | Highest ROI of anything on this list. Turns "поправки нашей фракции за 2025 год" into a Qdrant filter, cutting the candidate set by 100× before ANN runs | **Phase 1 — build first** |
| **CRAG-style relevance grading** | Corrective RAG, [arXiv 2401.15884](https://arxiv.org/abs/2401.15884) | Grade retrieved chunks Correct/Ambiguous/Incorrect; on Incorrect, re-query with a decomposed/relaxed filter instead of answering from junk. **No web-search fallback** — for a government tool the corrective action must be *re-retrieve inside the corpus* or *abstain* | **Phase 1 (grading) / Phase 2 (correction loop)** |
| **Multi-hop / graph traversal** | — | Essential for «какие акты подлежат изменению» — follow `refs_out` edges, then retrieve the referenced статьи. This is where TypeDB earns its place | **Phase 2** |
| **Self-RAG reflection tokens** | Self-RAG, [arXiv 2310.11511](https://arxiv.org/abs/2310.11511) | Requires a fine-tuned model emitting reflection tokens. Approximate the *behaviour* (retrieve-or-not, self-critique) with prompting + a separate critic call | **Approximate, don't implement literally** |
| **HyDE** | [arXiv 2212.10496](https://arxiv.org/abs/2212.10496) | ⚠️ **Actively dangerous here.** HyDE asks an LLM to hallucinate a plausible legal passage, then retrieves against it. In a legal corpus that biases retrieval toward *the law the model thinks exists*. | **Reject for statutes.** Narrow, guarded use only for открытые policy questions over пояснительные записки, behind a flag, never for citation lookup |
| **Query expansion (safe variant)** | — | Instead of HyDE: expand with **corpus-grounded synonyms** — legal-term dictionary, official short titles, and previous formulations of the same статья from earlier редакции | **Phase 1 — this replaces HyDE** |
| **Adaptive routing** | — | Route by query class: `citation_lookup` → lexical-only + exact filter; `semantic_research` → full hybrid; `temporal` → point-in-time filter; `drafting_assist` → draft collection | **Phase 1** |

### 6.1 The filter DSL (implement this first)

Define a Zod schema, expose it to the Mastra agent as a tool input, and compile it to a Qdrant filter server-side.
**Never let the LLM emit raw Qdrant JSON** — it will invent operators and leak across tenants.

```ts
import { z } from "zod";

export const LegalFilter = z.object({
  doc_kind:      z.array(z.enum(["law","code","bill","bill_explanatory","bill_conclusion",
                                 "bill_amendments","bill_review","draft"])).optional(),
  act_number:    z.array(z.string()).optional(),      // ["149-ФЗ"]
  article_no:    z.array(z.string()).optional(),      // ["15.1"]
  path_prefix:   z.string().optional(),               // "ст.15.1"
  convocation:   z.array(z.number().int()).optional(),// [8]
  project_number:z.array(z.string()).optional(),      // ["123456-8"]
  committee_id:  z.array(z.string()).optional(),
  status:        z.array(z.enum(["in_force","repealed","not_yet_in_force","suspended"])).optional(),
  as_of:         z.string().datetime().optional(),    // point-in-time — compiles to valid_from/valid_to
  adopted_after: z.string().datetime().optional(),
  adopted_before:z.string().datetime().optional(),
  mentions_org:  z.array(z.string()).optional(),      // Natasha-extracted
  free_text:     z.string().optional(),               // → MatchText on the ru-stemmed text index
}).strict();

export type LegalFilter = z.infer<typeof LegalFilter>;
```

Compilation is the security boundary: `tenant_id`, `visibility`, and `owner_user_id` clauses are injected by the
**server from the authenticated session**, and are `must` conditions the model cannot see, override, or omit.
This must be enforced in NestJS before the Qdrant call, and mirrored by Supabase RLS on the `chunks` table so
that a bug in one layer is caught by the other.

### 6.2 Retrieval pipeline (Mastra workflow)

```
1. classify(query)                 → { intent, needs_temporal, needs_decomposition }
2. if needs_decomposition: decompose(query) → sub_q[1..n]     (max 4, hard cap)
3. for each sub_q (parallel):
     a. extract_filter(sub_q)      → LegalFilter (Zod-validated, server-scoped)
     b. expand_terms(sub_q)        → corpus-grounded synonyms  [NOT HyDE]
     c. embed(sub_q)               → dense 1024d (USER-bge-m3, "search_query" semantics)
     d. bm25(sub_q)                → sparse (russian snowball)
     e. qdrant.query(prefetch=[dense,bm25,citation], fusion=rrf, limit=100)
4. dedupe by parent_id, keep best rank per parent
5. rerank(bge-reranker-v2-m3, query=original, doc=PARENT статья text) → top 8
6. grade(top 8)                    → CRAG: correct | ambiguous | incorrect
7. if all incorrect and retries < 2: relax filter / re-decompose → goto 3
   if still incorrect: ABSTAIN with an explanation of what was searched
8. parent_expand: fetch full статья + neighbouring части from Postgres
9. generate with span-level citation contract (§7)
10. verify(answer, evidence)       → drop/flag unsupported spans
```

Hard caps that matter in production: max 4 sub-queries, max 2 correction retries, max 12 total Qdrant calls,
30 s wall clock. Emit every step to Mastra tracing so a deputy's legal adviser can audit *why* a given статья
was surfaced.

---

## 7. Citation and anti-hallucination

### 7.1 The stakes

Stanford RegLab's *Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools* found that
purpose-built, RAG-backed legal research products still hallucinate: **Lexis+ AI >17%** of queries and
**Westlaw AI-Assisted Research ~33%** produced incorrect or misgrounded responses
([RegLab](https://reglab.stanford.edu/publications/hallucination-free-assessing-the-reliability-of-leading-ai-legal-research-tools/)).
Failure modes were not only fabricated authorities but **misgrounding** — citing a real норма that does not
support the proposition. RAG alone does not solve this. Design for it explicitly.

### 7.2 Design rules

1. **Citations are data, never generated text.** The model selects a `chunk_id`; the *rendering* of
   «ч. 2 ст. 15.1 Федерального закона от 27.07.2006 № 149-ФЗ» is produced by our template from
   `norm_components`. The model is structurally unable to invent a citation string.
2. **Span-level grounding.** Require the generator to emit, per assertion, `{chunk_id, quote}` where `quote`
   is a **verbatim substring** of `chunks.text`. Post-generation, verify by exact string search; on failure,
   locate offsets via normalized matching, and if that fails, **drop the sentence** and mark the answer partial.
   `char_offset_start/end` then give the UI a precise highlight in the source статья.
3. **Cite-or-abstain.** Any sentence making a legal claim without a validated `chunk_id` is not shown.
   The abstention message must be specific and actionable: *«В корпусе не найдено действующей нормы,
   регулирующей X. Проверены: ФЗ-149 (ред. от 08.08.2024), ФЗ-152, КоАП РФ гл. 13. Уточните формулировку
   или расширьте период.»*
4. **Verification agent (separate model call, separate context).** Input: the answer + only the retrieved
   evidence. Task: per sentence, label `supported | partially_supported | unsupported | contradicted`.
   It must **not** have access to the original question framing — that reduces sycophantic confirmation.
   Sentences labelled `unsupported`/`contradicted` are removed and logged.
5. **Temporal guard.** Every citation renders its редакция and validity window inline. If a cited chunk has
   `status = 'repealed'` or `valid_to < now()`, the UI shows a red «утратила силу с DD.MM.YYYY» badge and the
   generator is instructed to say so. An answer citing a repealed норма without flagging it is a *bug*, not a
   style issue.
6. **False-premise detection.** RegLab specifically tested false-premise queries. Add a pre-check: if the query
   asserts the existence of a норма (*"согласно ст. 42 ФЗ-149…"*) and exact-citation lookup returns nothing,
   answer by **correcting the premise** before anything else.
7. **No cross-document synthesis without provenance.** When the answer merges two акты, each clause carries its
   own citation; never a single trailing citation for a compound sentence.

### 7.3 Generation contract

```ts
export const GroundedAnswer = z.object({
  answer_html: z.string(),               // contains <cite data-ref="c1">…</cite> markers only
  claims: z.array(z.object({
    ref_id:   z.string(),                // "c1"
    text:     z.string(),                // the asserted sentence
    chunk_id: z.string().uuid(),
    quote:    z.string().min(10),        // MUST be a verbatim substring of chunks.text
    stance:   z.enum(["supports","qualifies","contradicts"]),
  })),
  abstained_on: z.array(z.string()),     // sub-questions the system refused to answer
  searched:     z.array(z.string()),     // human-readable description of what was searched
  as_of:        z.string().datetime(),   // the point-in-time the answer is valid for
});
```

Enforce with structured output + a server-side validator that rejects the whole response if any `quote`
is not found in its `chunk_id`'s text. Retry once with the validation errors fed back; then degrade to
"evidence only, no synthesis" mode — showing the retrieved статьи with no generated prose is a perfectly
acceptable and honest fallback for a legal tool.

---

## 8. Temporal / versioned retrieval — «что говорила ст. X ФЗ Y на дату D»

### 8.1 Conceptual model

Follow the **component-level, event-centric** approach from
*Modeling the Diachronic Evolution of Legal Norms* ([arXiv 2506.07853](https://arxiv.org/abs/2506.07853)),
which extends FRBR/LRMoo with **Temporal Version (TV)** and **Language Version (LV)** subclasses of Expression
precisely because Akoma Ntoso and plain FRBR "lack native mechanisms for granular, component-level versioning,
which hinders deterministic point-in-time reconstruction of legal texts" (VERIFIED, paper abstract).

Mapping onto Russian practice:

| FRBR/LRMoo | Russian | Our table |
|---|---|---|
| Work | Акт как таковой (ФЗ-149) | `acts` |
| Expression / Temporal Version | **Редакция** акта | `redactions` |
| Component TV | Статья/часть в конкретной редакции | `norm_components` |
| Event | Внесение изменений амендирующим ФЗ | `redactions.amended_by` |
| Manifestation | Опубликованный текст (pravo.gov.ru, EO number) | `redactions.source_url/source_hash` |

### 8.2 Bitemporality — two independent time axes

- **Valid time** (`valid_from`/`valid_to`): when the норма was/is **in force**. This is what the deputy asks about.
- **Transaction time** (`known_from`/`known_to`): when *our system* learned this. Needed because
  (a) публикация lags вступление в силу, (b) our ingest may be wrong and get corrected, (c) an audit must be
  able to reproduce "what did Doomatel show on 2026-03-01?"

Critically, **validity is per component, not per act.** A single amending ФЗ typically changes 3 статьи out of
80; the other 77 keep their existing `valid_from` unchanged. Modelling validity only at act level would force a
full re-index and a full re-embed on every amendment — at 10^6 acts that is economically impossible.
Component-level validity means **an amendment re-embeds only the changed статьи.**

Additional Russian-specific states beyond in-force/repealed:
- `not_yet_in_force` — принят и опубликован, но вступает в силу позже (very common: «вступает в силу с 1 сентября»)
- `suspended` — **приостановлено действие** (a real and distinct status in RF law, e.g. suspended by a later ФЗ)
- Retroactive amendments (**обратная сила**) — the amending law sets `valid_from` *earlier* than its own
  publication. Handle by trusting the амендирующий акт's stated date, and recording the discrepancy between
  `valid_from` and `known_from` so the retroactivity is visible in the audit trail.

### 8.3 Query paths

**Point-in-time (single статья):**
```sql
select nc.body, nc.citation_full, r.redaction_no, nc.valid_from, nc.valid_to, nc.status
from norm_components nc
join redactions r using (redaction_id)
join acts a on a.act_id = nc.act_id
where a.act_number = '149-ФЗ'
  and nc.article_no = '15.1'
  and nc.valid_from <= $1::timestamptz     -- D
  and nc.valid_to   >  $1::timestamptz
  and nc.known_from <= now() and nc.known_to > now();
```
This is **exact, deterministic, and does not touch the vector store at all** — the right answer for
"what did it say on D". Route `intent = temporal_lookup` here directly.

**Semantic search restricted to a date:**
```jsonc
"filter": { "must": [
  { "key": "valid_from", "range": { "lte": "2023-06-01T00:00:00Z" } },
  { "key": "valid_to",   "range": { "gt":  "2023-06-01T00:00:00Z" } }
]}
```
Requires `valid_from`/`valid_to` as **datetime payload indexes** in Qdrant. Note that `valid_to` for
currently-in-force chunks must be a concrete far-future timestamp (`9999-12-31T00:00:00Z`), not `null` —
Qdrant range filters do not match missing keys.

**Diff between редакции ("что изменилось"):**
```sql
select old.path, old.body as было, new.body as стало
from norm_components old
full outer join norm_components new
  on old.act_id = new.act_id and old.path = new.path
 and new.redaction_id = $2
where old.redaction_id = $1
  and (old.body is distinct from new.body);
```
Render with a word-level diff. This is one of the highest-value features for a deputy's аппарат and it needs
**no LLM at all** — do not let an agent "summarise the changes" when a deterministic diff exists.

### 8.4 Indexing strategy for редакции

**Index only the current редакция in the hot collection.** Historical редакции go to a second collection
`legal_chunks_history` with identical schema, queried only when `as_of` is set to a past date. Rationale:
>95% of queries are about действующее право; keeping ~15 historical редакции per статья in the hot index would
multiply the vector count by ~15 (10^7 → 1.5·10^8) and degrade every ordinary query. (Multiplier is an
**UNVERIFIED** estimate — measure the actual редакция count distribution on real data before committing.)

Deduplicate aggressively: if a статья's `body` is byte-identical between redaction N and N+1, do **not** create a
new chunk or a new embedding — extend the existing component's `valid_to`. For a typical amending law touching
3 of 80 статьи this saves ~96% of the re-embedding work.

---

## 9. Evaluation — build this before tuning anything

Nothing above should be frozen on the strength of public benchmarks. ruMTEB is general-domain; our corpus is
statutory Russian with heavy citation syntax. Required before launch:

1. **Golden set:** 200–300 real questions from deputies' аппарат, each labelled with the correct статья(и).
   Cover all four RegLab query classes: general research, jurisdiction/time-specific, **false-premise**,
   and factual recall.
2. **Metrics:** Recall@50 and nDCG@10 at the retrieval stage (this is what distinguishes the embedding models);
   citation precision (fraction of emitted citations that are verbatim-verifiable) and abstention rate at the
   generation stage.
3. **Ablations to run, in this order:** (a) dense-only vs BM25-only vs RRF hybrid; (b) with/without contextual
   prefix; (c) with/without reranker; (d) USER-bge-m3 vs FRIDA vs bge-m3; (e) RRF vs DBSF; (f) int8 vs binary
   quantization. Anthropic's published deltas (−35/−49/−67%) are a prior, not a result for our corpus.
4. **Regression harness in CI:** any change to chunking, prompts, or model revision re-runs the golden set.
   Legal retrieval quality regressions are silent and expensive.

---

## 10. Concrete package manifest (all VERIFIED on the registries, 2026-08-20)

```jsonc
// TypeScript / Node
"@qdrant/js-client-rest": "1.19.0",
"@mastra/core":           "1.60.0",
"@mastra/rag":            "2.6.0",
"@mastra/qdrant":         "1.1.2",
"@mastra/pg":             "1.21.0",
"mastra":                 "1.25.1",
"onnxruntime-node":       "1.27.0",   // optional pure-TS embedding path
"fastembed":              "2.1.0",    // optional; Russian model coverage UNVERIFIED
"zod":                    "^3"        // filter DSL
```

```txt
# Python inference/ingest sidecar
pymorphy3==2.0.6                  # MIT
pymorphy3-dicts-ru==2.4.417150.4580142
razdel==0.5.0                     # MIT — Russian sentence/token segmentation
natasha==1.6.0                    # MIT — NER for orgs/law refs
# + sentence-transformers / FlagEmbedding / vLLM for USER-bge-m3 + bge-reranker-v2-m3
```

Infrastructure images: `qdrant/qdrant:v1.19.0`, Supabase Postgres with `vector`, `ltree`, `pg_trgm`.

---

## 11. Open risks

1. **Corpus acquisition, not retrieval, is the critical path.** `*.duma.gov.ru` / `*.pravo.gov.ru` egress is
   blocked from this environment, so СОЗД/pravo.gov.ru parsing was **not** validated here. The chunk schema
   above assumes we can recover the статья/часть/пункт hierarchy from the source; if the only available format
   is flat HTML or PDF, structure recovery becomes a substantial parsing project in its own right. **Validate
   this before building anything in §5.**
2. **Redaction coverage.** Official публикация gives amending acts, not consolidated texts. Producing
   консолидированные редакции ourselves (applying «внести изменения» instructions programmatically) is
   genuinely hard and error-prone. If a licensed feed (КонсультантПлюс / Гарант) is procurable, buy it —
   this is the single largest quality lever in the whole system. **UNVERIFIED** whether such licensing is available.
3. **Snowball's limits for Russian.** `russian` Snowball over-stems. If exact-term recall proves inadequate,
   the fix is a Hunspell/Ispell Russian dictionary in Postgres and/or a custom Qdrant stopword+token pipeline,
   not a bigger embedding model.
4. **Model licence drift.** All recommended weights are MIT/Apache-2.0 today (VERIFIED). Pin HF commit SHAs
   (`embed_model_rev` in the schema exists for exactly this) and mirror the weights internally — a HF repo can
   be relicensed or removed, and re-downloading from abroad may not always be possible.
5. **Binary quantization quality on Russian legal text is unmeasured.** Do not adopt it to hit a RAM target
   without an nDCG@10 measurement on the golden set.
