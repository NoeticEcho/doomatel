# 01 — Источники данных по федеральному законодательству и законопроектам РФ: как их ингестить

**Проект:** Doomatel — мультиагентное веб‑приложение для депутатов Государственной Думы ФС РФ,
сопровождающее законотворческую работу.
**Дата исследования:** 2026-08-20
**Статус документа:** research draft v1

---

## 0. Как читать этот документ

Каждое утверждение помечено:

- **[VERIFIED]** — я лично видел это в выдаче поиска, в документации или в исходном коде на GitHub; URL приведён.
- **[INFERRED]** — логический вывод из верифицированных фактов, но прямого подтверждения нет.
- **[UNVERIFIED]** — предположение / данные из вторых рук. **Обязательно перепроверить с российского IP перед реализацией.**

### 0.1. Критическое ограничение среды исследования

Из sandbox‑окружения, в котором проводилось исследование, **прямой доступ к российским
государственным хостам заблокирован**:

| Хост | Результат из sandbox | Результат через WebFetch (внешний egress) |
|---|---|---|
| `api.duma.gov.ru` | connection reset | **HTTP 503** |
| `sozd.duma.gov.ru` | connection reset | **HTTP 503** |
| `publication.pravo.gov.ru` | connection reset | **HTTP 503** |
| `web.archive.org` | 403 (egress policy) | заблокирован |
| `raw.githubusercontent.com` | — | **OK** |
| `registry.npmjs.org` | **OK** | — |

**Вывод:** 503 — это почти наверняка гео‑/ASN‑фильтрация на стороне российских госхостов, а не смерть сервиса.
Косвенное подтверждение живости приведено ниже по каждому источнику.
Все URL‑паттерны ниже восстановлены из **исходного кода реально работающих парсеров на GitHub** и из
**зеркала официальной документации**, а не из прямого обращения к сайтам.

> **Практическое следствие для продакшена:** ингест‑воркеры Doomatel должны работать
> **с российского IP** (хостинг в РФ: Yandex Cloud, VK Cloud, Selectel, Timeweb) либо через
> российский egress‑прокси. Это архитектурное требование, а не деталь реализации.

---

## 1. Карта источников и приоритеты

| # | Источник | Что даёт | Формат | Приоритет |
|---|---|---|---|---|
| 1 | `api.duma.gov.ru` (ИС «Законотворчество» / АИС «Законопроект») | Метаданные законопроектов, справочники, депутаты, голосования, стенограммы | JSON/XML/RSS | **P0 — основной** |
| 2 | `sozd.duma.gov.ru` (СОЗД) | Полные карточки законопроектов, **файлы документов** (тексты, ФЭО, пояснительные записки, заключения) | HTML + doc/docx/pdf/rtf/zip | **P0 — основной** |
| 3 | `publication.pravo.gov.ru` (Официальное опубликование) | Официально опубликованные акты, ФЗ после подписания | **JSON API** + PDF | **P0 — основной** |
| 4 | `pravo.gov.ru` ИПС «Законодательство России» | Действующие редакции НПА, plain text | HTML/RTF | P1 |
| 5 | `irlcode/RusLawOD` (HuggingFace) | 304 382 акта 1991–2025 с морфоразметкой | Parquet/XML | **P1 — bootstrap корпуса** |
| 6 | `duma.gov.ru` /transcripts | Стенограммы пленарных заседаний | HTML | P2 |
| 7 | `data.gov.ru` | Перезапущен 15.07.2025, релевантных наборов мало | CSV/JSON | P3 |
| 8 | Гарант / КонсультантПлюс «Досье законопроекта» | Сверка, аннотации, связи | HTML (закрытая лицензия) | P3 — только как reference, **не ингестить** |

---

## 2. `api.duma.gov.ru` — ИС «Законотворчество» (АИС «Законопроект»)

### 2.1. Существует ли ещё?

**[VERIFIED]** Домен и структура документации живы и индексируются: поисковая выдача возвращает
рабочие страницы `http://api.duma.gov.ru/`, `/pages/dokumentatsiya`, `/pages/dokumentatsiya/spravochnik-po-api`,
`/key-request`, `/pages/dokumentatsiya/obrashchenie-k-api`, `/pages/dokumentatsiya/poisk-po-zakonoproektam`,
`/pages/dokumentatsiya/svedeniya-o-golosovanii`, `/pages/dokumentatsiya/stenogrammi-po-zakonoproektu`,
`/pages/dokumentatsiya/osnovnie-svedeniya`, `/pages/dokumentatsiya/voprosi-zasedaniy-gosudarstvennoy-dumi`,
`/pages/dokumentatsiya/stenogramma-rassmotreniya-voprosa`, `/pages/dokumentatsiya/svedeniya-o-deputate`,
`/pages/dokumentatsiya/primeri-zaprosov-k-api-ais-zakonoproekt`,
`/pages/dokumentatsiya/ispolzovanie-api-ais-zakonoproekt-v-php`, `/examples/ex_php.php`.

**[VERIFIED]** Каталог `apiportal.ru` содержит карточку «API портала Государственной Думы РФ» со статусом
«Обновлено 24.10.2024», «Общедоступное», «Бесплатно».
<https://apiportal.ru/catalog/api-portala-gosudarstvennoj-dumy-rf/>

**[UNVERIFIED]** Живость на 2026-08. Из sandbox — 503 (гео‑блок). Все новые парсеры, найденные на GitHub
за 2025–2026 гг. (напр. `yarik88/duma-law-monitor`, окт. 2025), **скрейпят СОЗД, а не используют API**.
Это может означать либо деградацию API, либо просто незнание авторов о его существовании.
**→ Первое, что надо проверить с российского IP.**

### 2.2. Формат запроса

**[VERIFIED]** Шаблон (документация, процитирована в поисковой выдаче):

```
http://api.duma.gov.ru/api/:token/:request.:format?app_token=:app_token&param1=1&param2=2
```

- `:token` — **ключ API** (path segment).
- `:app_token` — **ключ приложения** (query param), обязателен для server-side.
- `:request` — имя метода.
- `:format` — `json` | `xml` | `rss` **[VERIFIED]**, плюс JSONP **[VERIFIED]**.

**[VERIFIED]** Реальные значения токенов из открытых репозиториев (иллюстрируют формат, **не использовать**):

```
token     = 9872d44a4bd94c7f9b8d95d0829c9eee834e3391   # 40 hex
app_token = appfff9f36a927fa2d7f818da02c17002271a35a0dd # префикс "app" + 40 hex
```
Источник: <https://github.com/xokker/gdinfo/blob/master/parsers/deputies.rb>

Пример полного вызова **[VERIFIED]**:
```
http://api.duma.gov.ru/api/{token}/deputies.json?app_token={app_token}&current=1&position=Депутат%20ГД
http://api.duma.gov.ru/api/{token}/search.json?app_token={app_token}&topic={t}&sort=date&page={n}
```

### 2.3. Аутентификация и получение ключа

**[VERIFIED]** Форма запроса ключа: `http://api.duma.gov.ru/key-request`.

**[VERIFIED]** Модель:
- Если API подключается **на клиенте** (в браузере на вашем сайте) — достаточно **ключа API**.
- Если API используется **в приложении или на server-side** — нужны **и ключ API, и APP‑ключ приложения**.
- При обращении **с сайтов** система проверяет заголовок **`REFERER`** на совпадение домена
  с доменом, указанным в форме запроса ключа.

> **Следствие для Doomatel:** нужен именно **app_token** (server-side режим), поскольку ингест идёт из
> бэкенда NestJS, а не из браузера. При server-side вызовах Referer‑проверка не применяется **[INFERRED]**.

### 2.4. Лимиты

**[VERIFIED]** «В настоящее время действует ограничение **50 000 вызовов в сутки** на один ключ API.»
Запрос на изменение лимита — письмом на **`webmaster@duma.gov.ru`** с описанием сайта/приложения
и обоснованием увеличения квоты.

**[INFERRED]** 50 000/сут ≈ 34 запроса/мин при равномерном распределении. Для полного бэкфила
~31 500 законопроектов текущего созыва (см. ниже) при `limit=20` это ~1 575 страничных запросов —
одна ночь. Полный бэкфил всех созывов (~130 000+ объектов **[UNVERIFIED]**) — несколько суток.

### 2.5. Полный список методов

**[VERIFIED]** (сводно из `sergray/rugovapi-client`, `xankraegor/RussianBills`, `Gelassen/government-rus`)

| Метод | Путь | Параметры | Назначение |
|---|---|---|---|
| Поиск законопроектов | `/search.{fmt}` | см. §2.6 | **Главный метод** |
| Тематические блоки | `/topics.{fmt}` | — | Справочник |
| Отрасли законодательства | `/classes.{fmt}` | — | Справочник |
| Стадии рассмотрения | `/stages.{fmt}` | — | Справочник |
| Инстанции рассмотрения | `/instances.{fmt}` | `current` | Справочник |
| Периоды (созывы/сессии) | `/periods.{fmt}` | — | Справочник |
| Комитеты | `/committees.{fmt}` | `current` (`1`/`0`) | Справочник |
| Федеральные органы власти | `/federal-organs.{fmt}` | `current` | Справочник СПЗИ |
| Региональные органы власти | `/regional-organs.{fmt}` | `current` | Справочник СПЗИ |
| Список депутатов | `/deputies.{fmt}` | `begin`, `position`, `current` | Депутаты и сенаторы |
| Карточка депутата | `/deputy.{fmt}` | `id` | Один депутат |
| Вопросы заседаний ГД | `/questions.{fmt}` | `limit`, `dateFrom` | Повестки |
| Стенограмма по вопросу | `/{kodz}/{kodvopr}.{fmt}` | — | **Нестандартный путь** |
| Стенограммы по законопроекту | `/transcript{...}` | — | **[UNVERIFIED]** точное имя |
| Сведения о голосовании | `/vote/{id}.{fmt}` | — | Результаты голосования |

Источники:
<https://github.com/sergray/rugovapi-client/blob/master/govapi/clients.py> ·
<https://github.com/xankraegor/RussianBills/blob/master/RussianBills/RequestRouter.swift> ·
<https://github.com/Gelassen/government-rus/blob/master/android-client/README.md>

**[VERIFIED]** Пример нестандартного пути стенограммы:
```
http://api.duma.gov.ru/api/<api_key>/<kodz>/<kodvopr>.json?app_token=<app_token>
```
**[VERIFIED]** Голосование:
```
http://api.duma.gov.ru/api/<api_key>/vote/<id>.json?app_token=<app_token>
```
Публичная страница голосования: `http://vote.duma.gov.ru/vote/{id}` **[VERIFIED]**

### 2.6. Параметры `/search`

**[VERIFIED]** (все опциональны) — из `sergray/rugovapi-client`:

