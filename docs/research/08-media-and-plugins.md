# 08 — Audio/Meeting Intelligence (RU) & Plugin/Skill Extension System

> Research doc for **Doomatel** (multi-agent web app for депутаты ГД, legislative drafting).
> Date: 2026-08-20. Stack under validation: Next.js + NestJS + Mastra + Supabase + Qdrant/Milvus + TypeDB.
>
> **Legend:** `VERIFIED` = seen in fetched docs/search results with a cited URL. `UNVERIFIED` = inference,
> recollection, or an extrapolation that MUST be re-checked before being committed to code.

---

# PART A — Audio & meeting materials

## A.1 ASR for Russian

### A.1.1 The decisive benchmark

`VERIFIED` — AlphaCephei (Nickolay Shmyrev, author of Vosk) publishes the reference Russian ASR
comparison across 14 datasets. Source: <https://alphacephei.com/nsh/2024/04/14/russian-models.html>

WER, % (lower is better):

| Dataset | Vosk Small | Vosk Big | Nvidia RNNT | Whisper V2 | Whisper V3 | Whisper V3-turbo | GigaAM+LM | GigaAM RNNT | **GigaAM RNNT v2** |
|---|---|---|---|---|---|---|---|---|---|
| Аудиокниги АЦ | 5.1 | 2.1 | 8.2 | 7.5 | 5.8 | 6.5 | 4.0 | 5.3 | 4.4 |
| Аудиокниги Silero | 12.3 | 10.1 | 13.2 | 14.9 | 13.9 | 14.0 | 10.6 | 11.0 | 9.7 |
| Ru Librispeech | 15.4 | 11.5 | 11.2 | 12.8 | 9.5 | 9.7 | 5.8 | 7.6 | 5.2 |
| CommonVoice 12.0 | 9.8 | 6.2 | 5.9 | 7.9 | 5.5 | 6.2 | 6.4 | 6.3 | 2.6 |
| Golos Crowd | 5.1 | 3.6 | 2.7 | 19.1 | 14.7 | 14.5 | 3.2 | 2.6 | 2.5 |
| Golos Farfield | 10.0 | 6.6 | 7.1 | 17.0 | 17.6 | 18.7 | 5.9 | 5.2 | 4.4 |
| Sova устройства | 15.3 | 12.7 | 7.0 | 16.3 | 15.9 | 16.0 | 9.5 | 5.9 | 5.6 |
| Youtube Silero | 19.1 | 16.0 | 19.4 | 15.1 | 16.4 | 16.5 | 13.4 | 13.0 | 11.4 |
| **Телевещание** | 23.1 | 18.2 | 22.6 | 16.0 | 17.9 | 18.2 | 14.8 | 14.4 | 14.4 |
| Медицина | 18.2 | 15.0 | 19.2 | 15.5 | 13.8 | 13.7 | 11.1 | 12.3 | 10.9 |
| Команды Яндекса | 6.1 | 4.5 | 3.8 | 22.4 | 18.6 | 21.8 | 3.7 | 2.7 | 1.9 |
| **Звонки Silero** | 29.1 | 24.0 | 28.4 | 28.0 | 26.8 | 27.7 | 20.6 | 19.7 | 18.3 |
| Звонки заказы | 29.9 | 22.3 | 22.8 | 35.8 | 23.7 | 24.8 | 17.7 | 19.0 | 15.5 |
| Звонки поддержка | 21.1 | 16.6 | 23.8 | 28.4 | 26.8 | 27.5 | 16.7 | 18.0 | 14.2 |
| **Average** | 15.6 | 12.10 | 13.95 | 18.34 | 16.21 | 16.84 | 10.24 | 10.11 | **8.64** |

**Reading for Doomatel.** Two rows matter most for our workloads:
- **Телевещание** ≈ пленарное заседание / трансляция → best available is 14.4 % (GigaAM RNNT v2), Whisper V3 = 17.9 %.
- **Звонки** ≈ созвон / планёрка over VoIP → GigaAM v2 18.3 / 15.5 / 14.2 vs Whisper V3 26.8 / 23.7 / 26.8.

Whisper large-v3 is **~1.9× worse than GigaAM v2 on average for Russian** and dramatically worse on
telephony and far-field. **Whisper is the wrong default for a Russian-only product.**

`VERIFIED` — a widely-cited Habr write-up reports GigaAM at **3.3 % WER on CPU**, "2.4× better than
Whisper large-v3-turbo on RTX 4090", and concludes GigaAM `v3-e2e-rnnt` is the best RU option on
quality *and* speed: <https://habr.com/ru/articles/1002260/> (single-author benchmark; treat the exact
3.3 % as domain-specific, not universal).

### A.1.2 GigaAM (Sber / SberDevices / salute-developers) — RECOMMENDED PRIMARY

`VERIFIED` — <https://github.com/salute-developers/GigaAM> (README), <https://huggingface.co/ai-sage/GigaAM-v3>

