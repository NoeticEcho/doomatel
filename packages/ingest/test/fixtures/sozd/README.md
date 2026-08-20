# Фикстуры СОЗД

## ⚠️ Статус фикстур

`bill-card.synthetic.html` — **синтетическая** фикстура, собранная по описанию
DOM-структуры карточки законопроекта из открытых парсеров СОЗД
(идентификаторы `#oz_name`, `#number_oz_id`, `#current_oz_status`, атрибут
`data-eventnum`, классы `.table_icona` / `.table_iconatd1` / `.doc_wrap`).
Она **не является снимком реальной страницы** и проверяет только контракт
парсера, а не соответствие живой вёрстке.

## Как получить настоящие фикстуры

Из среды с доступом к `sozd.duma.gov.ru` (то есть из России):

```bash
pnpm --filter @doomatel/ingest build
node packages/ingest/dist/cli.js capture \
  --bill 149922-8 --bill 792837-7 --bill 7902-3 \
  --out packages/ingest/test/fixtures/sozd
```

После этого запустите `pnpm --filter @doomatel/ingest test` — тест
`bill-card.real.test.ts` подхватит все фикстуры `*.json` из этого каталога
и проверит парсер на реальной вёрстке. Пока реальных фикстур нет, этот тест
пропускается (`it.skip`), и в отчёте видно, что покрытие неполное.