```
law_type                # вид законопроекта (см. /classes или справочник видов)
status                  # статус (см. таблицу ниже)
name                    # поиск по названию
number                  # номер законопроекта, напр. "301854-7"
registration_start      # дата регистрации, начало
registration_end        # дата регистрации, конец
document_number
topic                   # id тематического блока (/topics)
class                   # id отрасли законодательства (/classes)
federal_subject         # id федерального СПЗИ (/federal-organs)
regional_subject        # id регионального СПЗИ (/regional-organs)
deputy                  # id депутата-инициатора (/deputies)
responsible_committee   # id ответственного комитета (/committees)
soexecutor_committee    # id комитета-соисполнителя
profile_committee       # id профильного комитета
search_mode
event_start             # дата события, начало
event_end               # дата события, конец
instance                # id инстанции (/instances)
stage                   # id стадии (/stages)
phase                   # id фазы
page                    # номер страницы (1-based)
limit                   # размер страницы
sort                    # напр. "date", "date_asc"
```

**[VERIFIED]** Коды `status` (из `CAG-ru/cag-public` и `Gelassen/government-rus`):

| id | Значение |
|---|---|
| 1 | внесён в ГД |
| 2 | находится на рассмотрении в ГД |
| 4 | в примерной программе комитета |
| 5 | в примерной программе |
| 6 | рассмотрение завершено |
| 7 | подписан Президентом РФ |
| 8 | отклонён (снят) ГД |
| 9 | отозванный или возвращённый СПЗИ |
| 10 | действующие |
| 99 | рассмотрение завершено по прочим причинам |

Источник: <https://github.com/CAG-ru/cag-public/blob/master/projects/ria/scraping/duma_parser.py>

### 2.7. **Точная схема ответа `/search.json`**

**[VERIFIED]** — реальный дамп ответа API из фикстуры Android‑клиента
<https://github.com/Gelassen/government-rus/blob/master/android-client/app/src/main/assets/mocks/mock_api_laws_page_1.json>:

```json
{
  "count": 31498,
  "page": 1,
  "wording": "Законопроекты, отсортированные по дате последнего события (по убыванию)",
  "laws": [
    {
      "id": 34456,
      "number": "149922-8",
      "name": "О внесении изменений в Федеральный закон \"Об образовании в Российской Федерации\"",
      "comments": null,
      "introductionDate": "2022-06-23",
      "url": "http://sozd.parlament.gov.ru/bill/149922-8",
      "transcriptUrl": null,
      "lastEvent": {
        "stage":    { "id": 1, "name": "Внесение законопроекта в Государственную Думу" },
        "phase":    { "id": 1, "name": "Регистрация законопроекта и материалов к нему в САДД Государственной Думы" },
        "solution": null,
        "date":     "2022-06-23",
        "document": null
      },
      "subject": {
        "deputies": [],
        "departments": [
          { "id": 6230800, "name": "Правительство РФ", "isCurrent": true,
            "startDate": "1994-01-01", "endDate": null }
        ],
        "factions": []
      },
      "committees": {
        "responsible": null,
        "profile": [],
        "soexecutor": []
      },
      "type": { "id": 38, "name": "Федеральный закон" }
    }
  ]
}
```

**Ключевые наблюдения:**
- `count` — общее число найденных объектов → **пагинация: `pages = ceil(count / len(laws))`** **[VERIFIED]**
  (именно так делает `CAG-ru/cag-public`).
- `number` — **естественный первичный ключ** формата `{NNNNNN}-{созыв}`.
- `url` указывает на **`sozd.parlament.gov.ru`** (алиас `sozd.duma.gov.ru`) **[VERIFIED]**.
- `lastEvent` — **точка входа для инкрементальной синхронизации** (см. §11.2).
- `subject` разложен на `deputies` / `departments` / `factions` — прямой маппинг на граф СПЗИ.

### 2.8. Пример: TypeScript‑клиент (готов к копированию)

```ts
// packages/ingest/src/sources/duma-api.ts
const BASE = 'http://api.duma.gov.ru/api';

export interface DumaLaw {
  id: number;
  number: string;                 // "149922-8"
  name: string;
  comments: string | null;
  introductionDate: string | null; // "YYYY-MM-DD"
  url: string;
  transcriptUrl: string | null;
  lastEvent: {
    stage: { id: number; name: string } | null;
    phase: { id: number; name: string } | null;
    solution: string | null;
    date: string | null;
    document: unknown | null;
  } | null;
  subject: {
    deputies: Array<{ id: number; name: string }>;
    departments: Array<{ id: number; name: string; isCurrent: boolean; startDate: string | null; endDate: string | null }>;
    factions: Array<{ id: number; name: string }>;
  };
  committees: {
    responsible: { id: number; name: string } | null;
    profile: Array<{ id: number; name: string }>;
    soexecutor: Array<{ id: number; name: string }>;
  };
  type: { id: number; name: string };
}

export interface DumaSearchResponse { count: number; page: number; wording: string; laws: DumaLaw[]; }

export async function dumaSearch(
  params: Record<string, string | number>,
  { token, appToken }: { token: string; appToken: string },
): Promise<DumaSearchResponse> {
  const qs = new URLSearchParams({ app_token: appToken, ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)]))});
  const res = await fetch(`${BASE}/${token}/search.json?${qs}`);
  if (!res.ok) throw new Error(`duma api ${res.status}`);
  return res.json() as Promise<DumaSearchResponse>;
}
```

---

## 3. `sozd.duma.gov.ru` — СОЗД (Система обеспечения законодательной деятельности)

### 3.1. Домены и алиасы

**[VERIFIED]**
- `https://sozd.duma.gov.ru` — канонический.
- `https://sozd.parlament.gov.ru` — алиас (его отдаёт API в поле `url`).
- `http://asozd2.duma.gov.ru` — **легаси АСОЗД‑2** (Lotus Domino), до сих пор встречается в старых ссылках.

**[VERIFIED]** Легаси‑паттерн АСОЗД‑2 (справка по законопроекту):
```
http://asozd2.duma.gov.ru/main.nsf/(Spravka)?OpenAgent&RN=431985-6
http://asozd2.duma.gov.ru/main.nsf/(ViewDoc)?OpenAgent&...&RN=...
```
Найден в исходниках tzdata (`eggert/tz`, `europe`) — <https://github.com/eggert/tz/blob/main/europe>
и в `xankraegor/RussianBills` (`OpenAgent`, `RN` как параметры парсинга).
**[INFERRED]** Скорее всего проксируется/редиректит на СОЗД; полезен только для очень старых созывов.

### 3.2. Карточка законопроекта

**[VERIFIED]**
```
https://sozd.duma.gov.ru/bill/{НОМЕР}-{СОЗЫВ}
```
Примеры: `/bill/1234567-8`, `/bill/792837-7`, `/bill/149922-8`, `/bill/134573-8`, `/bill/7902-3`.

**[VERIFIED]** Формат номера: `{порядковый номер}-{номер созыва}`.
Созыв `3` = 3-й (1999–2003), `6`, `7` (2016–2021), `8` (2021–2026).
**[INFERRED]** С сентября 2026 г. ожидается **9-й созыв** → схема данных обязана поддерживать
произвольный номер созыва, не хардкодить `8`.

### 3.3. Селекторы карточки (VERIFIED, из работающих парсеров)

Из `ruarxive/apibackuper` (`examples/sozd/scripts/pagetodata.py`):

**Element IDs:**
- `#current_oz_status` — текущий статус
- `#number_oz_id` — номер законопроекта
- `#oz_name` — наименование

**[VERIFIED]** Подтверждено независимо в `rabarbra/mad_printer_supervisor_bot/models.py`:
```python
descr = soup.find(id="oz_name").text.strip()
```

**Паспорт** — таблица `key → value`. Карта полей (VERIFIED, дословно из `pagetodata.py`):

```python
KEYMAP = {
  'Субъект права законодательной инициативы' : 'initiator',
  'Форма законопроекта'                      : 'law_form',
  'Профильный комитет'                       : 'profile_comittee',
  'Комитеты-соисполнители'                   : 'subcomittees',
  'Отрасль законодательства'                 : 'law_topic',
  'Тематический блок законопроектов'         : 'law_theme',
  'Ответственный комитет'                    : 'responsible_comittee',
  'Срок представления поправок'              : 'amendment_final_date',
  'Предмет ведения'                          : 'issue_assignment',
  'Вопрос ведения'                           : 'issue_question',
  'Принадлежность к примерной программе'     : 'lawmaking_program',
  'Пакет документов при внесении'            : None,
}
```

**Сопроводительные материалы (документы)** — VERIFIED, дословно:

```python
response['documents'] = []
doc_tags = root.xpath("//div[@class='table_icona']")
for doc in doc_tags:
    url = doc.getparent().attrib['href']
    try:    doc_date = doc.getparent().attrib['title'].split(' ', 1)[0]
    except: doc_date = ''
    format_t = doc.xpath('div[@class="table_iconatd1"]/span')
    doc_format = ''
    if len(format_t) > 0:
        doc_format = format_t[0].attrib['class'].split()[0].split('-')[-1]
    name_t = doc.xpath('div/div[@class="doc_wrap"]')
    name = name_t[0].text.strip() if len(name_t) > 0 else ""
    response['documents'].append({'url': url, 'name': name, 'doc_date': doc_date, 'format': doc_format})
```

**Критично:** **формат файла кодируется в CSS‑классе иконки** (`...-pdf`, `...-doc`, `...-docx`, `...-rtf`, `...-zip`)
— т.е. **тип документа известен из HTML до скачивания**. Это позволяет заранее маршрутизировать
экстрактор и не гадать по Content-Type.

**Хронология рассмотрения** — VERIFIED, из `CAG-ru/cag-public` и `Yagusak/PaGos`:
- События размечены атрибутом **`data-eventnum`**, напр. `data-eventnum="1.1"` = «Внесение законопроекта в ГД».
- Внутри события лежит ссылка с текстом, начинающимся на **«Текст внесенного…»** → это текст законопроекта в редакции внесения.
- Классы этапов (`Yagusak/PaGos/stage5_metadata.py`): `.root-stage.bh_item.bhi1` (внесение),
  `.root-stage.bh_item.bhi8.green`, `.root-stage.bh_item.bhi11.green` (принят).
- Даты — регулярка `\d{2}\.\d{2}\.\d{4}`.

**[INFERRED]** Нумерация `data-eventnum` иерархическая (`{стадия}.{фаза}`) и совпадает по смыслу
со `stage.id` / `phase.id` из API → **можно связать HTML‑хронологию с API‑событиями по этой паре**.

**[VERIFIED]** Поля, извлекаемые PaGos из карточки:
«Инициатор», «Профильный комитет», «Дата внесения в ГД»,
«Тематический блок / Отрасль законодательства», «Статус».

### 3.4. Скачивание документов