| Fact | Value |
|---|---|
| License | **MIT** (both repo and `ai-sage/GigaAM` weights) |
| Python | ≥ 3.10; requires `ffmpeg` on PATH |
| PyPI | `gigaam` **0.1.0**, MIT (`https://pypi.org/pypi/gigaam/json`) — but README installs from git |
| Architecture | Conformer encoder, HuBERT-CTC style SSL pretraining, ~220–240M params `UNVERIFIED` (param count from secondary blog) |
| Model families | v1 (`v1_ssl`,`emo`,`v1_ctc`,`v1_rnnt`), v2 (`v2_ssl`,`v2_ctc`,`v2_rnnt`), **v3** (`v3_ssl`,`v3_ctc`,`v3_rnnt`,`v3_e2e_ctc`,`v3_e2e_rnnt`), multilingual (`multilingual_ssl`,`multilingual_large_ssl`,`multilingual_ctc`,`multilingual_large_ctc`) |
| v3 headline | avg WER **9.2 % (CTC)** / **8.4 % (RNNT)** vs Whisper 25.1 % on their eval mix; +30 % on new domains (callcenter, music, atypical speech); "70:30 win" vs Whisper in side-by-side |
| **e2e variants** | `v3_e2e_ctc` / `v3_e2e_rnnt` emit **punctuated, normalized text directly** — no separate punctuation/ITN model needed |
| Emotion | `emo` model, +15 % Macro-F1 vs competitors (useful for tone flags in планёрка) |
| Deployment | ONNX export (fp32 + fp16, fp16 recommended on GPU); Triton Inference Server + TensorRT |
| Paper | arXiv **2506.01192** (published 2025-06-01) |

Install + API `VERIFIED`:

```bash
git clone https://github.com/salute-developers/GigaAM.git
cd GigaAM && pip install -e .[torch]
# ffmpeg must be on PATH
```

```python
import gigaam
model = gigaam.load_model("v3_e2e_rnnt")            # punctuated + normalized
text  = model.transcribe(audio_path)
res   = model.transcribe(audio_path, word_timestamps=True)
res   = model.transcribe_longform(long_audio_path)  # for пленарки (hours)
```

Alternative HF/transformers path `VERIFIED`:

```python
from transformers import AutoModel
model = AutoModel.from_pretrained("ai-sage/GigaAM-v3", revision="e2e_rnnt", trust_remote_code=True)
model.transcribe("example.wav")
```

Community ONNX / non-NeMo mirrors `VERIFIED` (existence, from search results — verify hashes before use):
- `istupakov/gigaam-v2-onnx` — ONNX export of v2
- `waveletdeboshir/gigaam-ctc`, `waveletdeboshir/gigaam-rnnt`, `waveletdeboshir/gigaam-ctc-with-lm` — HF-transformers-native ports
- `Alexanrd/GigaAMv2_RNNT_RU_ASR_for_sherpa_onnx` — sherpa-onnx runtime

**GPU requirement** `UNVERIFIED` — for a ~240M-param Conformer, fp16 inference fits comfortably in
8 GB VRAM; a single RTX 4090 / A10 / L4 is more than enough. `transcribe_longform` on multi-hour
пленарные заседания will be dominated by chunking, not VRAM. Benchmark before sizing.

**Risk:** GigaAM is developed by Sber. For a State-Duma-adjacent product this is *politically*
favourable but creates a single-vendor dependency for the best-quality path. Mitigate by keeping the
adapter interface model-agnostic (see A.3.7).

### A.1.3 T-one (T-Bank / voicekit-team) — RECOMMENDED for streaming / telephony

`VERIFIED` — <https://github.com/voicekit-team/T-one> (README)

| Fact | Value |
|---|---|
| License | **Apache-2.0** |
| Size | **71M params** (tiny — real CPU deployment) |
| Domain | Russian **telephony**, streaming, production-tested on millions of calls |
| WER | call-center **8.63 %**, other telephony **6.20 %**, named entities **5.83 %**, OpenSTT `asr_calls_2_val` (re-labeled) **7.94 %** |
| Chunking | 300 ms audio chunks, custom log-probability splitter for phrase boundaries |
| Decoding | greedy **or** KenLM-based CTC beam search |
| HF model | `t-tech/T-one` |
| Docker | `tinkoffcreditsystems/t-one:0.1.0` (web UI: file upload + live mic) |
| Requirements | min 4 CPU cores, 8 GB RAM recommended; Python 3.9–3.12; Linux/macOS (KenLM has no native Windows) |
| Scale-out | NVIDIA Triton support |
| **PyPI** | **NOT published.** `pip install tone` installs an unrelated package (`tone` 0.1.0, "Deal with tone"). `t-one` does not exist on PyPI. Install via Poetry from the git repo. `VERIFIED` |

```bash
git clone https://github.com/voicekit-team/T-one && cd T-one
poetry install -E demo      # or -E finetune
```

