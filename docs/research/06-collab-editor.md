# 06 — Collaborative block editor + realtime collaboration for legal drafting

**Scope:** the editing surface of Doomatel — совместная работа над текстами законопроектов, поправок,
пояснительных записок, ФЭО, заключений; режим поправок (track changes), комментарии, история версий,
экспорт в DOCX/PDF, генерация презентаций и текстов выступлений.

**Hard constraints driving every decision:**
1. **Суверенитет данных.** Депутаты ГД. Никакого зарубежного SaaS в data path. Всё разворачивается
   в контуре заказчика (Docker/K8s, РФ). Это исключает Tiptap Cloud, Liveblocks, PartyKit, y-sweet cloud,
   Convex, Velt и любые managed-CRDT сервисы.
2. **Режим поправок обязателен.** Поправка — юридический объект (ст. 120 Регламента ГД), а не «diff».
3. **Экспорт в DOCX обязателен.** Аппарат ГД работает в Word; вносимые документы — .doc/.docx/.rtf.
4. **Лицензии.** Проприетарный продукт для госзаказчика → copyleft (GPL/AGPL) в зависимостях недопустим
   без покупки коммерческой лицензии; покупка лицензии у иностранного вендора — отдельный риск.

**Legend:** `VERIFIED` — увидено в исходниках пакета / официальной документации, URL или команда указаны.
`UNVERIFIED` — вывод, экстраполяция или пересказ вторичного источника; требует перепроверки.

Research date: **2026-08-20**. Все версии пакетов сняты через `npm view <pkg> version license` в этот день.

---

## 0. Executive recommendation (TL;DR)

| Слой | Решение | Уверенность |
|---|---|---|
| Ядро редактора | **Tiptap v3 (MIT) поверх ProseMirror**, собственный UI блоков | high |
| Альтернатива №1 | BlockNote 0.54 (MPL-2.0 core) — если нужен Notion-UX «из коробки» | medium |
| Отклонено | Plate/Slate (нестабильность CRDT), Lexical (нет ProseMirror-экосистемы track changes), Tiptap Cloud/Pro | high |
| CRDT | **Yjs 13.6.32** (MIT) + `y-prosemirror` 1.3.7 / `@tiptap/y-tiptap` 3.0.9 | high |
| Провайдер (self-hosted) | **Hocuspocus 4.6.0** (MIT) — отдельный сервис `apps/collab` | high |
| Персистентность | **Postgres (Supabase)**: append-only лог `update_v2` + фоновая компакция + именованные редакции | high |
| Масштабирование | `@hocuspocus/extension-redis` 4.6.0 (MIT) + Redis | medium-high |
| Offline | `y-indexeddb` 9.0.12 (MIT) | high |
| Track changes | **Собственный плагин на марках+атрибутах узлов** внутри Y.Doc; кодовая база-донор — `@handlewithcare/prosemirror-suggest-changes` 0.1.8 (MIT) | medium-high |
| Комментарии | Собственный ThreadStore в Postgres + relative positions Yjs (или `@blocknote/core/comments`, MPL-2.0) | medium |
| История версий | Явные **редакции** = immutable `Y.encodeStateAsUpdateV2` blob в Postgres. **НЕ** полагаться на `gc:false` | high |
| Диффы | `prosemirror-changeset` 2.4.1 (MIT) для структурного diff + собственный маппер в **таблицу поправок** | high |
| DOCX | **`docx` 9.7.1 (MIT)** — включая нативные `InsertedTextRun`/`DeletedTextRun` (реальные Word-правки) и комментарии | high |
| PDF | **DOCX → LibreOffice headless (`soffice --convert-to pdf`)**; Puppeteer только для HTML-отчётов | medium-high |
| PPTX | `pptxgenjs` 4.0.1 (MIT) | high |
| AI-правки | Все правки агента вносятся **в режиме поправок** от лица `agent:*`; ничего не пишется в текст напрямую | high |

**Оценка лицензионных затрат при рекомендованном варианте: 0 ₽/год.** Все зависимости — MIT/Apache-2.0/MPL-2.0.

---

## 1. Block editors: сравнение

### 1.1 Версии и лицензии (VERIFIED — `npm view <pkg> version license`, 2026-08-20)

| Пакет | Версия | Лицензия |
|---|---|---|
| `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit` | `3.30.2` | MIT |
| `@tiptap/extension-collaboration` | `3.30.2` | MIT |
| `@tiptap/extension-collaboration-caret` | `3.30.2` | MIT |
| `@tiptap/y-tiptap` | `3.0.9` | MIT |
| `@tiptap-pro/extension-track-changes` | **404 на публичном npm** | приватный реестр |
| `@tiptap-pro/extension-collaboration-history` | **404** | приватный реестр |
| `@tiptap-pro/extension-ai`, `@tiptap-pro/extension-comments` | **404** | приватный реестр |
| `@blocknote/core`, `@blocknote/react` | `0.54.0` | **MPL-2.0** |
| `@blocknote/server-util` | `0.54.0` | MPL-2.0 |
| `@blocknote/xl-docx-exporter` | `0.54.0` | **`GPL-3.0 OR PROPRIETARY`** |
| `@blocknote/xl-pdf-exporter` | `0.54.0` | **`GPL-3.0 OR PROPRIETARY`** |
| `@blocknote/xl-odt-exporter`, `@blocknote/xl-email-exporter` | `0.54.0` | **`GPL-3.0 OR PROPRIETARY`** |
| `@blocknote/xl-ai` | `0.54.0` | **`GPL-3.0 OR PROPRIETARY`** |
| `@blocknote/xl-multi-column` | `0.54.0` | **`GPL-3.0 OR PROPRIETARY`** |
| `platejs`, `@platejs/core` | `53.3.7` | MIT |
| `@platejs/suggestion` | `53.2.3` | MIT |
| `@platejs/yjs` | `53.2.0` | MIT |
| `@platejs/docx` | `53.0.0` | MIT (импорт DOCX→Slate) |
| `lexical`, `@lexical/yjs` | `0.49.0` | MIT |
| `prosemirror-model` / `-state` / `-view` / `-transform` | `1.25.11` / — / `1.42.2` / `1.12.0` | MIT |
| `prosemirror-changeset` | `2.4.1` | MIT |
| `@handlewithcare/prosemirror-suggest-changes` | `0.1.8` | MIT |
| `prosemirror-suggestion-mode` | `1.0.79` | MIT |