**[VERIFIED]** Два паттерна:
```
https://sozd.duma.gov.ru/download/{GUID}          # современный, GUID = атрибут id элемента
https://sozd.duma.gov.ru/...?fileid={ID}          # альтернативный
http://sozd.parlament.gov.ru/download/            # алиас
```
`CAG-ru/cag-public/projects/ria/scraping/duma_parser.py`:
```python
doc_guid = project_texts[0].attrs['id']
return 'https://sozd.duma.gov.ru/download/' + doc_guid
```

**[VERIFIED]** Расширение определяется из заголовка **`Content-Disposition`**
(`CAG-ru/cag-public/projects/ria/scraping/download_files.py`):
```python
ext = response.getheader('Content-Disposition').split('.')[-1].strip('"')
```

**[VERIFIED]** Реальные форматы вложений (подтверждено `Yagusak/PaGos`, README):
**PDF, DOCX, DOC (legacy binary), RTF, а также сканы (image-only PDF), требующие OCR.**
ZIP тоже встречается **[UNVERIFIED]** — по аналогии с `zipFileLength` у pravo.gov.ru.

### 3.5. Поиск и фильтры `/oz`

**[VERIFIED]** Базовые точки входа:
```
https://sozd.duma.gov.ru/oz                       # все объекты законотворчества
https://sozd.duma.gov.ru/oz/b                     # раздел "б" (законопроекты)
https://sozd.duma.gov.ru/search?q={query}#data_source_tab_b
https://sozd.duma.gov.ru/search?q=&page={n}#data_source_tab_b
https://sozd.duma.gov.ru/calendar/b/day/{YYYY-MM-DD}/{YYYY-MM-DD}   # календарь событий за период
https://sozd.duma.gov.ru/oz_info_spzi/spzi_list   # сводная по СПЗИ
https://sozd.duma.gov.ru/stat/spzigd              # статистика по СПЗИ текущего созыва
```

**[VERIFIED]** Компактная форма фильтров (`Yagusak/PaGos/gd_pipeline/config.py`):
```
https://sozd.duma.gov.ru/oz/b?class=b
  &b[Convocation][]=7|6
  &b[LastDecisions][]=8.1.1|8.2.1
  &b[ClassOfTheObjectLawmakingId]=1
  &count_items=250
  &page={page_num}
```
- **`count_items=250`** — размер страницы (в 25 раз больше дефолтных 10!). **Ключевая оптимизация.**
- **`page={n}`** — простая пагинация в этой форме.
- **`b[Convocation][]=7|6`** — созывы через `|`.
- **`b[LastDecisions][]=8.1.1|8.2.1`** — иерархические коды последних решений.

**[VERIFIED]** Полная («широкая») форма фильтров — все параметры `/oz`
(`sloppysloppy1/bmstu_master_degree/main.py`, URL-decoded):

```
b[NumberSpec]              # номер
b[Annotation]              # аннотация / текст
b[IsArchive][0]=cnv-{N}    # СОЗЫВ! напр. cnv-8, cnv-7 — ключевой фильтр
b[Year]
b[FzNumber]                # номер ФЗ (для принятых)
b[NameComment]
b[Resolutionnumber]
b[firstCommitteeCond]=and
b[secondCommitteeCond]=and
b[ExistsEventsDate]        # дата события  (формат "DD.MM.YYYY - DD.MM.YYYY")
b[MaxDate]                 # дата последнего события
b[DecisionsDateOfCreate]
b[conclusionRG]
b[dateEndConclusionRG]
b[ResponseDate]
b[AmendmentsDate]
b[SectorOfLaw]                    # отрасль законодательства
b[ClassOfTheObjectLawmakingId]    # GUID класса объекта, напр. 34f6ae40-bdf0-408a-a56e-e48511c6b618
b[ExistsEvents][]                 # напр. "1.1" — наличие события
b[FormOfTheObjectLawmaking][]     # GUID'ы форм через "|"

# диапазоны дат — парные параметры:
date_period_from_Year / date_period_to_Year
date_period_from_ExistsEventsDate / date_period_to_ExistsEventsDate
date_period_from_MaxDate / date_period_to_MaxDate
date_period_from_DecisionsDateOfCreate / date_period_to_DecisionsDateOfCreate
date_period_from_dateEndConclusionRG / date_period_to_dateEndConclusionRG
date_period_from_ResponseDate / date_period_to_ResponseDate
date_period_from_AmendmentsDate / date_period_to_AmendmentsDate

# логика объединения условий (any/all):
cond[ClassOfTheObjectLawmaking]=any
cond[ThematicBlockOfBills]=any      # тематический блок
cond[PersonDeputy]=any              # депутат
cond[Fraction]=any                  # фракция
cond[RelevantCommittee]=any
cond[ResponsibleCommittee]=any      # ответственный комитет
cond[HelperCommittee]=any           # комитет-соисполнитель
cond[ExistsEvents]=any
cond[LastEvent]=any
cond[ExistsDecisions]=any
cond[LastDecisions]=any
cond[QuestionOfReference]=any       # вопрос ведения
cond[SubjectOfReference]=any        # предмет ведения
cond[FormOfTheObjectLawmaking]=any
cond[inSz]=any

# ПАГИНАЦИЯ (широкая форма) — параметр именуется по GUID класса объекта!
page_34F6AE40-BDF0-408A-A56E-E48511C6B618={n}
#data_source_tab_b                  # якорь вкладки результатов
```

> **⚠️ Ловушка пагинации.** В «широкой» форме параметр страницы —
> **`page_{UPPERCASE_GUID_КЛАССА}`**, а не `page`.
> Подтверждено дважды: `ruarxive/apibackuper` (`page_number_param = page_34F6AE40-BDF0-408A-A56E-E48511C6B618`)
> и `sloppysloppy1/bmstu_master_degree`. GUID `34F6AE40-BDF0-408A-A56E-E48511C6B618` соответствует
> `b[ClassOfTheObjectLawmakingId]` = «законопроект» **[INFERRED]**.
> В компактной форме `/oz/b?class=b` работает обычный `page`.
> **Рекомендация: использовать компактную форму** `/oz/b?class=b&...&count_items=250&page={n}`.

**[VERIFIED]** Пример полного рабочего URL (из `apibackuper.cfg`, дословно):
```
https://sozd.duma.gov.ru/oz?b[ExistsEvents][]=1.1
  &date_period_from_ExistsEventsDate=01.01.2020
  &b[ExistsEventsDate]=01.01.2020%20-%20
  &date_period_from_MaxDate=12.03.2023
  &b[MaxDate]=12.03.2023%20-%20
  &b[FormOfTheObjectLawmaking][]=0C2E8786-6447-4F74-986D-372965233FF7|3DEF47A6-7F6C-402D-A04A-4706155D8344|3D0CC562-AAC1-402C-986A-A2960109661E
  &b[ClassOfTheObjectLawmakingId]=1
```
Обратите внимание: `b[ExistsEventsDate]=01.01.2020 - ` (с пробелами и открытым правым концом) —
**формат диапазона дат: `"DD.MM.YYYY - DD.MM.YYYY"`, любой конец можно опустить.**

### 3.6. Разбор списка результатов

**[VERIFIED]** (`ruarxive/apibackuper/examples/sozd/scripts/listtodata.py`):
```python
num_obj = o.find('div', attrs={'class': "o_top"})
if 'data-law_number' in num_obj.attrs.keys():
    num = num_obj.attrs['data-law_number']
    record = {'num': num, 'url': 'https://sozd.duma.gov.ru/bill/' + num}
    cells = o.findAll('td')
    record['name']     = cells[1].find('div', attrs={'class': 'fw500'}).string
    record['date_reg'] = cells[2].string
```
→ **`div.o_top[data-law_number]`** — номер законопроекта в строке списка. `td[1] div.fw500` — название,
`td[2]` — дата регистрации.

### 3.7. XHR / JSON‑эндпоинты SPA

**[UNVERIFIED / скорее всего отсутствуют.]** Целенаправленный поиск по GitHub
(`"sozd.duma.gov.ru" json OR ajax OR xhr`) не дал **ни одного** упоминания JSON‑эндпоинта СОЗД.
**Все** найденные парсеры (7+ независимых репозиториев) работают через **HTML‑скрейпинг**.

**[INFERRED]** СОЗД — не SPA, а классическое server-rendered приложение с частичным AJAX
(на это указывают якоря вида `#data_source_tab_b` и то, что `apibackuper` настроен с `resp_type = html`).
**→ Планировать HTML‑парсинг; JSON‑эндпоинты не искать.**

---

## 4. `publication.pravo.gov.ru` — Официальное опубликование правовых актов

Это **лучший из трёх источников с точки зрения инженерии**: настоящий документированный
JSON REST API, **без авторизации**, без обнаруженного rate‑limit.

### 4.1. Статус

**[VERIFIED]** Работает и активно используется. Независимая проверка в
<https://github.com/AlsKozlov/ru-legal/blob/main/MCP-STATUS.md>:
```
Test result (2026-05-26):
GET http://publication.pravo.gov.ru/api/Documents?name=152-ФЗ → 200 OK (через httpx без HTTPS upgrade)
```

> **⚠️ Критично: HTTP, не HTTPS.** Тот же источник:
> «в коде используется явный `http://`. Если меняете client — убедитесь что не делает auto-upgrade.»
> Многие HTTP‑клиенты (и WebFetch) принудительно апгрейдят на HTTPS, что вызывает таймаут.
> **В Node.js/undici отключить любые upgrade‑хуки для этого хоста.**

**[VERIFIED]** «The service operates via HTTP (not HTTPS), requires no authentication, handles UTF-8
Cyrillic text, contains 1.5+ million documents, and shows **no detected rate limiting** during testing.»
— <https://github.com/mikhashev/law7/blob/main/scripts/docs/pravo_api_analysis.md>

### 4.2. Эндпоинты