```python
from tone import StreamingCTCPipeline, read_audio
pipeline = StreamingCTCPipeline.from_hugging_face()

# offline
print(pipeline.forward_offline(read_audio("call.wav")))

# streaming
state = None
for chunk in audio_chunks:                      # 300 ms each
    new_phrases, state = pipeline.forward(chunk, state)
```

T-one also ships a **fine-tuning example** (`examples/finetune_example.ipynb`) — relevant if we ever
want to adapt to parliamentary vocabulary (законопроект, поправка, первое чтение, фамилии депутатов).

### A.1.4 Whisper family — fallback / multilingual only

`VERIFIED` — WER table above; `faster-whisper` **1.2.1** (MIT), `ctranslate2` **4.8.1** (MIT) on PyPI.

- `openai/whisper-large-v3` — RU avg 16.21 % (table). Not competitive.
- `large-v3-turbo` — *faster*, slightly worse (16.84 %). Note the anomaly: turbo is **worse** on
  Golos Farfield (18.7) and Команды Яндекса (21.8) — a red flag for far-field hall audio.
- `faster-whisper` (CTranslate2 backend) — 4× faster / lower VRAM than reference Whisper `UNVERIFIED`
  (well-known claim, not re-verified here). Use `compute_type="float16"` on GPU, `int8` on CPU.
- Fine-tuned RU Whisper: a `large-v3` fine-tune on Common Voice 17 reached **6.39 %** vs 9.84 %
  baseline `VERIFIED` (from search summary; exact model card not fetched → treat as directional).

**Verdict:** keep Whisper only for (a) non-Russian audio (foreign delegations, международные
переговоры), (b) as a diversity check for a second-opinion pass on disputed segments.

### A.1.5 Vosk

`VERIFIED` — PyPI `vosk` **0.3.45**, Apache-2.0. RU avg WER: small 15.6 %, big 12.10 %.
Strengths: tiny, offline, CPU-only, streaming, easy embedding, no Python-ML stack.
Use case for us: **on-device/edge fallback and live captions on a laptop**, not the archival transcript.

### A.1.6 Cloud, RF-hosted (152-ФЗ / data-residency fallback)