> **Ключевой факт по BlockNote (VERIFIED):** ядро — MPL-2.0 (годится для проприетарного продукта:
> копилефт на уровне файла, обязательства возникают только если вы правите файлы самого BlockNote).
> Но **все XL-пакеты** (`packages/xl-*` → `@blocknote/xl-*`) — `GPL-3.0 OR PROPRIETARY`
> ([README BlockNote](https://github.com/TypeCellOS/BlockNote/blob/main/README.md);
> `license` в `package.json` каждого пакета). GPL-3.0 в SPA, отдаваемой браузеру пользователя,
> — это распространение → требование раскрыть исходники всего приложения.
> Коммерческая лицензия на XL входит в тариф **Business — $195/мес (или $2 340/год)**
> ([blocknotejs.org/pricing](https://www.blocknotejs.org/pricing)). Ограничений по числу документов/пользователей нет.

> **Ключевой факт по Tiptap (VERIFIED):** ядро и коллаборация — MIT и работают с любым Yjs-провайдером,
> включая self-hosted Hocuspocus. Но **Track Changes, Comments, Document History, AI, DOCX-конвертация**
> живут в приватном реестре `@tiptap-pro/*` (публичный npm отдаёт 404) и требуют активной подписки.
> Тарифы ([tiptap.dev/pricing](https://tiptap.dev/pricing), проверено 2026-08-20):
> Start **$59/мес** (500 облачных документов/окружение, 2 dev-лицензии), Team **$179/мес** (5 000 док.),
> Business **$1 199/мес** (50 000 док.), Enterprise — по запросу.
> **Tracked Changes — отдельный платный add-on с custom pricing.**
> **On-premises deployment есть только в Enterprise.** Доп. dev-лицензия — $49/мес.

### 1.2 Матрица под наши требования

| Критерий | Tiptap v3 (MIT-only) | BlockNote 0.54 | Plate 53 (Slate) | Lexical 0.49 | ProseMirror напрямую |
|---|---|---|---|---|---|
| Notion-подобный блочный UX «из коробки» | нет (строим сами: drag-handle, slash-menu, block-menu) | **да, лучший в классе** | да | частично | нет |
| Основа | ProseMirror | ProseMirror (через Tiptap v3, dep `@tiptap/core ^3.29.2` — VERIFIED) | Slate | своё дерево | — |
| Кастомные узлы (`статья`/`часть`/`пункт`) | **полный контроль над PM-схемой** | `createReactBlockSpec()` — блоки плоские, вложенность только через `children` | `createPlatePlugin` | `DecoratorNode` | полный контроль |
| Строгая иерархия узлов (`content: "часть+"`) | **да, PM `content` expressions** | ограничено моделью блоков BlockNote | Slate normalizers, слабее | вручную | да |
| Collaborative editing | `@tiptap/extension-collaboration` + `@tiptap/y-tiptap` (MIT) | `withCollaboration()` из `@blocknote/core/yjs` (MPL) | `@platejs/yjs` → `slate-yjs` | `@lexical/yjs` | `y-prosemirror` |
| Зрелость CRDT-биндинга | **высокая** (форк y-prosemirror, MIT) | высокая (тот же y-prosemirror) | **средняя** — slate-yjs исторически хрупче на структурных операциях (UNVERIFIED, репутационный аргумент) | средняя | высокая |
| Комментарии / треды | Pro (платно) **или** свой плагин | **есть в MPL-ядре**: `@blocknote/core/comments` → `CommentsExtension`, `YjsThreadStore`, `RESTYjsThreadStore`, `ThreadStoreAuth` (VERIFIED — `dist/comments.js` присутствует в MPL-пакете) | `@platejs/suggestion` + discussion (pro-компонент платный) | нет | свой |
| **Track changes / режим поправок** | **Pro, платно (custom pricing)** | **нет** (открытый issue [#1464](https://github.com/TypeCellOS/BlockNote/issues/1464)) | **`@platejs/suggestion` — MIT, inline + block-level** | нет | `@handlewithcare/prosemirror-suggest-changes` (MIT) |
| Экспорт DOCX | Pro/hosted REST | `@blocknote/xl-docx-exporter` — **GPL/платно**; внутри использует `docx` npm | `@platejs/docx` — только **импорт** | нет | `docx` напрямую |
| Экспорт PDF | Pro | `@blocknote/xl-pdf-exporter` — GPL/платно | нет | нет | своё |
| AI | Pro (AI Toolkit, custom pricing) | `@blocknote/xl-ai` — GPL/платно | `@platejs/ai` MIT | нет | своё |
| Стоимость при нашем сценарии | **0 ₽** (только MIT-часть) | **0 ₽** если не трогать XL; иначе $2 340/год | 0 ₽ | 0 ₽ | 0 ₽ |

### 1.3 Рекомендация

> **Строим на Tiptap v3 (MIT) поверх ProseMirror, с собственным блочным UI и собственным
> слоем режима поправок. BlockNote держим как «библиотеку идей» и как fallback для
> вспомогательных документов (пояснительная записка, ФЭО), где Notion-UX ценнее строгой схемы.**

Обоснование:

1. **Текст закона — это не «блоки», это дерево с грамматикой.** `статья` содержит `часть+`,
   `часть` содержит `текст` и `пункт*`, `пункт` содержит `подпункт*`. ProseMirror `content`-expressions
   выражают это декларативно и валидируют инвариант при каждой транзакции. Модель BlockNote (плоский
   список блоков + `children`) этого не даёт — пришлось бы дублировать нормализацию.
2. **Режим поправок — mandatory, а у всех «готовых» решений он платный или отсутствует.**
   Значит, его в любом случае пишем сами. Тогда преимущество BlockNote/Tiptap-Pro «из коробки» испаряется,
   а остаётся только их ограничение схемы.
3. **Ни одна лицензия XL/Pro не переживает поставку госзаказчику в РФ.** GPL-3.0 в клиентском бандле =
   раскрытие исходников; подписка Tiptap = зависимость от иностранного вендора, приватного npm-реестра
   (нужен сетевой доступ к `registry.tiptap.dev` из контура сборки) и валютных платежей.
   Это архитектурный риск, а не только денежный.
4. **BlockNote-комментарии (MPL) — реально полезны.** Если Notion-UX окажется критичным для
   не-нормативных документов, MPL-ядро BlockNote можно взять целиком, а XL — не ставить вовсе.
   Экспорт в DOCX всё равно пишем сами на `docx` (MIT), т.к. нам нужны шаблоны ГД, а не generic-маппинг.

**Если заказчик всё же хочет Notion-UX для законопроекта:** берём BlockNote MPL-ядро,
XL не устанавливаем, экспорт/AI/track-changes пишем поверх. Стоимость по-прежнему 0 ₽,
но теряем строгость схемы — придётся писать `normalize`-плагин руками.

### 1.4 Схема ProseMirror для нормативного текста

```ts
// packages/legal-editor/src/schema/nodes.ts
import { Node as PMNode } from '@tiptap/pm/model'

// Все структурные узлы несут stableId — это первичный ключ для:
//   ссылок (§ ст.5 ч.2 п.3), диффов, привязки поправок, привязки комментариев, RAG-чанков.
// НОМЕР В АТРИБУТАХ НЕ ХРАНИТСЯ (см. 1.5).
const structuralAttrs = {
  sid:        { default: null },  // nanoid(12), стабилен на всю жизнь узла
  numManual:  { default: null },  // "15.1" — когда номер задан целевым законом, а не вычислен
  suggestion: { default: null },  // { id, type: 'insert'|'delete', userId, at } — блочная поправка
}

export const nodes = {
  doc:      { content: 'titleBlock preamble? (razdel | glava | statya)+ ' },
  razdel:   { group: 'structural', content: 'heading? glava+',      attrs: structuralAttrs },
  glava:    { group: 'structural', content: 'heading? statya+',     attrs: structuralAttrs },
  statya:   { group: 'structural', content: 'statyaTitle? chast+',  attrs: structuralAttrs },
  chast:    { group: 'structural', content: 'abzac+ punkt*',        attrs: structuralAttrs },
  punkt:    { group: 'structural', content: 'abzac+ podpunkt*',     attrs: structuralAttrs },
  podpunkt: { group: 'structural', content: 'abzac+',               attrs: structuralAttrs },
  abzac:    { content: 'inline*', attrs: { sid: { default: null } } },
  // ...
}
```

Марки для режима поправок и комментариев:

```ts
export const marks = {
  // не исключают друг друга → y-prosemirror трактует их как overlapping marks
  // (VERIFIED: ProsemirrorBinding.isOMark: Map<MarkType, boolean> в y-prosemirror/src/plugins/sync-plugin.js)
  suggInsert: { excludes: '', attrs: { id: {}, userId: {}, at: {}, batchId: { default: null } } },
  suggDelete: { excludes: '', attrs: { id: {}, userId: {}, at: {}, batchId: { default: null } } },
  comment:    { excludes: '', attrs: { threadId: {} }, inclusive: false },
  // 'ychange' — служебная марка y-prosemirror для рендера снапшот-диффа, добавить обязательно
  ychange:    { excludes: '', attrs: { user: { default: null }, type: { default: null }, color: { default: null } } },
}
```

> `ychange` — не наша выдумка: `y-prosemirror` при рендере снапшота проставляет атрибут/марку `ychange`
> со значением `{ user, type: 'added'|'removed', color }` (VERIFIED — `_renderSnapshot()`/`computeYChange()`
> в `y-prosemirror@1.3.7/src/plugins/sync-plugin.js`). Без этого узла/марки в схеме сравнение версий не отрендерится.

### 1.5 Автонумерация статья/часть/пункт — решение

**Не хранить номера в документе.** Номера — производная функция от позиции узла в дереве.
Хранение номера в атрибуте узла в CRDT-документе даёт:
(а) write amplification — вставка одной статьи переписывает атрибуты всех последующих;
(б) конфликты — два клиента одновременно пересчитывают нумерацию;
(в) расхождение с сервером при экспорте.

**Решение: чистая функция + widget-декорации.**

```ts
// packages/legal-editor/src/numbering/compute.ts
export type NumberingLabel = { pos: number; sid: string; label: string; path: string }

/** Чистая, изоморфная (браузер + сервер) функция. Единственный источник истины по нумерации. */
export function computeNumbering(doc: PMNode): NumberingLabel[] {
  const out: NumberingLabel[] = []
  // сквозные счётчики
  let razdel = 0, glava = 0, statya = 0
  const stack: number[] = []           // счётчики частей/пунктов/подпунктов текущего уровня

  doc.descendants((node, pos, parent, index) => {
    switch (node.type.name) {
      case 'razdel':
        razdel++
        out.push({ pos, sid: node.attrs.sid, label: toRoman(razdel), path: `р.${toRoman(razdel)}` })
        break
      case 'glava':
        glava++          // главы нумеруются сквозно по всему закону
        out.push({ pos, sid: node.attrs.sid, label: `${glava}`, path: `гл.${glava}` })
        break
      case 'statya':
        statya++         // статьи — СКВОЗНАЯ нумерация по всему закону, НЕ перезапускается в главе
        out.push({
          pos, sid: node.attrs.sid,
          label: node.attrs.numManual ?? `${statya}`,   // "15.1" при дополнении действующего закона
          path: `ст.${node.attrs.numManual ?? statya}`,
        })
        break
      case 'chast':      // "1." — арабская с точкой
      case 'punkt':      // "1)" — арабская со скобкой
      case 'podpunkt':   // "а)" — строчная буква со скобкой
        out.push(makeChildLabel(node, parent!, index, out))
        break
    }
    return true
  })
  return out
}

const RU_LETTERS = 'абвгдежзиклмнопрстуфхцчшщэюя'  // без ё, й, ъ, ы, ь — по практике ГД (UNVERIFIED, уточнить)
```

Рендер — плагин с `DecorationSet` из widget-декораций; ноль записей в Y.Doc:

```ts
export const numberingPlugin = new Plugin({
  key: new PluginKey('legalNumbering'),
  state: {
    init: (_, s) => buildDecos(s.doc),
    apply: (tr, old) => (tr.docChanged ? buildDecos(tr.doc) : old),
  },
  props: { decorations: (s) => numberingPlugin.getState(s) },
})

function buildDecos(doc: PMNode) {
  return DecorationSet.create(doc, computeNumbering(doc).map(n =>
    Decoration.widget(n.pos + 1, () => renderLabelSpan(n.label), { side: -1, key: `num:${n.sid}:${n.label}` })
  ))
}
```

Та же `computeNumbering()` вызывается:
- в NestJS при экспорте в DOCX (номера физически пишутся в .docx как текст, не как Word-numbering —
  так документ переживает любое копирование в Word аппаратом ГД);
- при построении `path` для чанков RAG (`ст.5 ч.2 п.3`) — см. `04-retrieval.md`;
- при генерации таблицы поправок (колонка «Текст законопроекта, принятого в первом чтении»).

**Исключение `numManual`.** Законопроект «О внесении изменений в …» оперирует номерами
целевого закона (`статью 15.1 дополнить …`). Там автонумерация должна быть выключена:
`numManual` задаётся при импорте текста действующего закона и правится вручную.
UI: переключатель «Нумерация: автоматическая / из целевого закона» на уровне документа.

---

## 2. Yjs: провайдеры, персистентность, presence, offline

### 2.1 Пакеты (VERIFIED)

| Пакет | Версия | Лицензия | Комментарий |
|---|---|---|---|
| `yjs` | `13.6.32` | MIT | ветка v13. **Не брать `@y/y@14.0.0-rc.*`** — RC, Hocuspocus 4 peer-депендится на `yjs ^13.6.8` |
| `y-protocols` | `1.0.7` | MIT | Hocuspocus 4 peer: `^1.0.6` |
| `y-prosemirror` | `1.3.7` | MIT | peer: `prosemirror-{model,state,view}`, `y-protocols ^1.0.1`, `yjs ^13.5.38` |
| `@tiptap/y-tiptap` | `3.0.9` | MIT | форк y-prosemirror от Tiptap; **тот же экспортный набор** + `findAbsolutePositionAfterStructuralChange`, `isMisresolvedTextPosition`, `isStructuralTransaction` (VERIFIED — `dist/src/y-tiptap.d.ts`) |
| `y-websocket` | `3.1.0` | MIT | **в v3 `bin` пуст** — сервера в пакете больше нет (VERIFIED: `npm view y-websocket@1.5.4 bin` → `{y-websocket: 'bin/server.js'}`, в 3.1.0 `bin: {}`) |
| `y-indexeddb` | `9.0.12` | MIT | `IndexeddbPersistence(name, doc)`, `.whenSynced`, `PREFERRED_TRIM_SIZE = 500` |
| `@hocuspocus/server` | `4.6.0` | MIT | deps: `crossws ^0.4.4`, `async-mutex`, `lib0`; peer: `yjs ^13.6.8`, `y-protocols ^1.0.6` |
| `@hocuspocus/provider` | `4.6.0` | MIT | |
| `@hocuspocus/extension-database` | `4.6.0` | MIT | |
| `@hocuspocus/extension-redis` | `4.6.0` | MIT | |
| `y-postgresql` | `1.0.1` | MIT | адаптер под `y-websocket`, не под Hocuspocus |
| `y-redis` | `1.0.3` | MIT | старый |
| `@y/redis` | `0.1.6` | **`AGPL-3.0 OR PROPRIETARY`** | ⛔ **отклонено** — AGPL на серверном компоненте |
| `y-supabase` | `0.0.4-7-alpha`, последняя публикация **2023-02-07** | MIT | ⛔ **заброшен**, alpha |
| `@liveblocks/yjs` | `3.24.1` | Apache-2.0 | ⛔ SaaS, зарубежный |
| `y-partykit` | `0.0.33` | ISC | ⛔ привязан к Cloudflare |
| `@y-sweet/sdk` | `0.9.1` | MIT | сервер на Rust, self-hostable; но экосистема моложе Hocuspocus |

### 2.2 Выбор провайдера

| Провайдер | Self-host | Auth | Персистентность | Вердикт |
|---|---|---|---|---|
| **Hocuspocus 4.6.0** | ✅ Node/Bun/Deno, Docker | ✅ `onAuthenticate` (JWT), `onTokenSync` для refresh | ✅ `Database` extension = произвольный Postgres | **ВЫБРАН** |
| `y-websocket` 3.1.0 | ⚠️ сервер надо писать самому (bin удалён) | ручной | ручная | fallback, если Hocuspocus избыточен |
| y-sweet (self-hosted) | ✅ Rust-бинарь | токены | S3/файлы | альтернатива; меньше хуков, слабее интеграция с нашей ACL |
| **Supabase Realtime как Yjs-провайдер** | ✅ (входит в self-hosted стек) | ✅ RLS/JWT | ❌ нет | ⛔ **отклонено**, см. ниже |
| Liveblocks / PartyKit / Tiptap Cloud | ❌ | — | — | ⛔ нарушают суверенитет данных |

**Почему Supabase Realtime не годится провайдером Yjs (важно — это был вариант в исходном стеке):**

1. Единственная реализация `y-supabase` — `0.0.4-7-alpha`, последний релиз февраль 2023 (VERIFIED, npm).
   Автор прямо предупреждает о «rough edges». В проде это неприемлемо.
2. Broadcast — **fire-and-forget**. Yjs требует гарантии *eventual* доставки каждого update и корректного
   initial sync (обмен state vectors). Broadcast не гарантирует ни того, ни другого при реконнекте;
   пришлось бы городить собственный sync-протокол поверх — то есть переписать Hocuspocus.
3. Лимит сообщения Realtime — **256 КБ** ([supabase.com/docs/guides/realtime/limits](https://supabase.com/docs/guides/realtime/limits)).
   Initial sync большого законопроекта (кодекс) — это мегабайты; нужна ручная чанковка.
4. Нет серверного узла, который держит авторитетный Y.Doc → некуда воткнуть серверную валидацию,
   awareness-GC и debounce-персистентность.

**Но Supabase Realtime отлично подходит для НЕ-CRDT presence-каналов:** «кто открыл документ»,
«кто сейчас в комитете», уведомления о новом заключении. Используем его именно так,
а внутридокументное awareness (курсоры/выделения) — через Hocuspocus.

### 2.3 Архитектура self-hosted collab-сервиса

```
                    ┌───────────────────────────────────────────┐
  Браузер           │        apps/collab  (Node 22, Docker)     │
 ┌──────────────┐   │   @hocuspocus/server 4.6.0                │
 │ Tiptap v3    │   │                                           │
 │ y-tiptap     │   │  extensions:                              │
 │ HocuspocusProvider ──ws (JWT)──► onAuthenticate ──► verify JWT (Supabase JWKS)
 │ y-indexeddb  │   │                     │           └─► SELECT acl WHERE doc_id/user_id
 └──────────────┘   │                     ▼                     │
        │           │             connection.readOnly = !canEdit│
        │           │                                           │
        │           │  Redis extension ◄──────────► Redis  (fan-out между инстансами)
        │           │  Database extension                       │
        │           │      fetch ──► SELECT update_v2 …         │
        │           │      store ──► INSERT doc_update  ────────┼──► Postgres (Supabase)
        │           │  debounce: 2000ms, maxDebounce: 10000ms   │
        └───────────┤  yDocOptions: { gc: true }                │
                    └───────────────────────────────────────────┘
                                        │
                    ┌───────────────────▼───────────────────────┐
                    │ apps/api (NestJS)                          │
                    │  • POST /docs/:id/versions  (создать редакцию)
                    │  • GET  /docs/:id/diff?from=&to=            │
                    │  • POST /docs/:id/amendments (породить поправку)
                    │  • POST /export/docx|pdf|pptx               │
                    │  • cron: компакция doc_update               │
                    └────────────────────────────────────────────┘
```

**Почему отдельный сервис, а не внутри NestJS:** Hocuspocus 4 держит Y.Doc в памяти процесса;
у него собственный жизненный цикл (unload по debounce), собственный профиль памяти и собственные
требования к масштабированию (Redis fan-out, никакой sticky-session не нужен, но нужен свой HPA).
Смешивать с REST-API — значит связать их деплой-циклы и OOM-риски.

> При этом встроить *можно*: `hocuspocus.handleConnection(ws, request, defaultContext)` —
> публичный метод (VERIFIED: `handleConnection(incoming: WebSocket | WebSocketLike, request: Request, defaultContext?: Context): ClientConnection`
> в `@hocuspocus/server@4.6.0/dist/index.d.ts`). Это путь для dev-режима (один процесс).

### 2.4 Сервер: код

```ts
// apps/collab/src/main.ts
import { Server } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { Redis } from '@hocuspocus/extension-redis'
import { Logger } from '@hocuspocus/extension-logger'
import * as Y from 'yjs'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { pool } from './db'

type Ctx = {
  userId: string
  fullName: string
  role: 'deputy' | 'assistant' | 'committee_staff' | 'expert' | 'agent'
  canEdit: boolean
  canSuggest: boolean
}

const JWKS = createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL!))

const server = new Server<Ctx>({
  name: 'doomatel-collab',
  port: Number(process.env.PORT ?? 8787),

  // Персистить не чаще, чем раз в 2 c; но не реже, чем раз в 10 c.
  // VERIFIED: Configuration.debounce / Configuration.maxDebounce в @hocuspocus/server@4.6.0
  debounce: 2_000,
  maxDebounce: 10_000,

  // Не выгружать документ мгновенно — иначе клиент может DOS-ить persist-хук
  // реконнектами. VERIFIED: Configuration.unloadImmediately (docstring в d.ts).
  unloadImmediately: false,

  // GC ВКЛЮЧЁН. Историю ведём явными редакциями (см. §4), а не через gc:false.
  yDocOptions: { gc: true, gcFilter: () => true },

  // Защита от неаутентифицированного flood — новое в v4 (GHSA-xwhh-v746-pj9m).
  maxUnauthenticatedQueueSize: 1 << 20,       // 1 MiB (дефолт 5 MiB)
  maxUnauthenticatedQueueMessages: 200,
  maxPendingDocuments: 8,

  async onAuthenticate({ token, documentName, connection }) {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.SUPABASE_ISS,
      audience: 'authenticated',
    })
    const userId = payload.sub as string

    const docId = parseDocumentName(documentName)   // "legal:<uuid>" | "note:<uuid>"
    const { rows } = await pool.query<{ permission: string; full_name: string; role: Ctx['role'] }>(
      `select a.permission, p.full_name, p.role
         from doc_acl a
         join profiles p on p.id = a.user_id
        where a.doc_id = $1 and a.user_id = $2`,
      [docId, userId],
    )
    if (!rows.length) throw new Error('forbidden')

    const perm = rows[0].permission            // 'owner'|'edit'|'suggest'|'comment'|'read'
    const canEdit = perm === 'owner' || perm === 'edit'
    const canSuggest = canEdit || perm === 'suggest'

    // 'comment'/'read' → сервер физически отклонит любые update-сообщения.
    // VERIFIED: ConnectionConfiguration.readOnly в d.ts; onAuthenticate-пример в Hocuspocus docs.
    connection.readOnly = !canSuggest

    return { userId, fullName: rows[0].full_name, role: rows[0].role, canEdit, canSuggest }
  },

  extensions: [
    new Logger(),
    new Redis({ host: process.env.REDIS_HOST!, port: 6379 }),
    new Database({
      // VERIFIED сигнатуры: fetch: (data: fetchPayload) => Promise<Uint8Array|null>
      //                     store: (data: storePayload) => Promise<void>, storePayload.state: Buffer
      fetch: async ({ documentName }) => {
        const docId = parseDocumentName(documentName)
        const { rows } = await pool.query<{ update_v2: Buffer }>(
          `select update_v2 from doc_update where doc_id = $1 order by seq asc`, [docId],
        )
        if (!rows.length) return null
        return rows.length === 1
          ? new Uint8Array(rows[0].update_v2)
          : Y.mergeUpdatesV2(rows.map(r => new Uint8Array(r.update_v2)))
      },
      store: async ({ documentName, state, document, lastContext }) => {
        const docId = parseDocumentName(documentName)
        // state — это encodeStateAsUpdate (v1). Пересобираем в v2 ради компактности.
        const v2 = Y.encodeStateAsUpdateV2(document)
        await pool.query(
          `insert into doc_update (doc_id, update_v2, byte_len, author_id)
           values ($1, $2, $3, $4)`,
          [docId, Buffer.from(v2), v2.byteLength, (lastContext as Ctx | undefined)?.userId ?? null],
        )
      },
    }),
  ],

  // Аудит — обязателен для госконтура. Пишем «кто менял», не сам контент.
  async onStoreDocument({ documentName, clientsCount, lastContext }) {
    audit.log('doc.persisted', { documentName, clientsCount, userId: (lastContext as Ctx)?.userId })
  },
})

server.listen()
```

> **Нюанс `store`:** `storePayload.state` — это `Buffer` полного состояния в формате **v1**
> (VERIFIED: `interface storePayload extends onStoreDocumentPayload { state: Buffer }`).
> Мы намеренно игнорируем его и делаем `Y.encodeStateAsUpdateV2(document)` — v2-кодирование
> заметно компактнее на длинных текстовых документах (UNVERIFIED: точный выигрыш надо померить
> на реальном законопроекте; в литературе называют 2–10× на update-логах).

**Схема Postgres:**

```sql
-- Документы (законопроект, ПЗ, ФЭО, поправка, выступление, …)
create table legal_doc (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in
                  ('zakonoproekt','poyasnitelnaya_zapiska','feo','perechen_aktov',
                   'popravka','tablitsa_popravok','vystuplenie','zaklyuchenie')),
  bill_id       uuid references bill(id),           -- связь с карточкой СОЗД
  parent_doc_id uuid references legal_doc(id),      -- ПЗ → законопроект
  title         text not null,
  numbering_mode text not null default 'auto'
                  check (numbering_mode in ('auto','manual')),
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- Append-only лог Yjs-апдейтов. Одна строка = один store-flush Hocuspocus.
create table doc_update (
  seq        bigserial primary key,
  doc_id     uuid not null references legal_doc(id) on delete cascade,
  update_v2  bytea  not null,
  byte_len   int    not null,
  author_id  uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index doc_update_doc_seq_idx on doc_update (doc_id, seq);

-- Именованные редакции (§4). Immutable.
create table doc_version (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references legal_doc(id) on delete cascade,
  label       text not null,                -- 'Внесён', 'Первое чтение', 'ко II чтению, ред. 3'
  reading     smallint,                     -- 1 | 2 | 3 | null
  snapshot_v2 bytea not null,               -- Y.encodeStateAsUpdateV2(doc) целиком
  pm_json     jsonb not null,               -- денормализованный ProseMirror JSON — для FTS/diff без Yjs
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  unique (doc_id, label)
);

-- ACL
create table doc_acl (
  doc_id     uuid not null references legal_doc(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  permission text not null check (permission in ('owner','edit','suggest','comment','read')),
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now(),
  primary key (doc_id, user_id)
);
```

**Компакция (cron в NestJS, раз в час или по порогу):**

```ts
// apps/api/src/collab/compaction.job.ts
// Схлопывает лог апдейтов в одну строку. Идемпотентно: результат мержа тех же апдейтов
// всегда эквивалентен. Выполняется ТОЛЬКО когда документ не открыт (clientsCount == 0),
// проверяем через Redis-ключ присутствия, который ставит Hocuspocus.
async function compact(docId: string) {
  const { rows } = await pool.query(
    `select seq, update_v2 from doc_update where doc_id = $1 order by seq asc`, [docId])
  if (rows.length < 2) return
  const merged = Y.mergeUpdatesV2(rows.map(r => new Uint8Array(r.update_v2)))
  const maxSeq = rows.at(-1)!.seq
  await pool.query('begin')
  await pool.query(`insert into doc_update (doc_id, update_v2, byte_len) values ($1,$2,$3)`,
                   [docId, Buffer.from(merged), merged.byteLength])
  await pool.query(`delete from doc_update where doc_id = $1 and seq <= $2`, [docId, maxSeq])
  await pool.query('commit')
}
```

> **Почему append-only + компакция, а не `UPDATE ... SET state = $1`:**
> (1) `UPDATE` большого `bytea` в Postgres — это TOAST-перезапись + раздувание таблицы, каждые 2 секунды;
> (2) append-only даёт бесплатный «чёрный ящик» — при повреждении последнего апдейта откатываемся на предыдущий;
> (3) `Y.mergeUpdatesV2()` — публичная и стабильная функция (VERIFIED: `yjs@13.6.32/dist/src/utils/updates.d.ts`).

### 2.5 Клиент

```ts
// apps/web/src/editor/useCollabEditor.ts
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { useEditor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'

export function useCollabEditor(docId: string, accessToken: string, me: User) {
  const ydoc = useMemo(() => new Y.Doc(), [docId])

  // offline-first: локальная копия читается мгновенно, до установления ws
  const idb = useMemo(() => new IndexeddbPersistence(`doomatel:${docId}`, ydoc), [docId])

  const provider = useMemo(() => new HocuspocusProvider({
    url: process.env.NEXT_PUBLIC_COLLAB_WS!,    // wss://collab.internal/…
    name: `legal:${docId}`,
    document: ydoc,
    token: accessToken,                         // → onAuthenticate({ token })
    onAuthenticationFailed: () => router.push('/403'),
  }), [docId])

  // PermanentUserData — нужен, чтобы в диффе версий было видно АВТОРА фрагмента,
  // а не безликий clientId. VERIFIED: new Y.PermanentUserData(doc, storeType?)
  //   .setUserMapping(doc, clientid, userDescription, { filter? })
  //   .getUserByClientId(clientid) / .getUserByDeletedId(id)
  const pud = useMemo(() => {
    const p = new Y.PermanentUserData(ydoc)
    p.setUserMapping(ydoc, ydoc.clientID, me.id)
    return p
  }, [ydoc, me.id])

  return useEditor({
    extensions: [
      LegalKit,                                  // наша схема + нумерация + режим поправок
      Collaboration.configure({
        fragment: ydoc.getXmlFragment('legal'),
        // ySyncPlugin получит permanentUserData; VERIFIED YSyncOpts:
        //   { colors, colorMapping, permanentUserData, mapping, onFirstRender }
      }),
      CollaborationCaret.configure({
        provider,
        user: { id: me.id, name: me.fullName, color: colorForUser(me.id) },
      }),
    ],
  })
}
```

**Presence / awareness.** `awareness` живёт в `provider.awareness` (`y-protocols/awareness`).
Кладём туда `{ user: {id,name,color,role}, cursor, activeSid }`. Hocuspocus прокидывает
`onAwarenessUpdate({ added, updated, removed, states })` — используем на сервере для
серверного списка «кто в документе» и для аудита.

**Offline.** `y-indexeddb` + `provider.on('status')`. Правки в офлайне копятся в IndexedDB,
при реконнекте Yjs сливает их без конфликтов. **Ограничение для юристов:** если документ
за время офлайна был «заморожен» (создана редакция «внесён в ГД»), офлайн-правки всё равно
вольются. Поэтому заморозка редакции = `doc_acl.permission → 'read'` + `connection.readOnly`
на сервере, а не только UI-флаг.

---

## 3. Режим поправок (track changes) поверх Yjs

### 3.1 Что есть в open source

| Решение | Версия | Лицензия | Модель | Yjs | Вердикт |
|---|---|---|---|---|---|
| `@tiptap-pro/extension-track-changes` | n/a | проприетарная, платный add-on | — | да | ⛔ платно + приватный реестр |
| **`@handlewithcare/prosemirror-suggest-changes`** | `0.1.8` | **MIT** | марки `insertion`/`deletion`/`modification` + `blockBoundarySuggestion`; `suggestChanges()`, `withSuggestChanges()`, `applySuggestion()`, `revertSuggestion()`, `applySuggestions()`, `revertSuggestions()`, `toggleSuggestChanges()`, `isSuggestChangesEnabled()`, `selectSuggestion()`; опции `extraAttrs` (для userId) и `preventJoin` | явно не заявлен | **лучший донор кода** |
| `prosemirror-suggestion-mode` | `1.0.79` | MIT | марки `suggestion_insert`/`suggestion_delete`, `suggestionModePlugin`, `acceptSuggestionsInRange`, `rejectAllSuggestions`, `applySuggestion` (для AI), hover-меню | не заявлен | хорош для inline, **блочные изменения не покрыты** |
| `prosemirror-suggestions` (quartzy) | `0.2.0` | Apache-2.0 | это про @-mention triggers, **не** track changes | — | не то |
| `nytimes/prosemirror-change-tracking-prototype` | — | прототип | ChangeSet-based | нет | референс |
| `@platejs/suggestion` | `53.2.3` | MIT | `suggestion_<id>` на текстовых нодах + `suggestion` prop на элементах; inline **и** block-level (`type: 'insert' \| 'remove'`) | Slate/slate-yjs | лучший OSS, но привязан к Slate |
| `y-prosemirror` snapshots (`ychange`) | `1.3.7` | MIT | diff двух снапшотов, атрибут/марка `ychange = {user,type,color}` | **нативно** | **для сравнения версий, не для accept/reject** |

**Вывод:** готового «track changes на Yjs» в OSS нет. Ближайший рабочий код — `@handlewithcare/prosemirror-suggest-changes`
(MIT, ProseMirror-нативный, есть блочные границы). Берём его модель и адаптируем под наши требования
(авторство, батчи, юридические типы поправок).

### 3.2 Почему марки, а не отдельный CRDT-слой

Ключевое свойство: **поправка должна быть частью документа, а не метаданными рядом с ним.**
Если хранить suggestions вне Y.Doc (в Postgres, привязанными к позициям), то при любой конкурентной
правке позиции «уплывают» — придётся вести relative positions и постоянно их чинить.
Если хранить внутри Y.Doc как марки и атрибуты узлов — Yjs сам делает позиционную математику,
это его основная работа.

Механика:
- **Вставка в режиме поправок** → текст реально вставляется, но получает марку `suggInsert`.
- **Удаление в режиме поправок** → текст **не удаляется**, получает марку `suggDelete`
  (в CSS — зачёркнутый; можно свернуть в компактный маркер).
- **Блочные операции** (добавить статью, исключить часть) → атрибут `suggestion` на узле
  (`{ id, type:'insert'|'delete', userId, at, batchId }`), узел физически остаётся в дереве.
- **Принять** → снять `suggInsert` / физически удалить `suggDelete`-диапазон и `suggestion:'delete'`-узлы.
- **Отклонить** → обратное.

y-prosemirror синхронизирует марки как форматирование `Y.XmlText`, а атрибуты узлов — как атрибуты
`Y.XmlElement`. Обе операции коммутативны в CRDT. Марки с `excludes: ''` (overlapping) поддерживаются
биндингом явно — `ProsemirrorBinding.isOMark: Map<MarkType, boolean>` (VERIFIED, `sync-plugin.js`).

### 3.3 Реализация

```ts
// packages/legal-editor/src/suggest/plugin.ts
import { Plugin, PluginKey, EditorState, Transaction } from '@tiptap/pm/state'
import { ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform'

export const suggestKey = new PluginKey<SuggestState>('legalSuggest')

export type SuggestState = {
  enabled: boolean
  userId: string
  batchId: string                 // одна «сессия правки» = одна будущая поправка
}

/**
 * Перехватывает транзакции и переписывает их в «предложения».
 * Идея и структура позаимствованы у @handlewithcare/prosemirror-suggest-changes (MIT).
 */
export function suggestChangesPlugin(getUser: () => { id: string }) {
  return new Plugin<SuggestState>({
    key: suggestKey,
    state: {
      init: () => ({ enabled: false, userId: getUser().id, batchId: nanoid(12) }),
      apply: (tr, prev) => tr.getMeta(suggestKey) ?? prev,
    },

    // Ключевая точка: appendTransaction не годится (нельзя «отменить» уже применённый шаг).
    // Используем filterTransaction + перезапись через view.dispatch — или, как в
    // suggest-changes, оборачиваем dispatchTransaction. Второе надёжнее.
    filterTransaction(tr, state) {
      const s = suggestKey.getState(state)
      if (!s?.enabled) return true
      if (tr.getMeta('suggest:internal')) return true
      // Пропускаем только не-документные транзакции (selection, meta).
      return !tr.docChanged
    },
  })
}

/** Обёртка dispatchTransaction на уровне EditorView. */
export function withSuggestChanges(
  dispatch: (tr: Transaction) => void,
) {
  return (view: EditorView, tr: Transaction) => {
    const s = suggestKey.getState(view.state)
    if (!s?.enabled || !tr.docChanged) return dispatch(tr)
    dispatch(rewriteAsSuggestion(view.state, tr, s))
  }
}

function rewriteAsSuggestion(state: EditorState, tr: Transaction, s: SuggestState): Transaction {
  const out = state.tr.setMeta('suggest:internal', true)
  const attrs = { id: nanoid(12), userId: s.userId, at: new Date().toISOString(), batchId: s.batchId }
  const { suggInsert, suggDelete } = state.schema.marks

  for (const step of tr.steps) {
    if (step instanceof ReplaceStep) {
      const { from, to, slice } = step as any
      // 1) удаляемый диапазон → помечаем suggDelete, НЕ удаляем
      if (to > from) out.addMark(out.mapping.map(from), out.mapping.map(to), suggDelete.create(attrs))
      // 2) вставляемый контент → вставляем в конец помеченного диапазона с suggInsert
      if (slice.size > 0) {
        const at = out.mapping.map(to)
        out.replace(at, at, slice)
        out.addMark(at, at + slice.size, suggInsert.create(attrs))
      }
    } else if (step instanceof ReplaceAroundStep) {
      // структурные операции (обернуть в пункт, разбить часть) →
      // помечаем затронутые узлы атрибутом suggestion, а не марками
      markStructuralSuggestion(out, step, attrs)
    }
  }
  return out
}
```

Команды принятия/отклонения:

```ts
export const acceptSuggestion = (suggestionId: string): Command => (state, dispatch) => {
  const tr = state.tr.setMeta('suggest:internal', true)
  const { suggInsert, suggDelete } = state.schema.marks
  const ranges = findMarkRanges(state.doc, m => m.attrs.id === suggestionId)

  // Идём справа налево, чтобы позиции не съезжали
  for (const r of ranges.sort((a, b) => b.from - a.from)) {
    if (r.mark.type === suggInsert) tr.removeMark(r.from, r.to, suggInsert)
    else if (r.mark.type === suggDelete) tr.delete(r.from, r.to)
  }
  for (const n of findNodesWithSuggestion(state.doc, suggestionId).sort((a, b) => b.pos - a.pos)) {
    if (n.node.attrs.suggestion.type === 'delete') tr.delete(n.pos, n.pos + n.node.nodeSize)
    else tr.setNodeAttribute(n.pos, 'suggestion', null)
  }
  dispatch?.(tr)
  return true
}

export const rejectSuggestion = (suggestionId: string): Command => /* зеркально */ …
```

### 3.4 От «suggestion» к юридической поправке

Это то, чего нет ни в одном редакторе, и ради чего всё делается.

**Поправка по ст. 120 Регламента ГД бывает ровно трёх видов** (VERIFIED, текст ст. 120,
[base.garant.ru/1575717/…](https://base.garant.ru/1575717/cc073c9cb88a9742ae933f9f008c13bb/)):

> «Поправки к законопроекту, принятому в первом чтении, вносятся в ответственный комитет
> **в виде изменения редакции статей**, либо **в виде дополнения законопроекта конкретными статьями**,
> либо **в виде предложений об исключении конкретных слов, пунктов, частей или статей законопроекта**.»

При невыполнении требований ст. 120 ответственный комитет вправе **вернуть поправку автору
без включения её в таблицы поправок.** → Валидатор формы поправки — это не UX-мелочь, а функция,
предотвращающая формальный возврат.

```sql
create table popravka (
  id             uuid primary key default gen_random_uuid(),
  bill_id        uuid not null references bill(id),
  doc_id         uuid not null references legal_doc(id),      -- рабочий текст ко II чтению
  base_version_id uuid not null references doc_version(id),   -- «принят в первом чтении»
  batch_id       text not null,                               -- ← suggestion.batchId из редактора
  kind           text not null check (kind in
                   ('izmenenie_redakcii','dopolnenie','isklyuchenie')),  -- ст.120
  target_sid     text not null,        -- stableId структурной единицы
  target_path    text not null,        -- 'ст.5 ч.2 п.3' — человекочитаемо, на момент создания
  text_before    text,                 -- редакция первого чтения
  text_after     text,                 -- предлагаемая редакция (null при 'isklyuchenie')
  obosnovanie    text,                 -- краткое обоснование автора
  author_id      uuid not null references profiles(id),
  co_authors     uuid[] not null default '{}',
  submitted_at   timestamptz,
  -- решение ответственного комитета
  committee_decision text check (committee_decision in ('prinyat','otklonit','bez_resheniya','koncepciya')),
  committee_reason   text,
  table_no       smallint,             -- 1 | 2 | 3 | 4 — номер таблицы поправок
  decided_at     timestamptz
);
create index popravka_bill_idx on popravka (bill_id, table_no, target_sid);
```

`table_no` соответствует Регламенту (гл. 13): **таблица № 1** — рекомендуемые к принятию,
**№ 2** — рекомендуемые к отклонению, **№ 3** — по которым решений не принято,
**№ 4** — изменяющие концепцию законопроекта и рекомендуемые к отклонению
([Регламент ГД, гл. 13](http://duma.gov.ru/duma/about/regulations/chapter-13/)).

**Пайплайн:** редактор → `batchId` → сервис `AmendmentsService.materialize(batchId)`:
1. Собирает все suggestions с этим `batchId`.
2. Группирует по ближайшему предку-`statya` (поправка адресуется статье).
3. Классифицирует `kind`: только `suggInsert` на новом узле → `dopolnenie`;
   только `suggDelete` → `isklyuchenie`; смешанное → `izmenenie_redakcii`.
4. `text_before` берётся из `doc_version.pm_json` базовой редакции по `target_sid`;
   `text_after` — из текущего дерева с применёнными предложениями этого батча.
5. Валидирует по ст. 120 и возвращает список нарушений до отправки.

### 3.5 AI-агенты в режиме поправок

**Правило: агент никогда не пишет в текст напрямую.** Любая правка от `agent:draftsman`,
`agent:jurist`, `agent:economist` вносится с `suggestKey` enabled и `userId = 'agent:<name>'`.
Тогда:
- любая машинная правка визуально отличима и требует явного акцепта человеком;
- в `doc_update.author_id` и в марке остаётся след — это трассируемость, которую спросит аппарат;
- откат правки агента — та же команда `rejectSuggestion`, что и для человека.

API для агента (Mastra tool):

```ts
// packages/agents/src/tools/proposeAmendment.ts
export const proposeAmendment = createTool({
  id: 'propose_amendment',
  inputSchema: z.object({
    docId: z.string().uuid(),
    targetSid: z.string(),                  // куда
    operation: z.enum(['replace_text', 'insert_after', 'delete']),
    newText: z.string().optional(),
    rationale: z.string(),                  // попадёт в popravka.obosnovanie
  }),
  execute: async ({ context }) => {
    // Серверный путь: открываем Y.Doc через DirectConnection Hocuspocus,
    // применяем транзакцию с origin = 'agent', НЕ трогая клиентов.
    const conn = await hocuspocus.openDirectConnection(`legal:${context.docId}`)
    await conn.transact((doc) => applySuggestionToYDoc(doc, context))
    await conn.disconnect()
    return { batchId, previewPath: pathFor(context.targetSid) }
  },
})
```

---

## 4. История версий и диффы

### 4.1 Yjs-снапшоты против явных редакций

| | `Y.snapshot()` + `gc:false` | Явные редакции (`encodeStateAsUpdateV2` blob) |
|---|---|---|
| Что хранится | `Snapshot { ds: DeleteSet, sv: Map<clientId, clock> }` — 2 КБ, **но** требует, чтобы Y.Doc не собирал мусор | полный слепок, десятки–сотни КБ |
| Ограничение | **`gc: false` на весь документ навсегда**: удалённый контент никогда не освобождается, документ монотонно растёт | нет |
| Гранулярность | любая точка истории | только зафиксированные точки |
| Совместимость с компакцией лога | плохая | отличная |
| Юридический смысл | нет | **есть**: «текст, внесённый в ГД», «текст, принятый в первом чтении» |

**Решение: явные редакции.** `gc` остаётся включённым. Точки фиксации совпадают с процедурными
событиями: `Внесён`, `Первое чтение`, `Ко второму чтению (ред. N)`, `Второе чтение`, `Третье чтение`.
Это не техническое ограничение — это то, что реально требуется юридически.

```ts
// apps/api/src/versions/versions.service.ts
async createVersion(docId: string, label: string, reading: number | null, userId: string) {
  const conn = await hocuspocus.openDirectConnection(`legal:${docId}`)
  let snapshot!: Uint8Array, pmJson!: unknown
  await conn.transact((doc) => {
    snapshot = Y.encodeStateAsUpdateV2(doc)
    pmJson = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('legal'))  // из y-prosemirror
  })
  await conn.disconnect()
  return this.repo.insert({ doc_id: docId, label, reading,
                            snapshot_v2: Buffer.from(snapshot), pm_json: pmJson, created_by: userId })
}
```

### 4.2 Визуальное сравнение двух редакций (встроенный механизм y-prosemirror)

**VERIFIED из исходников `y-prosemirror@1.3.7/src/plugins/sync-plugin.js`:** метод
`ProsemirrorBinding._renderSnapshot(snapshot, prevSnapshot, pluginState)` принимает **либо** два
`Y.Snapshot`, **либо два `Uint8Array` v2-апдейта**:

```js
if (snapshot instanceof Uint8Array || prevSnapshot instanceof Uint8Array) {
  if (!(snapshot instanceof Uint8Array) || !(prevSnapshot instanceof Uint8Array)) error.unexpectedCase()
  historyDoc = new Y.Doc({ gc: false })
  Y.applyUpdateV2(historyDoc, prevSnapshot); prevSnapshot = Y.snapshot(historyDoc)
  Y.applyUpdateV2(historyDoc, snapshot);     snapshot     = Y.snapshot(historyDoc)
  …
}
```

То есть **мы можем скормить ему два наших blob'а `doc_version.snapshot_v2` напрямую** — временный
`Y.Doc({gc:false})` создаётся внутри и живёт только на время рендера. Живой документ не трогается.
Результат: узлы/текст получают атрибут/марку `ychange = { user, type: 'added'|'removed', color }`,
где `user` резолвится через `PermanentUserData` (`getUserByClientId` / `getUserByDeletedId`).

Дополнительно `ySyncPlugin` в режиме снапшота **автоматически делает редактор read-only**:

```js
props: { editable: (state) => {
  const s = ySyncPluginKey.getState(state)
  return s.snapshot == null && s.prevSnapshot == null
}}
```
(VERIFIED, там же.)

```ts
// Включить режим сравнения
function showDiff(view: EditorView, fromBlob: Uint8Array, toBlob: Uint8Array) {
  view.dispatch(view.state.tr.setMeta(ySyncPluginKey, {
    snapshot: toBlob, prevSnapshot: fromBlob,
  }))
}
function exitDiff(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(ySyncPluginKey, { snapshot: null, prevSnapshot: null }))
}
```

CSS:
```css
[ychange-type="added"],   ychange[type="added"]   { background: rgba(46,160,67,.18); }
[ychange-type="removed"], ychange[type="removed"] { background: rgba(248,81,73,.18); text-decoration: line-through; }
```

> **Ограничение (важно!):** `ychange`-дифф — посимвольный и «CRDT-ный». Он отвечает на вопрос
> «что изменилось между двумя состояниями» и хорош для UI. Он **не** отвечает на вопрос
> «какая структурная единица закона изменилась и как это записать в таблицу поправок».
> Для этого — §4.3.

### 4.3 Структурный дифф → таблица поправок

Работаем не с CRDT, а с двумя ProseMirror-документами (`doc_version.pm_json`), сопоставляя узлы
по `sid`. Это даёт устойчивый структурный дифф; текстовый дифф внутри узла — `prosemirror-changeset`.

```ts
// packages/legal-diff/src/structural.ts
import { ChangeSet, simplifyChanges, type TokenEncoder } from 'prosemirror-changeset'

export type UnitDiff = {
  sid: string
  path: string                                   // 'ст.5 ч.2 п.3'
  kind: 'unchanged' | 'modified' | 'added' | 'removed' | 'moved'
  before: string | null
  after: string | null
  inlineChanges: { fromA: number; toA: number; fromB: number; toB: number }[]
}

export function diffLegalDocs(a: PMNode, b: PMNode): UnitDiff[] {
  const A = indexBySid(a)   // Map<sid, {node, path}>
  const B = indexBySid(b)
  const out: UnitDiff[] = []

  for (const [sid, ea] of A) {
    const eb = B.get(sid)
    if (!eb) { out.push({ sid, path: ea.path, kind: 'removed', before: text(ea.node), after: null, inlineChanges: [] }); continue }
    if (ea.node.eq(eb.node)) { out.push({ sid, path: eb.path, kind: 'unchanged', before: text(ea.node), after: text(eb.node), inlineChanges: [] }); continue }

    // Текстовый дифф в пределах структурной единицы.
    // ChangeSet.create(doc, combine?, tokenEncoder?, changes?) — VERIFIED из prosemirror-changeset@2.4.1 d.ts
    let cs = ChangeSet.create(ea.node, undefined, legalTokenEncoder)
    cs = cs.addSteps(eb.node, diffSteps(ea.node, eb.node).map(s => s.getMap()), null)
    const changes = simplifyChanges(cs.changes, eb.node)   // склеивает правки по границам слов
    out.push({ sid, path: eb.path, kind: 'modified', before: text(ea.node), after: text(eb.node),
               inlineChanges: changes.map(c => ({ fromA: c.fromA, toA: c.toA, fromB: c.fromB, toB: c.toB })) })
  }
  for (const [sid, eb] of B) if (!A.has(sid))
    out.push({ sid, path: eb.path, kind: 'added', before: null, after: text(eb.node), inlineChanges: [] })

  return out.sort(byDocumentOrder(b))
}

/** Юридический токенизатор: не разбиваем номера актов и даты, игнорируем разницу пробелов. */
const legalTokenEncoder: TokenEncoder<string> = {
  encodeCharacter: (ch) => String.fromCharCode(ch),
  encodeNodeStart: (n) => `<${n.type.name}`,
  encodeNodeEnd:   () => '>',
  compareTokens:   (x, y) => x === y,
}
```

**Таблица поправок** — это проекция `popravka` (§3.4), а не diff'а. Diff используется только как
подсказка при заполнении. Колонки (VERIFIED по описанию практики ГД —
«таблицы поправок содержат текст законопроекта с предложенной поправкой, данные об авторе поправки,
содержание поправки, новую редакцию текста законопроекта с учётом предлагаемой поправки, краткое
обоснование ответственного комитета»; точная форма бланка **UNVERIFIED**, требует сверки с образцом
из СОЗД):

| № п/п | Структурная единица законопроекта | Текст, принятый в первом чтении | Автор поправки | Содержание поправки | Новая редакция с учётом поправки | Решение ответственного комитета |
|---|---|---|---|---|---|---|

```ts
// packages/legal-export/src/amendment-table.ts
export function buildAmendmentTable(popravki: Popravka[], tableNo: 1|2|3|4): AmendmentRow[] {
  return popravki
    .filter(p => p.table_no === tableNo)
    .sort(byTargetPath)
    .map((p, i) => ({
      n: i + 1,
      unit: p.target_path,
      before: p.text_before ?? '—',
      author: formatAuthors(p),                  // «Депутат ГД И.И. Иванов», «Депутаты ГД …»
      content: renderPopravkaWording(p),          // см. ниже
      after: p.text_after ?? '(исключается)',
      decision: DECISION_RU[p.committee_decision] + (p.committee_reason ? `\n${p.committee_reason}` : ''),
    }))
}

/** Формулировки строго по ст.120 — иначе комитет вправе вернуть поправку. */
function renderPopravkaWording(p: Popravka): string {
  switch (p.kind) {
    case 'izmenenie_redakcii':
      return `${p.target_path} изложить в следующей редакции:\n«${p.text_after}»`
    case 'dopolnenie':
      return `Дополнить законопроект ${p.target_path} следующего содержания:\n«${p.text_after}»`
    case 'isklyuchenie':
      return `Исключить из законопроекта ${p.target_path}${p.text_before ? ` следующего содержания: «${p.text_before}»` : ''}`
  }
}
```