**[VERIFIED]** (официальная справка `publication.pravo.gov.ru/help`, зеркало:
<https://github.com/mikhashev/law7/blob/main/scripts/docs/api_help.html>)

| Эндпоинт | Назначение |
|---|---|
| `/api/PublicBlocks/` | Блоки публикации и подблоки |
| `/api/Categories` | Категории принявших органов |
| `/api/SignatoryAuthorities` | Принявшие органы |
| `/api/DocumentTypes` | Виды документов |
| `/api/Documents` | **Поиск документов** |
| `/api/Document?eoNumber={eo}` | Один документ |
| `/api/BlockStatistics/{daily\|weekly\|monthly}` | Статистика публикаций |

### 4.3. `/api/Documents` — все параметры (VERIFIED, дословно из официальной справки)

| Параметр | Описание |
|---|---|
| `Block` | Код блока публикации |
| `Category` | Код Категории принимающего органа |
| `SignatoryAuthorityId` | GUID Принявшего органа |
| `DocumentTypeId` | GUID вида документа (**допускается несколько значений**) |
| `EoNumber` | Номер электронного опубликования |
| `PeriodType` | Фиксированный период: `daily`, `weekly`, `monthly`, `day` |
| `Date` | Дата опубликования при `PeriodType='Day'` |
| `DocumentDateFrom` | Дата подписания документа — начало периода |
| `DocumentDateTo` | Дата подписания документа — конец периода |
| `Name` | Название документа |
| `ComplexName` | Составное название (вид, дата, номер НПА, название органа) |
| `NumberSearchType` | Режим поиска по номеру: `0`–точно, `1`–начинается, `2`–заканчивается, `3`–содержит |
| `Number` | Номер документа |
| `JdRegNumber` | Номер регистрации в Минюсте |
| `JdRegDateFrom` / `JdRegDateTo` | Дата регистрации в Минюсте — начало / конец |
| `PublishDateFrom` / `PublishDateTo` | Дата публикации НПА — начало / конец |
| `DocumentText` | **Полнотекстовый поиск по тексту документа** |
| `PageSize` | Количество записей на страницу: `10`, `30`, `100`, `200` (в анализе также `300`) |
| `Index` | **Номер страницы (по умолчанию 1)** — НЕ `page`! |
| `SortedBy` | `0`–дата подписания, `1`–вид, `2`–орган, `3`–номер, `4`–дата публикации, `5`–номер публикации |
| `SortDestination` | `1`–возрастание, `2`–убывание |

Все параметры опциональны. **[VERIFIED]** Регистр имён параметров на практике нестрогий —
в дикой природе встречаются и `pageSize`/`index`/`name`, и `PageSize`/`Index`/`Name`.

### 4.4. Схема ответа `/api/Documents` (VERIFIED, дословно)

**Корень:**
| Поле | Описание |
|---|---|
| `items` | Список документов (массив объектов) |
| `itemsTotalCount` | Всего элементов в итоговой выборке |
| `itemsPerPage` | Количество элементов на одной странице |
| `pagesTotalCount` | Общее кол-во страниц |
| `currentPage` | Номер текущей страницы |

**Элемент `items[]`:**
| Поле | Описание |
|---|---|
| `id` | GUID документа |
| `eoNumber` | Номер электронного опубликования |
| `publishDateShort` | Дата публикации, ISO 8601 |
| `viewDate` | Дата публикации, `DD.MM.YYYY` |
| `complexName` | Полное составное название: вид, дата, номер, принявший орган |
| `title` | Заголовок документа |
| `jdRegNumber` | Номер регистрации НПА в Минюсте |
| `jdRegDate` | Дата регистрации НПА в Минюсте |
| `pagesCount` | Количество страниц в PDF |
| `pdfFileLength` | Размер PDF файла документа |
| `zipFileLength` | Размер ZIP с приложениями, если имеется |
| `name` | Название документа |
| `number` | Номер документа (НПА), напр. `"28-р"`, `"273-ФЗ"` |
| `documentDate` | Дата подписания документа |
| `signatoryAuthorityId` | GUID Принявшего органа |
| `documentTypeId` | GUID Вида документа |
| `hasSvg` | Признак: есть прикреплённые SVG файлы |

Реальный фрагмент **[VERIFIED]**:
```json
{ "eoNumber": "0001202601170001",
  "id": "uuid",
  "name": "О присвоении классных чинов...",
  "complexName": "Распоряжение Правительства... от 17.01.2026 № 28-р",
  "number": "28-р" }
```

**Справочники** (`/api/PublicBlocks/`): поля `id`, `shortName`, `name`, `menuName`, `code`,
`description`, `weight`, `isBlocked`, `parentId`, `hasChildren`,
`isAgenciesOfStateAuthorities`, `imageId`, `categories[]`, `section`, `items[]`. **[VERIFIED]**
Параметр `parent` = «Код блока, у которого надо получить все дочерние блоки». **[VERIFIED]**

### 4.5. Скачивание файлов и просмотр

**[VERIFIED]**
```
http://publication.pravo.gov.ru/Document/View/{eoNumber}         # HTML-страница акта
http://publication.pravo.gov.ru/document/{eoNumber}?index=2      # постраничный просмотр
http://publication.pravo.gov.ru/file/pdf?eoNumber={eoNumber}     # ★ ПОДПИСАННЫЙ PDF
http://publication.pravo.gov.ru/GetImage?documentId={id}&pageNumber=1  # страница как изображение
http://publication.pravo.gov.ru/documents/block/{block}?index={n}      # напр. block=region54
```
Источники: `Amethyst-Deceiver2001/Mariupol_Urbicide_2026/docs/sources.md`,
`Basty64/res_documentation_bot/RES_documentation_bot.py`,
`Andrew821667/NPA_Processor`, `systemsprotolab-oss/corta-tools/pravo_fileimport.py`.

> **⚠️ PDF часто — это скан (image-only).** Прямая цитата из источника:
> «Official federal portal (**signed PDF, 46pp, image-only scan**) …
> Raw store: **OCR'd** via `.venv312`/pytesseract». **[VERIFIED]**
> **→ OCR‑ветка обязательна в пайплайне.**

**[INFERRED]** Структура `eoNumber` (16 цифр): `{блок:4}{ГГГГММДД:8}{порядковый:4}`.
Примеры: `0001202301030011` (блок `0001` = федеральный, 2023-01-03, №0011);
`6100201802150005` (блок `6100` = регион); `3900202402190007`.
**Требует подтверждения**, но паттерн устойчив по всем найденным примерам.

### 4.6. Пример: TypeScript‑клиент

```ts
// packages/ingest/src/sources/pravo-api.ts
import { Agent, request } from 'undici';

const PRAVO = 'http://publication.pravo.gov.ru'; // ВАЖНО: http, без upgrade

export interface PravoDoc {
  id: string; eoNumber: string;
  publishDateShort: string; viewDate: string;
  complexName: string; title: string;
  jdRegNumber: string | null; jdRegDate: string | null;
  pagesCount: number; pdfFileLength: number; zipFileLength: number | null;
  name: string; number: string; documentDate: string;
  signatoryAuthorityId: string; documentTypeId: string; hasSvg: boolean;
}
export interface PravoPage {
  items: PravoDoc[]; itemsTotalCount: number;
  itemsPerPage: number; pagesTotalCount: number; currentPage: number;
}

/** Инкрементальный опрос: всё, опубликованное за день. */
export async function pravoByDay(date: string /* DD.MM.YYYY */, index = 1): Promise<PravoPage> {
  const qs = new URLSearchParams({
    PeriodType: 'day', Date: date,
    PageSize: '200', Index: String(index),
    SortedBy: '4', SortDestination: '1',
  });
  const res = await request(`${PRAVO}/api/Documents?${qs}`, { method: 'GET' });
  return res.body.json() as Promise<PravoPage>;
}

export const pravoPdfUrl = (eoNumber: string) => `${PRAVO}/file/pdf?eoNumber=${eoNumber}`;
```

---

## 5. `pravo.gov.ru` и ИПС «Законодательство России»

**[VERIFIED]** `http://pravo.gov.ru/` — «Официальный интернет‑портал правовой информации», ведётся **ФСО России**.
**[VERIFIED]** ИПС «Законодательство России» доступна как `pravo.gov.ru/ips` — содержит **действующие
редакции** НПА в plain text (в отличие от publication.*, где лежат PDF‑сканы официальной публикации).

**[VERIFIED]** Существует раздел `http://publication.pravo.gov.ru/OpenData` — «Открытые данные»,
машиночитаемые массивы «в форматах, обеспечивающих их автоматическую обработку
для повторного использования без предварительного изменения человеком».
**[UNVERIFIED]** Конкретный состав наборов и их актуальность — проверить с российского IP.

**[VERIFIED]** Ключевое различие для Doomatel:
- `publication.pravo.gov.ru` = **официальное опубликование** (юридически значимый факт, PDF с ЭЦП, часто скан).
- `pravo.gov.ru/ips` = **текущая консолидированная редакция** (удобно для RAG, но не является
  официальным опубликованием).
→ **Хранить оба и различать в схеме флагом `is_official_publication`.**

---

## 6. Открытые данные

### 6.1. `data.gov.ru`

**[VERIFIED]** Хронология:
- Начало 2022: >24 000 наборов.
- Начало 2023: **портал закрыт** на миграцию на «Гостех» (Коммерсантъ: «Портал открытых данных временно закрыт»).
- **15 июля 2025: перезапущен** Минэкономразвития РФ.
- На момент перезапуска: **~5 826 наборов** (падение в ~4 раза).

Источники: <https://www.cnews.ru/news/top/2025-07-07_v_rossii_vnov_zapustyat_gosportal> ·
<https://economy.gov.ru/material/news/portal_otkrytyh_dannyh_vozobnovlyaet_svoyu_rabotu.html> ·
<https://www.forbes.ru/tekhnologii/543791-otkrytyj-vopros-cto-ne-tak-s-perezapuskom-nacional-nogo-portala-dannyh-data-gov-ru>

**Оценка:** **P3, низкий приоритет.** Не строить на нём зависимости.

### 6.2. `duma.gov.ru` open data

**[UNVERIFIED]** Отдельного портала `data.duma.gov.ru` найти **не удалось**.
`http://duma.gov.ru/services/` перечисляет сервисы; сам `api.duma.gov.ru` позиционируется в поисковой
выдаче как «портал открытых данных Государственной Думы».
**[INFERRED]** Открытые данные Думы = именно API, отдельных CSV‑дампов нет.

### 6.3. Гарант / КонсультантПлюс «Досье законопроекта»

**[VERIFIED]** `base.garant.ru`, `www.consultant.ru`, `www.garant.ru` — фигурируют в whitelist'ах
правовых ассистентов (напр. `Nataly369264/compliance152/src/llm/web_tools.py`).

**⚠️ Правовая оценка [INFERRED, требует юридической проверки]:**
Тексты НПА не охраняются авторским правом (см. §8), **но** аналитические материалы СПС
(аннотации, досье, комментарии, структура связей, справки) — **являются охраняемым
результатом труда правообладателя** и защищены лицензионным соглашением и ст. 1334 ГК РФ
(право изготовителя базы данных).
**→ Использовать ТОЛЬКО как источник ссылок для ручной сверки юристом.
НЕ ингестить, НЕ индексировать, НЕ подавать в RAG.**

---

## 7. Существующие open-source парсеры и датасеты

### 7.1. Датасеты

#### ★ RusLawOD — главная находка для bootstrap'а корпуса

**[VERIFIED]**
- GitHub: <https://github.com/irlcode/RusLawOD>
- HuggingFace: <https://huggingface.co/datasets/irlspbru/RusLawOD>
- Статья: <https://arxiv.org/abs/2406.04855> (arXiv:2406.04855)

| Свойство | Значение |
|---|---|
| Покрытие | **1991 — 31.12.2025** (v3, обновлён январь 2026) |
| Объём | **304 382 документа, 194 425 905 токенов** |
| Формат | **Parquet** (HF) / XML (репозиторий), схема ~Akoma Ntoso |
| Размер | **6.19 GB**, один сплит `train` (~305 000 строк) |
| Источник | ИПС «Законодательство России» (pravo.gov.ru) |
| Лицензия | **CC BY-NC-4.0** ⚠️ |

**Поля [VERIFIED]:**
```
pravogovruNd, issuedByIPS, docdateIPS, docNumberIPS, headingIPS,
doc_typeIPS, doc_author_normal_formIPS, signedIPS, statusIPS,
actual_datetimeIPS, actual_datetime_humanIPS, is_widely_used,
textIPS,          # исходный текст
taggedtextIPS,    # морфосинтаксическая разметка CoNLL-U (Ru-syntax, НИУ ВШЭ)
classifierByIPS, keywordsByIPS
```

> **⚠️ ЛИЦЕНЗИОННЫЙ БЛОКЕР.** `CC BY-NC-4.0` = **NonCommercial**.
> Doomatel — коммерческий/ведомственный продукт. Сами **тексты НПА** свободны (ст. 1259 п.6 ГК РФ),
> но **компиляция, метаданные и морфоразметка** покрыты NC‑лицензией.
> **Рекомендация:** использовать RusLawOD для **разработки, оценки качества, обучения/валидации
> ретривера и бенчмарков**, а продакшн‑корпус собирать **самостоятельно с pravo.gov.ru**
> (тот же первоисточник, свободные тексты). Юридическую позицию согласовать до релиза.

#### Прочие
- **[VERIFIED]** `joelniklaus/Multi_Legal_Pile` (HF) — многоязычный юридический корпус, есть русская часть.
- **[VERIFIED]** `PleIAs/common_corpus` (HF) — включает публичные правовые тексты.
- **[VERIFIED]** `TryDotAtwo/ruBERT-ruLaw` (HF) — `DeepPavlov/rubert-base-cased`, дообученный на RusLawOD.
  Кандидат в **domain-adapted эмбеддер** для юридического RAG.
- **[VERIFIED]** Russian National Corpus / `ruscorpora` (HF) — >2 млрд токенов, общеязыковой.
- **[VERIFIED]** `data.apicrafter.ru/packages/pubpravogovru` — зеркало publications с pravo.gov.ru,
  форматы JSONL/CSV/Parquet, CC-BY-SA. **Но: всего 200 записей, последнее обновление 25.04.2021.**
  Практически бесполезно, только как образец схемы.

### 7.2. Парсеры (все проверены, ссылки рабочие)

| Репозиторий | Язык | Что делает | Ценность |
|---|---|---|---|
| **`ruarxive/apibackuper`** (`examples/sozd/`) | Python | Готовый конфиг бэкапа СОЗД + `listtodata.py` + `pagetodata.py` | ★★★ **Лучший референс по разбору карточки.** KEYMAP паспорта, разбор документов, пагинация |
| **`Yagusak/PaGos`** | Python | 5‑стадийный пайплайн: сбор → поиск документов → скачивание+извлечение текста → семантическая сверка (rubert-tiny2) → метаданные | ★★★ **Ближайший аналог задачи Doomatel** (сравнение редакций внесения/принятия) |
| **`CAG-ru/cag-public`** (`projects/ria/scraping/`) | Python | `duma_parser.py` (API + СОЗД), `download_files.py` | ★★★ Коды статусов, пагинация, UPSERT‑логика |
| `sloppysloppy1/bmstu_master_degree` | Python | Полный набор фильтров `/oz` | ★★ **Полный словарь query‑параметров** |
| `sergray/rugovapi-client` | Python | Клиент API Думы | ★★ **Полный список методов и параметров search** |
| `Gelassen/government-rus` | Kotlin/Android | Клиент + **JSON‑фикстуры реальных ответов API** | ★★★ **Точная схема ответа** |
| `xankraegor/RussianBills` | Swift/iOS | Клиент API + разбор СОЗД | ★★ Список эндпоинтов |
| `infoculture/opengosduma` | Python | `votes/dumaapi.py` — класс `DumaAPI(token, app_token)` | ★★ Голосования |
| `xokker/gdinfo` | Ruby | `parsers/laws.rb`, `parsers/deputies.rb` | ★ Примеры URL |
| `gosduma2/gosduma2.ru` | Python/Django | `fetchlaws.py` — инкрементальная загрузка по дате | ★★ **Паттерн инкремента** |
| `JavidJafarov1/Parsing-System-` | Python/Scrapy | Пауки `sozd`, `pravo`, `eaeu` | ★★ Scrapy‑структура |
| `mikhashev/law7` | Python | **Зеркало официальной справки pravo.gov.ru API** + Postgres‑индексер | ★★★ **Единственный доступный источник полной спецификации** |
| `Tminww/kapibara-project` | Python | Парсер pravo.gov.ru в БД | ★★ Маппинг полей |
| `AlsKozlov/ru-legal` | Python | MCP‑серверы для российского права, smoke‑тесты источников | ★★ **Свежие данные о живости (2026-05)** |
| `Andrew821667/NPA_Processor` | Python | Обработка НПА с pravo.gov.ru | ★ |
| `yarik88/duma-law-monitor` | Python | Мониторинг новых законопроектов СОЗД (окт. 2025) | ★ Свежий |
| `rabarbra/mad_printer_supervisor_bot` | Python | Календарь СОЗД + карточки | ★ `#oz_name`, `/calendar/b/day/` |
| **Postman: Infoculture public workspace** | — | «Russian Government public undocumented API» — коллекция запросов к pravo.gov.ru | ★★ <https://www.postman.com/infoculture/workspace/infoculture-public/> |

---

## 8. Правовые соображения и ToS

### 8.1. ⚠️ ВАЖНАЯ ПОПРАВКА К ИСХОДНОЙ ГИПОТЕЗЕ

В техническом задании упомянута «ст. 1259 **п.5** ГК РФ». **Это неверно.**

**[VERIFIED]** Проверено по тексту кодекса
(<https://rulaws.ru/gk-rf-chast-4/Razdel-VII/Glava-70/Statya-1259/>,
подтверждено <https://www.consultant.ru/document/cons_doc_LAW_64629/be05678dc42ddc67aae5be9ba9beebd367fb9a3f/>):

**Пункт 5 ст. 1259 ГК РФ** (дословно):
> «Авторские права не распространяются на идеи, концепции, принципы, методы, процессы, системы,
> способы, решения технических, организационных или иных задач, открытия, факты, языки
> программирования, геологическую информацию о недрах.»

**Пункт 6 ст. 1259 ГК РФ** (дословно) — **вот нужная норма**:
> «Не являются объектами авторских прав:
> **1) официальные документы государственных органов и органов местного самоуправления
> муниципальных образований, в том числе законы, другие нормативные акты, судебные решения,
> иные материалы законодательного, административного и судебного характера, официальные
> документы международных организаций, а также их официальные переводы;**
> 2) государственные символы и знаки (флаги, гербы, ордена, денежные знаки и тому подобное),
> а также символы и знаки муниципальных образований;
> 3) произведения народного творчества (фольклор), не имеющие конкретных авторов;
> 4) сообщения о событиях и фактах, имеющие исключительно информационный характер (сообщения
> о новостях дня, программы телепередач, расписания движения транспортных средств и тому подобное).»