**SaluteSpeech (SberDevices)** — `VERIFIED` docs exist at
<https://developers.sber.ru/docs/ru/salutespeech/overview>. Async HTTP flow `VERIFIED`
(<https://developers.sber.ru/docs/ru/salutespeech/rest/async-general>):

1. `POST` получить токен доступа (OAuth, Bearer)
2. `POST` загрузить файл в облачное хранилище SaluteSpeech
3. `POST` создать задачу на распознавание (body = uploaded file id + recognition params)
4. `GET` получить статус задачи
5. `GET` скачать файл с результатом

Response codes on task creation: 200 / 400 / 401 / **413 (input size exceeded)** / 500 `VERIFIED`.
Rate limit: **≤10 parallel streams for юрлица, ≤5 for физлица** `VERIFIED`.
Exact host, path strings, OAuth scope names (`SALUTE_SPEECH_PERS` / `SALUTE_SPEECH_CORP`), audio format
enum and speaker-separation flags — **UNVERIFIED**, the doc pages did not render the values through
WebFetch. *Action item: re-read `/docs/ru/salutespeech/rest/post-token`, `/rest/post-data-upload`,
`/recognition/recognition-async-http`, `/recognition/recognition-sync` from a machine with .ru egress.*
"SaluteSpeech Insights" is a separate model family for analytics over calls `VERIFIED` (mentioned in docs index).

**Yandex SpeechKit** — `VERIFIED` <https://aistudio.yandex.ru/docs/en/speechkit/stt/api/streaming-examples-v3.html>
- API **v3**, gRPC streaming; languages: **Russian, English, Turkish**.
- Billing unit: **15-second block of single-channel audio**, rounded up; in streaming mode billing
  starts when the settings message is sent — an empty stream still costs 1 block.
- Pricing page: <https://aistudio.yandex.ru/docs/en/speechkit/pricing.html>

**Recommendation (A.1):**

| Role | Choice |
|---|---|
| **Primary, self-hosted** | **GigaAM `v3_e2e_rnnt`** (MIT) — punctuated+normalized RU output, best WER, ONNX/Triton path |
| **Streaming / live созвон** | **T-one** (Apache-2.0, 71M, CPU-capable, 300 ms chunks) |
| **RF-hosted cloud fallback** | **SaluteSpeech** (same vendor lineage as GigaAM → consistent output style; RF data residency). Yandex SpeechKit v3 as second cloud. |
| **Non-Russian audio** | `faster-whisper` 1.2.1 + `large-v3` |
| **Edge / offline laptop** | Vosk 0.3.45 big model |

Rationale for SaluteSpeech over Yandex as *the* fallback: it is the managed sibling of our primary
model, so transcripts stay stylistically comparable when we fail over; and RF-hosted is a hard
requirement for a Duma-adjacent app. `UNVERIFIED` — confirm the ГОСТ/ФСТЭК/152-ФЗ attestation status
of both clouds with the customer's security office before signing anything.

---

## A.2 Speaker diarization

### A.2.1 pyannote.audio — RECOMMENDED

`VERIFIED`:
- PyPI `pyannote.audio` **4.0.7**
- `pyannote/speaker-diarization-3.1` — **MIT**, "will always remain open-source", requires pyannote.audio ≥3.1
  (<https://huggingface.co/pyannote/speaker-diarization-3.1>)
- `pyannote/speaker-diarization-community-1` — **CC-BY-4.0**, "will always remain freely accessible",
  significantly better than 3.1 on noisy real-world audio
  (<https://huggingface.co/pyannote/speaker-diarization-community-1>, <https://www.pyannote.ai/blog/community-1>)
- **Both are HF *gated* repos**: you must accept the license terms with a HF account and pass an
  `HF_TOKEN`. Failure mode seen in the wild: `Cannot access gated repo for pyannote/speaker-diarization-3.1`
  (<https://discuss.huggingface.co/t/cannot-access-gated-repo-for-pyannote-speaker-diarization-3-1-.../171972>)

**Operational consequence for Doomatel:** gating means a *build-time* dependency on huggingface.co and
a long-lived token. In a закрытый контур this is unacceptable. **Mitigation: vendor the model weights
into our own artifact registry (S3/Supabase Storage/MinIO) at build time under the CC-BY-4.0 /
MIT terms, ship attribution, and load from a local path at runtime.** Verify the license text permits
redistribution before doing so — MIT clearly does; CC-BY-4.0 requires attribution, which is fine.

### A.2.2 NVIDIA NeMo / Sortformer

`VERIFIED`:
- `nvidia/diar_sortformer_4spk-v1` — offline, 4 speakers
- `nvidia/diar_streaming_sortformer_4spk-v2` — **CC-BY-4.0**, streaming
- `nvidia/diar_streaming_sortformer_4spk-v2.1` — **NVIDIA Open Model License** (different, more restrictive terms)
- Trained on 2445 h real conversations + 5150 h simulated mixtures (NeMo speech data simulator)
- Sortformer solves the permutation problem by ordering speakers by **arrival time** — which is
  exactly what we want for a transcript rendered top-to-bottom
- PyPI `nemo-toolkit` **3.0.0**, Apache-2.0

**Hard limit: 4 speakers.** That kills it for пленарное заседание (hundreds of speakers) but it is
excellent for a **созвон/планёрка with ≤4 participants** and for **live** diarization.

### A.2.3 WhisperX

`VERIFIED` — PyPI `whisperx` **3.8.6**, **BSD-2-Clause**. <https://github.com/m-bain/whisperX>
- Does: batched Whisper (70× realtime with large-v2), **wav2vec2 forced alignment → word-level
  timestamps**, then speaker assignment via pyannote.
- Now uses `speaker-diarization-community-1`; needs an HF token.
- < 8 GB VRAM for large-v2 at `beam_size=5`; default `batch_size=16`.
- **Russian alignment IS supported**: WhisperX's `DEFAULT_ALIGN_MODELS_HF` maps `"ru"` →
  **`jonatasgrosman/wav2vec2-large-xlsr-53-russian`** `VERIFIED`
  (<https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py>; the model itself is
  XLSR-53 fine-tuned on Common Voice 6.1 + CSS10, test WER 13.3 / CER 2.88, 16 kHz input).

**The valuable, reusable part of WhisperX is the alignment stage, not the Whisper stage.** Since we
are using GigaAM as the recognizer, we can either (a) use GigaAM's native `word_timestamps=True`, or
(b) feed GigaAM's text into `whisperx.align()` with the Russian wav2vec2 model for a second opinion.
Prefer (a); keep (b) as a repair path when GigaAM timestamps drift on long-form audio.

### A.2.4 Recommendation (A.2)

| Scenario | Diarizer |
|---|---|
| **Default, batch (созвон, планёрка, интервью)** | `pyannote/speaker-diarization-community-1` (CC-BY-4.0), weights vendored locally |
| Strict-copyleft-averse / minimal footprint | `pyannote/speaker-diarization-3.1` (MIT) |
| **Live/streaming, ≤4 speakers** | `nvidia/diar_streaming_sortformer_4spk-v2` (CC-BY-4.0 — *not* v2.1) |
| **Пленарное заседание** | **Do not diarize acoustically.** Use the председательствующий's roll-call and the official стенограмма speaker labels; anchor with a lightweight speaker-embedding match against enrolled deputy voiceprints (see A.3.5). Acoustic diarization degrades badly past ~10 speakers. |

---

## A.3 Pipeline design

### A.3.1 Stages

```
[1] UPLOAD          Next.js → Supabase Storage (resumable, TUS) OR S3 multipart
                    -> row in media_asset (status=uploaded)
[2] PROBE           ffprobe -> duration, channels, codec, sample rate
[3] NORMALIZE       ffmpeg -> 16 kHz mono PCM s16le WAV (+ loudnorm)
[4] VAD             silero-vad (или T-one splitter) -> speech segments, drop silence
[5] ASR             GigaAM v3_e2e_rnnt (word_timestamps=True, transcribe_longform)
[6] DIARIZE         pyannote community-1 -> [(start, end, SPEAKER_XX)]
[7] MERGE           word-level timestamps ⨝ diarization turns -> utterances
[8] SPEAKER NAMING  voiceprint match vs deputy enrollment + LLM name-mention resolution
[9] TRANSCRIPT      persist utterances, build full text, index into Qdrant
[10] SUMMARIZE      Mastra agent -> протокол (краткое содержание, повестка, решения)
[11] EXTRACT        Mastra agent -> поручения / решения / задачи (structured, Zod)
[12] TASKS          auto-create tasks; link to bills/projects; notify assignees
[13] LINK           entity linking -> законопроекты (СОЗД №), TypeDB graph edges
```

### A.3.2 Exact ffmpeg normalization

```bash
# probe
ffprobe -v error -print_format json -show_format -show_streams in.m4a

# canonical normalization for ASR (16 kHz mono PCM, EBU R128 loudness normalized)
ffmpeg -hide_banner -nostdin -i in.m4a \
  -vn -sn -dn \
  -af "aresample=resampler=soxr,loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ar 16000 -ac 1 -c:a pcm_s16le -f wav out.wav

# for multi-track conference recordings (Zoom/Teams per-speaker tracks) — SPLIT, DON'T MIX:
ffmpeg -i in.mkv -map 0:a:0 -ar 16000 -ac 1 -c:a pcm_s16le spk0.wav \
                 -map 0:a:1 -ar 16000 -ac 1 -c:a pcm_s16le spk1.wav
```

> **Big win, cheap:** if the meeting platform gives per-participant audio tracks, diarization becomes
> *trivial and exact*. Detect `nb_streams > 1` in probe and route to the multi-track branch. Always
> prefer this over acoustic diarization. `UNVERIFIED` — confirm which RF-permitted conferencing tools
> the Duma actually uses (VK Звонки / Яндекс Телемост / TrueConf / Vinteo) expose multi-track exports.

Node side: `fluent-ffmpeg` **2.1.3** (MIT) `VERIFIED` — but it is effectively unmaintained (last
publish 2024-05-19). Prefer spawning `ffmpeg` directly via `execa`/`child_process` with an explicit
arg array; avoids shell injection and the abandoned wrapper.

### A.3.3 VAD

- **silero-vad** — de-facto standard, tiny, ONNX, MIT `UNVERIFIED` (license/version not re-verified in
  this pass — check <https://github.com/snakers4/silero-vad> before shipping).
- **T-one's log-probability splitter** — already integrated, purpose-built for RU telephony `VERIFIED`.
- pyannote's `segmentation-3.0` also gives VAD as a by-product.

Use VAD to (a) cut dead air (a 4-hour планёрка is often 40 % silence → 40 % GPU cost saved), and
(b) produce the chunk boundaries for `transcribe_longform`.

### A.3.4 Merging ASR words with diarization turns

Standard algorithm (`UNVERIFIED` — this is our design, not quoted from a doc):

```ts
// each ASR word: { text, start, end }
// each diar turn: { start, end, speaker }
function assignSpeakers(words: Word[], turns: Turn[]): Utterance[] {
  // 1. for each word, pick the turn with max temporal overlap with [word.start, word.end]
  //    tie-break: turn whose midpoint is nearest the word midpoint
  // 2. collapse consecutive words with the same speaker into an utterance
  // 3. split an utterance at any silence gap > 1.5 s or at sentence-final punctuation
  //    (GigaAM e2e already emits «.», «?», «!»)
  // 4. drop utterances shorter than 200 ms with < 2 words (diarization noise)
}
```

Store BOTH layers (`transcript_word` and `transcript_utterance`) — the word layer is what lets a user
click a phrase in the UI and seek the audio player, and it is what we re-run when a human corrects
speaker attribution.

### A.3.5 Speaker naming — matching to known deputies

Three signals, combined:

1. **Voiceprint enrollment (strongest).** Keep a `speaker_voiceprint` table with x-vector/ECAPA
   embeddings per deputy, enrolled from prior confirmed transcripts. At diarization time, embed each
   `SPEAKER_XX` cluster centroid and cosine-match against enrolled prints; accept above a tuned
   threshold, else leave unnamed. pyannote exposes embeddings via `pyannote/embedding` /
   `pyannote/wespeaker-voxceleb-resnet34-LM` `UNVERIFIED` (model ids from memory — verify on HF).
2. **Roll-call / self-introduction resolution.** An LLM pass over the first utterances of each cluster
   looking for «Слово предоставляется депутату Иванову», «Иванов, фракция ...», «Спасибо, Сергей
   Петрович» → maps `SPEAKER_03 → Иванов И.И.`
3. **Calendar/attendee roster.** If the meeting was created in Doomatel with an attendee list, restrict
   the candidate set to those people — this collapses the search space and raises precision enormously.

**Privacy/legal gate:** biometric voiceprints of депутаты are **биометрические персональные данные**
under 152-ФЗ. `UNVERIFIED` — but almost certainly requires explicit written согласие and possibly
registration in ЕБС considerations. Design the feature as **opt-in per deputy**, store embeddings
encrypted, make them deletable, and make the whole subsystem switchable off by tenant policy. Ship
v1 with signals 2+3 only (no biometrics) and add voiceprints behind a flag.

### A.3.6 Data schema (Postgres / Supabase)

```sql
-- ============ MEDIA & MEETINGS ============
create type meeting_kind      as enum ('созвон','планёрка','пленарное_заседание',
                                       'заседание_комитета','рабочая_группа','интервью','иное');
create type media_status      as enum ('uploaded','probing','normalizing','vad','asr',
                                       'diarizing','merging','summarizing','done','failed');
create type transcript_source as enum ('asr','imported_docx','imported_pdf','imported_txt','manual');

create table meeting (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references org(id),          -- фракция / комитет / аппарат
  kind          meeting_kind not null,
  title         text not null,
  started_at    timestamptz,
  ended_at      timestamptz,
  location      text,
  -- link to legislative context
  bill_ids      text[] default '{}',                       -- СОЗД номера, e.g. '123456-8'
  project_id    uuid references project(id),
  created_by    uuid not null references app_user(id),
  created_at    timestamptz not null default now(),
  visibility    text not null default 'org'                -- 'private'|'org'|'public'
);

create table meeting_attendee (
  meeting_id  uuid not null references meeting(id) on delete cascade,
  person_id   uuid references person(id),                  -- депутат / сотрудник аппарата
  display_name text not null,
  role        text,                                        -- 'председательствующий','докладчик','содокладчик'
  primary key (meeting_id, display_name)
);

create table media_asset (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid references meeting(id) on delete cascade,
  storage_bucket  text not null,
  storage_path    text not null,                           -- original upload
  normalized_path text,                                    -- 16k mono wav
  mime_type       text not null,
  bytes           bigint not null,
  duration_ms     int,
  channels        smallint,
  sample_rate     int,
  sha256          bytea not null,
  is_multitrack   boolean not null default false,
  track_index     smallint,                                -- for per-speaker tracks
  status          media_status not null default 'uploaded',
  error           text,
  created_at      timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table transcript (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meeting(id) on delete cascade,
  media_id      uuid references media_asset(id) on delete set null,
  source        transcript_source not null,
  language      text not null default 'ru',
  asr_model     text,                                      -- 'gigaam:v3_e2e_rnnt'
  asr_model_rev text,
  diar_model    text,                                      -- 'pyannote:speaker-diarization-community-1'
  wer_estimate  real,
  is_official   boolean not null default false,            -- официальная стенограмма ГД
  full_text     text,                                      -- denormalized, for FTS
  created_at    timestamptz not null default now()
);
create index on transcript using gin (to_tsvector('russian', coalesce(full_text,'')));

create table transcript_speaker (
  id            uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcript(id) on delete cascade,
  cluster_label text not null,                             -- 'SPEAKER_00'
  person_id     uuid references person(id),
  display_name  text,                                      -- 'Иванов И.И.'
  confidence    real,                                      -- 0..1
  resolved_by   text,                                      -- 'voiceprint'|'llm_mention'|'roster'|'human'
  unique (transcript_id, cluster_label)
);

create table utterance (
  id            uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcript(id) on delete cascade,
  idx           int  not null,                             -- ordinal in transcript
  speaker_id    uuid references transcript_speaker(id),
  start_ms      int,                                       -- null for imported text w/o timing
  end_ms        int,
  text          text not null,
  confidence    real,
  is_edited     boolean not null default false,
  unique (transcript_id, idx)
);
create index on utterance (transcript_id, start_ms);
create index on utterance using gin (to_tsvector('russian', text));

-- word layer: high volume -> partition by transcript or keep in a separate table only
create table transcript_word (
  transcript_id uuid not null references transcript(id) on delete cascade,
  utterance_id  uuid not null references utterance(id) on delete cascade,
  idx           int  not null,
  text          text not null,
  start_ms      int  not null,
  end_ms        int  not null,
  confidence    real,
  primary key (transcript_id, utterance_id, idx)
) partition by hash (transcript_id);

-- ============ EXTRACTED ACTIONABLES ============
create type actionable_kind as enum ('поручение','решение','задача','вопрос','риск','договорённость');
create type actionable_status as enum ('proposed','confirmed','rejected','converted');

create table actionable (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meeting(id) on delete cascade,
  transcript_id uuid not null references transcript(id) on delete cascade,
  kind          actionable_kind not null,
  title         text not null,                             -- imperative, <=120 chars
  body          text,
  assignee_id   uuid references person(id),
  assignee_raw  text,                                      -- 'Аппарат комитета' when unresolved
  due_date      date,
  priority      smallint,                                  -- 1..5
  bill_ids      text[] default '{}',
  -- provenance: this is non-negotiable for a government app
  evidence_utterance_ids uuid[] not null default '{}',
  evidence_quote text not null,
  start_ms      int,
  end_ms        int,
  confidence    real not null,
  status        actionable_status not null default 'proposed',
  reviewed_by   uuid references app_user(id),
  reviewed_at   timestamptz,
  task_id       uuid references task(id),                  -- set on conversion
  created_at    timestamptz not null default now()
);
create index on actionable (meeting_id, status);
create index on actionable using gin (bill_ids);

create table meeting_summary (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meeting(id) on delete cascade,
  transcript_id uuid not null references transcript(id) on delete cascade,
  model         text not null,
  kind          text not null default 'протокол',          -- 'протокол'|'краткая_справка'|'тезисы'
  content_md    text not null,
  sections      jsonb not null default '{}',               -- {повестка, участники, решения, ...}
  token_usage   jsonb,
  created_at    timestamptz not null default now()
);

-- ============ VOICEPRINTS (opt-in, 152-ФЗ sensitive) ============
create table speaker_voiceprint (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references person(id) on delete cascade,
  model        text not null,                              -- 'pyannote/wespeaker-voxceleb-resnet34-LM'
  embedding    vector(256),                                -- pgvector; or store in Qdrant
  consent_ref  text not null,                              -- reference to signed согласие
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
```

RLS sketch (Supabase):

```sql
alter table meeting enable row level security;
create policy meeting_read on meeting for select
  using (
    visibility = 'public'
    or org_id = (auth.jwt() ->> 'org_id')::uuid
    or created_by = auth.uid()
  );
-- child tables inherit via EXISTS on the parent meeting
alter table utterance enable row level security;
create policy utterance_read on utterance for select using (
  exists (select 1 from transcript t join meeting m on m.id = t.meeting_id
          where t.id = utterance.transcript_id and (m.visibility='public'
             or m.org_id = (auth.jwt() ->> 'org_id')::uuid))
);
```

Vector index (Qdrant): one collection `meeting_chunks`, payload
`{meeting_id, transcript_id, utterance_ids[], speaker_name, start_ms, end_ms, kind, org_id, bill_ids[]}`.
Chunk at ~400–800 tokens over consecutive utterances, never splitting mid-utterance, with the speaker
name prefixed into the chunk text so retrieval can answer «что говорил Иванов про законопроект X».

### A.3.7 Job orchestration

- Queue: **BullMQ 6.1.2** (MIT) `VERIFIED` on Redis, driven from NestJS. One queue per stage so the
  GPU stages (`asr`, `diarize`) have their own concurrency limit (= number of GPUs).
- The ASR/diarization workers are **Python**, not Node. Expose them as a small FastAPI service behind
  an internal HTTP contract, or as BullMQ workers via a Python bridge. Recommended: a thin
  `media-worker` Python service with endpoints `POST /asr`, `POST /diarize`, `POST /align`, and NestJS
  jobs calling it. This keeps model loading warm (model load is 5–30 s; you do not want it per job).
- Idempotency: key every job on `media_asset.sha256 + stage + model_id`. Re-running with a new model
  version creates a **new** `transcript` row rather than mutating the old — required for auditability.
- Progress: write stage transitions to `media_asset.status`; stream to the UI via **Supabase Realtime**
  on that row.

**Model-agnostic adapter** (so GigaAM is swappable):

```ts
export interface AsrResult {
  text: string;
  words: { text: string; startMs: number; endMs: number; confidence?: number }[];
  language: string;
  modelId: string;      // 'gigaam:v3_e2e_rnnt@<sha>'
}
export interface AsrEngine {
  transcribe(wavPath: string, opts: { wordTimestamps: boolean; longform: boolean }): Promise<AsrResult>;
}
// implementations: GigaAmEngine | ToneEngine | FasterWhisperEngine | SaluteSpeechCloudEngine | YandexSpeechKitEngine
```

### A.3.8 LLM stages — summarization and extraction

Both are Mastra agents with **structured output** (Zod schema) so we never parse prose.

```ts
import { z } from 'zod';

export const ActionableSchema = z.object({
  kind: z.enum(['поручение','решение','задача','вопрос','риск','договорённость']),
  title: z.string().max(120),
  body: z.string().optional(),
  assigneeRaw: z.string().optional(),      // как названо в речи
  dueDateRaw: z.string().optional(),       // «до конца недели», «к 15 сентября»
  billRefs: z.array(z.string()).default([]), // '123456-8'
  evidenceQuote: z.string(),               // MUST be a verbatim substring of the transcript
  utteranceIdx: z.array(z.number()),
  confidence: z.number().min(0).max(1),
});
export const ExtractionSchema = z.object({ items: z.array(ActionableSchema) });
```

**Hallucination guard (mandatory for a government app):** after the LLM returns, verify that
`evidenceQuote` is a literal substring of the concatenated transcript (after whitespace
normalization). Reject any item that fails. This single check eliminates the most damaging failure
mode — an invented поручение attributed to a real deputy.

**Long-meeting strategy:** map-reduce. Chunk the transcript into ~8k-token windows with 1-utterance
overlap → extract per window → dedupe by (kind, normalized title, assignee) with fuzzy match →
reduce into a single протокол. Keep the per-window model calls parallel.

**Never auto-commit.** `actionable.status` starts at `proposed`. A human (депутат or помощник)
confirms in the UI before `task` rows are created. Log `reviewed_by`/`reviewed_at`. This is both a
product and a legal requirement — an AI-generated поручение with no human in the loop is a liability.

### A.3.9 Task creation & linking

On confirm:
```
actionable(status='proposed') --confirm--> task(...)  +  actionable.status='converted', task_id=...
                                        \--> edge in TypeDB: (task) -[derived_from]-> (utterance)
                                                            (task) -[concerns]-> (законопроект 123456-8)
                                                            (meeting) -[discussed]-> (законопроект 123456-8)
```
Bill reference extraction: regex `\b\d{5,7}-\d{1,2}\b` catches СОЗД numbers («123456-8») spoken or
written; plus fuzzy title match against the bill index in Qdrant for «законопроект о ... ».

---

## A.4 Importing existing text transcripts & documents

### A.4.1 Официальные стенограммы ГД

`UNVERIFIED` — the sandbox blocks `*.duma.gov.ru`, so the exact URL patterns were not re-verified in
this pass. Cross-reference `docs/research/01-sozd-data-sources.md` (already in this repo) for the
verified СОЗД/transcript endpoints. What the ingester must handle:

- Стенограммы are published as **HTML pages and/or DOC/DOCX/PDF** per заседание.
- Structural markers to parse: `Председательствующий.`, `<Фамилия И.О.>, фракция «...».`,
  `Из зала.`, timestamps of the form `(Идёт голосование. ...)`, `Результаты голосования`.
- Speaker lines conventionally end with a period after the surname/role and are often
  bold/uppercase — usable as a parse signal in DOCX runs.

Parser contract: produce the **same `transcript` + `utterance` rows** as the ASR path, with
`source='imported_docx'`, `is_official=true`, `start_ms=null`. Everything downstream (summarize,
extract, index, link) then works unchanged. This is the key architectural point: **the transcript
schema is the seam.**

### A.4.2 DOCX

- `mammoth` **1.12.1** (BSD-2-Clause) `VERIFIED` — DOCX → semantic HTML/Markdown, preserves headings
  and bold; good default. `mammoth.convertToHtml({path})` / `.extractRawText({path})`.
- For run-level formatting (needed to detect bold speaker names) mammoth is too lossy → unzip the
  `.docx` (`unzipper` **0.12.5**, MIT `VERIFIED`) and parse `word/document.xml` directly with a
  streaming XML parser, reading `w:p` → `w:r` → `w:rPr/w:b`.
- Legacy `.doc` (binary, pre-2007) — Duma archives contain these. Convert with
  `libreoffice --headless --convert-to docx` in the worker container. `UNVERIFIED` (standard practice,
  not verified here).

### A.4.3 PDF

- Text-layer PDFs: `pdfjs-dist` or `pdf-parse` in Node; **`pdfplumber`/`PyMuPDF` in the Python worker
  gives far better layout/column handling** for two-column parliamentary documents. `UNVERIFIED`
  (library capability claims not re-verified).
- Scanned PDFs: OCR. For Russian, **Tesseract with `rus` traineddata** as the floor; consider
  `docTR`/`Surya` for better layout. `UNVERIFIED`.
- Always store `page_no` and bounding boxes if available, so extracted actionables can cite a page.

### A.4.4 Import UX

Single endpoint, sniff by magic bytes not by extension:

```
POST /api/meetings/:id/transcripts/import
  multipart: file
  -> detect: audio/video | docx | doc | pdf | txt | vtt | srt
  -> route to the matching parser
  -> preview diff in UI (parsed speakers + first 20 utterances) before commit
```
Also accept **WebVTT/SRT** — most conferencing tools export these, and they already carry timings
and often speaker labels, making them the cheapest high-quality input we can get.

---

## A.5 Part A risks

1. **GigaAM long-form drift.** Word timestamps on 3+ hour audio can accumulate error. Mitigate with
   VAD-bounded chunking and per-chunk timestamp rebasing; validate against a known-good sample.
2. **Diarization collapse in a large hall.** Do not promise diarization for пленарные заседания.
3. **HF gating in a closed network.** Vendor weights; never let a production deploy reach out to
   huggingface.co.
4. **Biometrics under 152-ФЗ.** Voiceprints are a legal minefield. Ship without them first.
5. **Hallucinated поручения.** Verbatim-quote verification + mandatory human confirmation.
6. **`fluent-ffmpeg` is unmaintained** (last release 2024-05) — spawn ffmpeg directly.
7. **T-one is not on PyPI** — a `pip install tone` in a Dockerfile installs an unrelated package.