**→ Во всей документации, юридических обоснованиях и в UI проекта ссылаться на
`п. 6 ч. 1 ст. 1259 ГК РФ`, а не на п. 5.**

**Практический вывод [INFERRED]:**
- Тексты законопроектов, законов, пояснительных записок, заключений комитетов, стенограмм —
  **официальные документы законодательного характера → не объекты авторского права → свободны**.
- Пункт 4 п.6 дополнительно выводит из охраны новостные сообщения информационного характера.
- **НО:** отсутствие авторско‑правовой охраны ≠ право на неограниченный автоматизированный доступ.
  Ограничения могут возникать из: (а) пользовательского соглашения сайта,
  (б) **ст. 1334 ГК РФ — исключительное право изготовителя базы данных** (запрет извлечения
  существенной части материалов БД), (в) законодательства о персональных данных (ФЗ‑152)
  применительно к ФИО депутатов и иным ПДн в документах.

### 8.2. `robots.txt`

**[UNVERIFIED]** Прямая загрузка `https://sozd.duma.gov.ru/robots.txt` из окружения исследования
дала **HTTP 503** (гео‑блок). Цитат из него в открытых источниках найти не удалось.

**Обязательное действие перед запуском ингеста:**
```bash
curl -s https://sozd.duma.gov.ru/robots.txt
curl -s http://publication.pravo.gov.ru/robots.txt
curl -s http://api.duma.gov.ru/robots.txt
curl -s https://duma.gov.ru/robots.txt
```
Зафиксировать содержимое в этом документе и **захардкодить соблюдение `Crawl-delay` и `Disallow`
в ингест‑воркере** (использовать `robots-parser` npm).

### 8.3. Этикет и рекомендуемая политика нагрузки

**[INFERRED]** — консервативные значения, откалиброванные по наблюдениям из репозиториев:

| Источник | RPS | Конкурентность | Окно | Обоснование |
|---|---|---|---|---|
| `api.duma.gov.ru` | ≤ 0.5 | 1 | 24/7 | Жёсткая квота 50k/сут **[VERIFIED]** |
| `sozd.duma.gov.ru` (HTML) | ≤ 1 | 2–3 | ночь МСК 01:00–06:00 | PaGos использует 18 воркеров — **слишком агрессивно для устойчивого режима** |
| `sozd.duma.gov.ru/download` | ≤ 1 | **6** | ночь | PaGos: `download concurrency = 6 workers` **[VERIFIED]** |
| `publication.pravo.gov.ru` | ≤ 2 | 4 | 24/7 | Rate-limit не обнаружен **[VERIFIED]**, но не злоупотреблять |

**Обязательно:**
- Осмысленный `User-Agent` с контактом:
  `Doomatel-Ingest/1.0 (+https://<домен>/bot; ingest@<домен>)`
- `Accept-Language: ru-RU,ru;q=0.9,en;q=0.8` **[VERIFIED]** (используется PaGos)
- Экспоненциальный backoff на `429`/`5xx`, потолок ~15 мин
- Conditional GET: `If-None-Match` / `If-Modified-Since`
- **Никогда** не переходить в параллельный бэкфил в рабочие часы МСК

---

## 9. Анти‑бот: что реально сообщают практики

**[VERIFIED]** — прямые наблюдения из `Yagusak/PaGos` (README):
> «**Playwright** enables robust page rendering **where standard HTTP fails**.»
- Retry через `tenacity` с экспоненциальным backoff.
- Stage 2: timeout **45 000 ms**, max retries **2**, **18** навигационных воркеров.
- Stage 3: HTTP timeout **90 s**, retries **3**, **6** воркеров скачивания.
- Per-request isolation, чтобы отказ одной страницы не ронял пайплайн.

**[VERIFIED]** Заголовки, которые PaGos реально отправляет:
```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...
Accept-Language: ru-RU,ru;q=0.9,en;q=0.8
```
→ **Проверка User-Agent существует** (иначе не стали бы подделывать).

**[VERIFIED]** Гео‑фильтрация подтверждена независимо:
`VALVVVV/OT-Monitor-MVP_CLIENT_PACKAGE/data/source_access_summary.txt` — систематическое
тестирование `publication.pravo.gov.ru` с VPN и без: **`ConnectTimeout` / `ReadTimeout` во всех прогонах,
"не работает ни в одном запуске"**. `mikhashev/law7/API_TESTING.md`:
> «активный VPN может вызывать таймауты; варианты: отключить, split tunneling для
> `publication.pravo.gov.ru`, или **использовать российский сервер**.»

**[VERIFIED]** HTTPS auto-upgrade ломает pravo.gov.ru (см. §4.1).

**[UNVERIFIED]** Cloudflare / CAPTCHA на СОЗД: **прямых сообщений не найдено.**
Целевой поиск по GitHub (`"sozd.duma.gov.ru" 403 OR Cloudflare OR captcha`) — **0 результатов**.
**[INFERRED]** Основной барьер — **гео‑фильтрация и требование браузерного рендеринга**,
а не классический анти‑бот. Тем не менее, закладывать в архитектуру:
1. Пул fetch'еров: `undici` (быстрый путь) → **fallback на Playwright** при 403/пустом DOM.
2. Persistent cookie jar на сессию (`tough-cookie`).
3. Circuit breaker per-host.

### 9.1. Итоговая матрица доступности (из этого окружения)

| Источник | Sandbox curl | WebFetch | Вывод |
|---|---|---|---|
| `api.duma.gov.ru` | reset | 503 | Гео‑блок **[INFERRED]** |
| `sozd.duma.gov.ru` | reset | 503 | Гео‑блок **[INFERRED]** |
| `publication.pravo.gov.ru` | reset | 503 | Гео‑блок; но работал 2026-05-26 из РФ **[VERIFIED]** |
| `raw.githubusercontent.com` | — | 200 | OK |
| `registry.npmjs.org` | 200 | — | OK |

---

## 10. Извлечение текста из документов

### 10.1. Матрица форматов → инструменты (все версии проверены в npm 2026-08-20)

| Формат | Встречаемость | Пакет (VERIFIED версия) | Примечания |
|---|---|---|---|
| `.docx` | высокая | **`mammoth@1.12.1`** | → HTML/text с сохранением структуры. Лучший выбор |
| `.docx` (альт.) | — | `officeparser@7.8.0` | Универсальный (docx/xlsx/pptx/odt/pdf) |
| `.doc` (legacy OLE2) | **высокая** | **`word-extractor@1.0.4`** | Чистый JS, **не требует Windows/COM** ⭐ |
| `.rtf` | средняя | `rtf-parser@1.3.3` / `node-unrtf@7.1.2` | `node-unrtf` требует бинарь `unrtf` |
| `.pdf` (текстовый) | высокая | **`pdf-parse@2.4.5`** или `pdfjs-dist@6.2.108` | `pdfjs-dist` даёт координаты |
| `.pdf` (скан) | **средняя** | **`tesseract.js@7.0.0`** (`rus`) | ⚠️ **Обязательная ветка** |
| `.zip` | низкая | `yauzl` / `node-stream-zip` | Рекурсивно распаковать и обработать содержимое |

> **Важно:** `Yagusak/PaGos` использовал `pywin32` COM для `.doc` — это **привязка к Windows**.
> В Node.js **`word-extractor`** решает ту же задачу кроссплатформенно. Это ощутимое
> преимущество TS‑стека для данной задачи.

**Альтернатива для сложных случаев [INFERRED]:** LibreOffice headless как универсальный конвертер:
```bash
soffice --headless --convert-to docx:"MS Word 2007 XML" --outdir /tmp input.doc
```
Стабильно, но тяжело — держать как sidecar‑контейнер, вызывать только при провале нативных парсеров.

### 10.2. Каскад извлечения (рекомендуемый)

```
файл
 ├─ формат известен из CSS-класса иконки СОЗД (§3.3) ──┐
 ├─ иначе: Content-Disposition (§3.4) ─────────────────┤
 └─ иначе: magic bytes (file-type) ────────────────────┘
                       │
        ┌──────────────┼──────────────┬─────────────┬──────────┐
      .docx          .doc           .rtf          .pdf       .zip
        │              │              │             │          │
     mammoth     word-extractor   rtf-parser   pdf-parse   распаковать
        │              │              │             │       → рекурсия
        └──────────────┴──────────────┴─────────────┤
                                                    │
                              текст длиннее N символов?
                                   ├── да → нормализация
                                   └── нет → ⚠ скан → tesseract.js(rus)
                                                     └── провал → LibreOffice → повтор
                                                                └── провал → mark FAILED, alert
```

**Порог `N`:** **[INFERRED]** ~200 символов на страницу PDF. Если `text.length / pagesCount < 200`
— считать скан‑документом и уводить в OCR.

### 10.3. Нормализация текста (специфика юридических текстов РФ)

**[INFERRED]** — доменные требования, вытекающие из задачи:
- NFC‑нормализация Unicode.
- Замена `ё` → `е` **только в поисковом индексе**, не в хранимом тексте.
- Сохранение **иерархии структурных единиц**: `раздел / глава / параграф / статья / часть / пункт /
  подпункт / абзац`. Это **не косметика** — это первичный ключ для точных ссылок и diff'ов поправок.
- Распознавание нумерации: `Статья 12.1`, `часть 3`, `пункт 2`, `подпункт «а»`, `абзац второй`.
- Извлечение перекрёстных ссылок (`ст. 5 Федерального закона от … № …-ФЗ`) → рёбра графа знаний.
- Сохранение таблиц (ФЭО часто табличные) — `mammoth` умеет отдавать HTML‑таблицы.

---

## 11. Архитектура ингеста

### 11.1. Общая схема

```
                     ┌───────────────────────────────────────────┐
                     │   RU-egress ingest workers (обяз. РФ IP)  │
                     └───────────────────────────────────────────┘
                                        │
   ┌────────────────┬────────────────────┼────────────────────┬──────────────────┐
   │                │                    │                    │                  │
┌──▼──────────┐ ┌───▼────────┐  ┌────────▼────────┐  ┌────────▼───────┐ ┌────────▼──────┐
│ duma-api    │ │ sozd-list  │  │ sozd-card       │  │ sozd-download  │ │ pravo-api     │
│ (метаданные)│ │ (HTML)     │  │ (паспорт+хроно) │  │ (файлы)        │ │ (опубликов.)  │
└──┬──────────┘ └───┬────────┘  └────────┬────────┘  └────────┬───────┘ └────────┬──────┘
   └────────────────┴────────────────────┴────────────────────┴──────────────────┘
                                        │
                          ┌─────────────▼─────────────┐
                          │  BullMQ / pg-boss queues  │
                          │  (per-host rate limiter)  │
                          └─────────────┬─────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             │                          │                          │
     ┌───────▼────────┐      ┌──────────▼─────────┐     ┌──────────▼─────────┐
     │ raw store      │      │ extract & normalize│     │ change detector    │
     │ Supabase       │      │ (docx/doc/rtf/pdf/ │     │ (по хронологии)    │
     │ Storage (S3)   │      │  OCR) → chunks     │     └────────────────────┘
     └───────┬────────┘      └──────────┬─────────┘
             │                          │
             │            ┌─────────────┼─────────────┐
             │            │             │             │
     ┌───────▼────────────▼──┐  ┌───────▼──────┐ ┌────▼─────────────┐
     │ Postgres (Supabase)   │  │ Qdrant       │ │ TypeDB           │
     │ канонические сущности │  │ эмбеддинги   │ │ граф: НПА↔статьи │
     │ + JSONB сырьё         │  │ чанков       │ │ ↔СПЗИ↔комитеты   │
     └───────────────────────┘  └──────────────┘ └──────────────────┘
```

### 11.2. Расписание и инкрементальность

**Ключевой принцип:** **никогда не переобходить всё.** Дельта определяется через `lastEvent`.

| Джоб | Расписание (МСК) | Стратегия |
|---|---|---|
| `pravo:daily` | 09:00, 15:00, 21:00 | `PeriodType=day&Date=сегодня`, `PageSize=200` — дёшево, источник быстрый |
| `duma:recent` | каждые 30 мин | `/search.json?sort=date&limit=20&page=1` → сравнить `lastEvent.date`+`stage.id`+`phase.id` с БД |
| `duma:window` | ежедневно 02:00 | `/search.json?event_start={T-14д}&event_end={сегодня}` — ловит задним числом проставленные события |
| `sozd:card` | по событию | Триггерится только при изменении `content_hash` карточки |
| `sozd:download` | по событию | Только для новых `document.url` |
| `duma:refs` | еженедельно вс 03:00 | `/topics`, `/classes`, `/stages`, `/instances`, `/committees`, `/deputies`, `/federal-organs`, `/regional-organs`, `/periods` |
| `duma:backfill` | одноразово, ночами | По созывам, от новых к старым |
| `pravo:backfill` | одноразово | По `PublishDateFrom/To`, помесячно |

**Алгоритм детекции изменений (VERIFIED-строительные блоки):**

```ts
// Уровень 1 — дешёвый, только API (без обращения к СОЗД)
const apiFingerprint = (l: DumaLaw) => sha256([
  l.number,
  l.lastEvent?.date ?? '',
  String(l.lastEvent?.stage?.id ?? ''),
  String(l.lastEvent?.phase?.id ?? ''),
  l.lastEvent?.solution ?? '',
  String(l.committees.responsible?.id ?? ''),
].join('|'));

// Уровень 2 — карточка СОЗД: хэш нормализованной хронологии
const timelineFingerprint = (events: TimelineEvent[]) => sha256(
  events.map(e => `${e.eventnum}|${e.date}|${e.title}`).sort().join('\n')
);

// Уровень 3 — документы: хэш содержимого файла (не URL, GUID может смениться)
const docFingerprint = (bytes: Buffer) => sha256(bytes);
```

> **Почему три уровня:** API дешёв (квота 50k/сут) и покрывает 95% случаев.
> Карточку СОЗД дёргаем **только** при расхождении L1. Файл качаем **только** при появлении
> нового `data-eventnum` или нового элемента в списке документов.
> Это снижает нагрузку на СОЗД примерно на два порядка **[INFERRED]**.

### 11.3. Дедупликация

Три независимых слоя:

1. **Сущности** — естественные ключи: `bills.number` (`149922-8`),
   `acts.eo_number` (`0001202601170001`). `UPSERT ... ON CONFLICT DO UPDATE` — паттерн,
   подтверждённый в `CAG-ru/cag-public` **[VERIFIED]**.
2. **Файлы** — **content-addressed storage**: путь = `sha256(bytes)`.
   Один и тот же текст, приложенный к нескольким законопроектам, хранится один раз.
   Таблица связей `bill_documents` — many-to-many.
3. **Чанки** — `UNIQUE(document_id, chunk_index)` + `simhash` для near-duplicate
   между редакциями (типовые формулировки «настоящий Федеральный закон вступает в силу…»
   повторяются тысячи раз и загрязняют RAG). **[INFERRED]** Отсекать чанки с simhash‑
   расстоянием < 3 от уже проиндексированного boilerplate.

### 11.4. Связывание законопроект ↔ опубликованный закон

**[INFERRED]** — важная и нетривиальная часть:
- СОЗД знает поле `b[FzNumber]` — номер ФЗ для принятых законопроектов **[VERIFIED]**.
- pravo.gov.ru знает `number` (`"273-ФЗ"`) и `eoNumber`.
- **Мост:** нормализовать номер ФЗ (`273-ФЗ` ↔ `№ 273-ФЗ` ↔ `273-фз`) + сверить дату подписания
  (`documentDate` ↔ дата события «Подписан Президентом РФ» в хронологии СОЗД).
- Результат — ребро `bill --became--> act` в TypeDB. Это то, что даёт депутату полную траекторию
  «инициатива → редакции → принятие → официальный текст».

---

## 12. Нормализованная схема хранения (Postgres / Supabase)

```sql
-- ═══════════════════════════════════════════════════════════════
-- Справочники (из /topics, /classes, /stages, /instances, ...)
-- ═══════════════════════════════════════════════════════════════
create table ref_convocation (           -- созывы
  id            smallint primary key,    -- 6, 7, 8, 9
  name          text not null,           -- "VIII созыв"
  date_start    date,
  date_end      date
);

create table ref_stage (                  -- стадии рассмотрения
  id smallint primary key, name text not null);

create table ref_phase (                  -- фазы
  id smallint primary key, stage_id smallint references ref_stage(id), name text not null);

create table ref_topic (                  -- тематические блоки
  id integer primary key, name text not null);

create table ref_law_class (              -- отрасли законодательства
  id integer primary key, name text not null);

create table ref_committee (              -- комитеты ГД
  id integer primary key,
  name text not null,
  is_current boolean default true,
  date_start date, date_end date
);

-- ═══════════════════════════════════════════════════════════════
-- Субъекты права законодательной инициативы (СПЗИ)
-- ═══════════════════════════════════════════════════════════════
create type spzi_kind as enum ('deputy','department','faction','regional_organ','federal_organ');

create table subject_of_initiative (
  id            bigint primary key,       -- id из API Думы
  kind          spzi_kind not null,
  name          text not null,
  is_current    boolean default true,
  date_start    date,
  date_end      date,
  faction_id    bigint references subject_of_initiative(id),  -- для депутатов
  raw           jsonb not null default '{}'::jsonb
);
create index on subject_of_initiative (kind);
create index on subject_of_initiative using gin (to_tsvector('russian', name));

-- ═══════════════════════════════════════════════════════════════
-- Законопроекты
-- ═══════════════════════════════════════════════════════════════
create table bill (
  number            text primary key,          -- ★ "149922-8" — естественный ключ
  duma_id           bigint unique,             -- laws[].id из API
  convocation       smallint not null references ref_convocation(id),
  serial_no         integer not null,          -- 149922
  name              text not null,
  comments          text,
  introduction_date date,
  law_type_id       integer,
  law_type_name     text,                      -- "Федеральный закон"
  law_form          text,                      -- паспорт СОЗД: "Форма законопроекта"
  sozd_url          text not null,
  transcript_url    text,

  responsible_committee_id integer references ref_committee(id),
  topic_id                 integer references ref_topic(id),
  law_class_id             integer references ref_law_class(id),
  amendment_deadline       date,               -- "Срок представления поправок"
  lawmaking_program        text,               -- "Принадлежность к примерной программе"
  issue_assignment         text,               -- "Предмет ведения"
  issue_question           text,               -- "Вопрос ведения"

  -- денормализованное последнее событие (горячий путь UI)
  last_event_date     date,
  last_event_stage_id smallint references ref_stage(id),
  last_event_phase_id smallint references ref_phase(id),
  last_event_solution text,
  status_code         smallint,                -- 1,2,4..10,99 (см. §2.6)
  status_text         text,                    -- #current_oz_status из СОЗД

  fz_number         text,                      -- "273-ФЗ" если принят
  act_eo_number     text,                      -- ★ мост на pravo.gov.ru

  api_fingerprint   text,                      -- L1 change detection
  card_fingerprint  text,                      -- L2 change detection
  raw_api           jsonb not null default '{}'::jsonb,
  raw_card          jsonb not null default '{}'::jsonb,

  first_seen_at     timestamptz not null default now(),
  last_api_sync_at  timestamptz,
  last_card_sync_at timestamptz,
  updated_at        timestamptz not null default now(),

  constraint bill_number_fmt check (number ~ '^[0-9]+-[0-9]+$')
);
create index on bill (convocation, last_event_date desc);
create index on bill (status_code) where status_code in (1,2);
create index on bill (last_event_date desc);
create index on bill (act_eo_number) where act_eo_number is not null;
create index bill_name_fts on bill using gin (to_tsvector('russian', name));

-- связь законопроект ↔ СПЗИ (many-to-many: часто десятки соавторов)
create table bill_initiator (
  bill_number text not null references bill(number) on delete cascade,
  subject_id  bigint not null references subject_of_initiative(id),
  primary key (bill_number, subject_id)
);
create index on bill_initiator (subject_id);   -- "все законопроекты депутата X"

-- комитеты-соисполнители / профильные
create type committee_role as enum ('responsible','profile','soexecutor');
create table bill_committee (
  bill_number  text not null references bill(number) on delete cascade,
  committee_id integer not null references ref_committee(id),
  role         committee_role not null,
  primary key (bill_number, committee_id, role)
);

-- ═══════════════════════════════════════════════════════════════
-- Хронология рассмотрения
-- ═══════════════════════════════════════════════════════════════
create table bill_event (
  id            bigserial primary key,
  bill_number   text not null references bill(number) on delete cascade,
  event_num     text,                    -- ★ data-eventnum из СОЗД, напр. "1.1"
  stage_id      smallint references ref_stage(id),
  phase_id      smallint references ref_phase(id),
  event_date    date,
  title         text,
  solution      text,
  instance      text,                    -- ГД / СФ / Президент
  raw           jsonb not null default '{}'::jsonb,
  source        text not null,           -- 'duma_api' | 'sozd_card'
  unique (bill_number, event_num, event_date, title)
);
create index on bill_event (bill_number, event_date);

-- ═══════════════════════════════════════════════════════════════
-- Документы (content-addressed)
-- ═══════════════════════════════════════════════════════════════
create type doc_format as enum ('doc','docx','pdf','rtf','zip','html','txt','other');
create type extract_status as enum ('pending','ok','ocr_ok','failed','skipped');

create table document (
  sha256          char(64) primary key,      -- ★ content-addressed
  storage_path    text not null,             -- Supabase Storage key
  format          doc_format not null,
  byte_size       bigint not null,
  page_count      integer,
  source_url      text,
  source_host     text,                      -- 'sozd.duma.gov.ru' | 'publication.pravo.gov.ru'
  extract_status  extract_status not null default 'pending',
  extract_engine  text,                      -- 'mammoth' | 'word-extractor' | 'pdf-parse' | 'tesseract'
  extract_error   text,
  plain_text      text,
  text_length     integer generated always as (length(plain_text)) stored,
  lang            text default 'ru',
  fetched_at      timestamptz not null default now(),
  extracted_at    timestamptz
);
create index on document (extract_status) where extract_status in ('pending','failed');
create index doc_fts on document using gin (to_tsvector('russian', coalesce(plain_text,'')));

create table bill_document (
  bill_number   text not null references bill(number) on delete cascade,
  document_sha  char(64) not null references document(sha256),
  title         text,                        -- div.doc_wrap: "Текст законопроекта", "ФЭО", ...
  doc_date      date,
  event_num     text,                        -- к какому этапу относится
  sozd_guid     text,                        -- GUID из /download/{GUID}
  ordinal       integer,
  primary key (bill_number, document_sha, coalesce(event_num,''))
);
create index on bill_document (document_sha);

-- ═══════════════════════════════════════════════════════════════
-- Официально опубликованные акты (publication.pravo.gov.ru)
-- ═══════════════════════════════════════════════════════════════
create table act (
  eo_number             char(16) primary key,   -- ★ "0001202601170001"
  pravo_id              uuid unique,
  complex_name          text,
  title                 text,
  name                  text,
  number                text,                   -- "273-ФЗ"
  number_normalized     text,                   -- "273-fz" — для матчинга с bill.fz_number
  document_date         date,
  publish_date          date,
  jd_reg_number         text,                   -- Минюст
  jd_reg_date           date,
  pages_count           integer,
  pdf_file_length       bigint,
  zip_file_length       bigint,
  has_svg               boolean default false,
  signatory_authority_id uuid,
  document_type_id      uuid,
  block_code            text,
  pdf_document_sha      char(64) references document(sha256),
  is_official_publication boolean not null default true,
  raw                   jsonb not null default '{}'::jsonb,
  fetched_at            timestamptz not null default now()
);
create index on act (publish_date desc);
create index on act (number_normalized);
create index on act (document_date);

create table ref_signatory_authority (id uuid primary key, name text not null, weight integer);
create table ref_document_type       (id uuid primary key, name text not null, weight integer);
create table ref_public_block (
  id uuid primary key, code text unique, name text, short_name text,
  menu_name text, parent_id uuid references ref_public_block(id),
  weight integer, is_blocked boolean default false
);

-- ═══════════════════════════════════════════════════════════════
-- Чанки для RAG
-- ═══════════════════════════════════════════════════════════════
create table chunk (
  id             bigserial primary key,
  document_sha   char(64) not null references document(sha256) on delete cascade,
  chunk_index    integer not null,
  text           text not null,
  token_count    integer,
  -- структурная привязка — критично для точных ссылок
  struct_path    text,        -- "Статья 12 / часть 3 / пункт 2"
  article_no     text,
  part_no        text,
  item_no        text,
  char_start     integer,
  char_end       integer,
  simhash        bigint,      -- near-dup detection
  vector_id      text,        -- point id в Qdrant
  created_at     timestamptz not null default now(),
  unique (document_sha, chunk_index)
);
create index on chunk (document_sha);
create index on chunk (simhash);
create index chunk_fts on chunk using gin (to_tsvector('russian', text));

-- ═══════════════════════════════════════════════════════════════
-- Операционные таблицы ингеста
-- ═══════════════════════════════════════════════════════════════
create table crawl_log (
  id           bigserial primary key,
  source       text not null,
  url          text not null,
  http_status  integer,
  bytes        bigint,
  duration_ms  integer,
  etag         text,
  last_modified text,
  fetched_via  text,          -- 'undici' | 'playwright'
  error        text,
  fetched_at   timestamptz not null default now()
);
create index on crawl_log (source, fetched_at desc);
create index on crawl_log (url, fetched_at desc);

create table sync_cursor (
  source        text primary key,   -- 'duma_api' | 'pravo_api' | 'sozd_cards'
  cursor_value  text not null,      -- дата или номер страницы
  updated_at    timestamptz not null default now()
);
```

### 12.1. Векторное хранилище

**[INFERRED] Рекомендация: Qdrant, не Milvus.** Обоснование:
- Нативный TS/JS клиент (`@qdrant/js-client-rest`), первоклассная поддержка.
- Single-binary / один Docker‑контейнер — на порядок проще Milvus (etcd + MinIO + Pulsar + прокси).
- **Payload filtering** — критично для этого домена: фильтр по `convocation`, `status_code`,
  `committee_id`, `date_range` **до** ANN‑поиска. Milvus умеет, но Qdrant делает это удобнее.
- Named vectors — можно держать dense (`rubert`) и sparse (BM25/SPLADE) в одной коллекции → гибридный поиск «из коробки».

Коллекция:
```
collection: doomatel_chunks
vectors:
  dense:  { size: 768, distance: Cosine }     # ruBERT-подобный энкодер
  sparse: BM25/SPLADE
payload:
  chunk_id, document_sha, bill_number, act_eo_number,
  convocation, status_code, committee_ids[], topic_id, law_class_id,
  doc_title, struct_path, article_no, event_num, doc_date, publish_date, is_official
```
Все payload‑поля индексировать (`create_payload_index`) — иначе фильтрация деградирует.

### 12.2. Граф знаний (TypeDB)

> **⚠️ ОТМЕНЕНО.** Этот раздел устарел. В исследовании 05 TypeDB отвергнут
> как система записи: gRPC-драйвер для Node.js не портирован на 3.x, а
> единственный путь из TypeScript — HTTP-обёртка без пула соединений и
> потоковой передачи. Принятое решение: **единственная система записи —
> PostgreSQL**, граф моделируется таблицей `legal_edge` и рекурсивными CTE
> (реализовано в `packages/db/src/schema/corpus.ts`). Раздел оставлен
> для истории решения.

**[INFERRED]** Что реально стоит класть в граф (а не в Postgres):
- `bill --amends--> act` и `act --amended_by--> act` — сеть внесения изменений.
- `article --references--> article` — перекрёстные ссылки между статьями разных НПА.
- `deputy --initiated--> bill`, `deputy --member_of--> committee/faction`.
- `bill --supersedes--> bill` (альтернативные законопроекты по одному предмету).

Именно транзитивные запросы («какие действующие нормы затронет этот законопроект по цепочке
отсылок на глубину 3») оправдывают графовую БД. Простые связи 1:N — оставить в Postgres.

> **[UNVERIFIED] Риск TypeDB:** экосистема и TS‑драйвер значительно менее зрелые, чем у Postgres/Qdrant,
> а версия 3.x была несовместимым переписыванием. **Требуется отдельное исследование
> (см. док 02) перед фиксацией выбора.** Запасной вариант — Apache AGE (расширение
> Postgres, openCypher) или Neo4j: это оставит граф в той же БД и снимет целый класс
> операционных рисков.

---

## 13. Открытые вопросы (требуют проверки с российского IP)

Все — блокирующие для планирования:

1. **Жив ли `api.duma.gov.ru`?** Отдаёт ли `/api/{token}/search.json` 200? Работает ли форма `/key-request`?
2. **Выдаётся ли `app_token`** сегодня, за какой срок, какие требования к заявителю?
   Действует ли лимит 50 000/сут?
3. **Содержимое `robots.txt`** всех четырёх хостов; наличие `Crawl-delay`.
4. **Точное имя метода стенограмм по законопроекту** (`/transcript...`) и формат `kodz`/`kodvopr`.
5. **Есть ли ZIP среди вложений СОЗД** и что внутри (пакет документов при внесении?).
6. **Доля скан‑PDF** в СОЗД и на pravo.gov.ru → бюджет на OCR (это может быть 10× разница в стоимости пайплайна).
7. **Присутствует ли Cloudflare/CAPTCHA** на СОЗД при нагрузке > 1 rps.
8. **Пользовательское соглашение** СОЗД и pravo.gov.ru — есть ли явный запрет автоматизированного сбора.
9. **Юридическая позиция по RusLawOD (CC BY-NC)** для коммерческого продукта — нужно заключение юриста.
10. **Схема нумерации 9-го созыва** (выборы сентябрь 2026) — не сломает ли она формат `NNNNNN-C`.
11. **Точный состав `publication.pravo.gov.ru/OpenData`** — вдруг там есть готовые дампы,
    которые снимут необходимость в API‑бэкфиле.
12. **Подтвердить структуру `eoNumber`** (`блок:4 + ГГГГММДД:8 + N:4`).

---

## 14. Рекомендуемая последовательность реализации

| Этап | Содержание | Зачем именно так |
|---|---|---|
| **0** | Поднять ingest‑воркер на **российском хосте**; прогнать чек‑лист §13 | Без этого любые оценки — фантазия |
| **1** | `pravo-api` коннектор + ежедневный опрос | Самый простой и надёжный источник: JSON, без авторизации, без rate‑limit |
| **2** | `duma-api` коннектор + справочники + `bill` UPSERT | Даёт весь скелет метаданных дёшево |
| **3** | Пайплайн извлечения текста (docx/doc/rtf/pdf + OCR) | Общий для всех источников; отладить на PDF с pravo.gov.ru |
| **4** | `sozd-card` + `sozd-download` (Playwright fallback) | Самая хрупкая часть — строить последней, когда остальное стабильно |
| **5** | Чанкинг со структурной привязкой + Qdrant | Качество RAG определяется структурной разметкой, не эмбеддером |
| **6** | Мост `bill ↔ act`, граф связей | Даёт продуктовую ценность, ради которой всё затевалось |

**Критический архитектурный принцип:** каждый коннектор пишет **сырой ответ в `raw_*` jsonb**
до всякой нормализации. Схемы источников будут меняться, а гео‑доступ хрупок — повторно
скачать будет дорого или невозможно. Сырьё дешевле места, чем повторный обход.

---

## Приложение A. Полный реестр проверенных URL

```
# ── Duma API ───────────────────────────────────────────────────
http://api.duma.gov.ru/
http://api.duma.gov.ru/key-request
http://api.duma.gov.ru/pages/dokumentatsiya
http://api.duma.gov.ru/pages/dokumentatsiya/spravochnik-po-api
http://api.duma.gov.ru/pages/dokumentatsiya/obrashchenie-k-api
http://api.duma.gov.ru/pages/dokumentatsiya/osnovnie-svedeniya
http://api.duma.gov.ru/pages/dokumentatsiya/poisk-po-zakonoproektam
http://api.duma.gov.ru/pages/dokumentatsiya/svedeniya-o-golosovanii
http://api.duma.gov.ru/pages/dokumentatsiya/svedeniya-o-deputate
http://api.duma.gov.ru/pages/dokumentatsiya/stenogrammi-po-zakonoproektu
http://api.duma.gov.ru/pages/dokumentatsiya/stenogramma-rassmotreniya-voprosa
http://api.duma.gov.ru/pages/dokumentatsiya/voprosi-zasedaniy-gosudarstvennoy-dumi
http://api.duma.gov.ru/pages/dokumentatsiya/primeri-zaprosov-k-api-ais-zakonoproekt
http://api.duma.gov.ru/pages/dokumentatsiya/ispolzovanie-api-ais-zakonoproekt-v-php
http://api.duma.gov.ru/examples/ex_php.php
http://api.duma.gov.ru/api/{token}/{method}.{json|xml|rss}?app_token={app_token}
http://api.duma.gov.ru/api/{token}/{kodz}/{kodvopr}.json?app_token={app_token}
http://api.duma.gov.ru/api/{token}/vote/{id}.json?app_token={app_token}
http://vote.duma.gov.ru/vote/{id}

# ── СОЗД ───────────────────────────────────────────────────────
https://sozd.duma.gov.ru/bill/{N}-{созыв}
https://sozd.duma.gov.ru/download/{GUID}
https://sozd.duma.gov.ru/oz
https://sozd.duma.gov.ru/oz/b?class=b&count_items=250&page={n}
https://sozd.duma.gov.ru/search?q={q}&page={n}#data_source_tab_b
https://sozd.duma.gov.ru/calendar/b/day/{YYYY-MM-DD}/{YYYY-MM-DD}
https://sozd.duma.gov.ru/oz_info_spzi/spzi_list
https://sozd.duma.gov.ru/stat/spzigd
https://sozd.parlament.gov.ru/bill/{N}-{созыв}        # алиас
http://asozd2.duma.gov.ru/main.nsf/(Spravka)?OpenAgent&RN={N}-{созыв}   # легаси

# ── pravo.gov.ru ───────────────────────────────────────────────
http://publication.pravo.gov.ru/api/PublicBlocks/?parent={code}
http://publication.pravo.gov.ru/api/Categories?block={code}
http://publication.pravo.gov.ru/api/SignatoryAuthorities?block={code}&category={code}
http://publication.pravo.gov.ru/api/DocumentTypes?block=&category=&SignatoryAuthorityId=
http://publication.pravo.gov.ru/api/Documents?PageSize=200&Index=1&SortedBy=4&SortDestination=1
http://publication.pravo.gov.ru/api/Document?eoNumber={eo}
http://publication.pravo.gov.ru/api/BlockStatistics/{daily|weekly|monthly}
http://publication.pravo.gov.ru/Document/View/{eo}
http://publication.pravo.gov.ru/document/{eo}?index={n}
http://publication.pravo.gov.ru/file/pdf?eoNumber={eo}
http://publication.pravo.gov.ru/GetImage?documentId={id}&pageNumber={n}
http://publication.pravo.gov.ru/documents/block/{block}?index={n}
http://publication.pravo.gov.ru/OpenData
http://publication.pravo.gov.ru/help
http://pravo.gov.ru/
```

## Приложение B. Проверенные npm‑пакеты (2026-08-20)

```
mammoth@1.12.1          officeparser@7.8.0     pdf-parse@2.4.5
pdfjs-dist@6.2.108      rtf-parser@1.3.3       node-unrtf@7.1.2
word-extractor@1.0.4    tesseract.js@7.0.0     playwright@1.62.1
crawlee@3.18.1          cheerio@1.2.0          undici@8.10.0
p-queue@9.3.3           bottleneck@2.19.5
```
Не существует: `@rtf-js/rtf-parser`.
