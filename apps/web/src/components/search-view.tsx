'use client';

import { useState } from 'react';
import { Search as SearchIcon, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApi } from '@/components/api-provider';
import { searchResponseSchema, type SearchResponse, ApiError } from '@/lib/api';

/**
 * Поиск по корпусу законодательства.
 *
 * Результат показывает дословный текст нормы и **готовую ссылку** —
 * её можно скопировать в документ без переписывания. Ссылка строится
 * на сервере при индексации, а не собирается в интерфейсе: иначе
 * в разных местах она получалась бы разной.
 */
export function SearchView({ className }: { className?: string }) {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [asOf, setAsOf] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;

    setState('loading');
    setError(null);
    try {
      const result = await api.post('/api/search/legal', searchResponseSchema, {
        query: query.trim(),
        limit: 10,
        expandToArticle: true,
        ...(asOf ? { filter: { inForceOn: asOf } } : {}),
      });
      setResponse(result);
      setState('done');
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Не удалось выполнить поиск. Проверьте соединение.',
      );
      setState('error');
    }
  }

  return (
    <div className={className}>
      <form onSubmit={run} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="q" className="mb-1 block text-sm font-medium">
            Запрос
          </label>
          <input
            id="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="например: статья 15 149-ФЗ о реестре запрещённой информации"
            className="w-full rounded-md border border-[color:var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus-visible:border-[color:var(--color-accent)]"
          />
        </div>
        <div>
          <label htmlFor="asof" className="mb-1 block text-sm font-medium">
            На дату
          </label>
          <input
            id="asof"
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            className="rounded-md border border-[color:var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus-visible:border-[color:var(--color-accent)]"
          />
        </div>
        <button
          type="submit"
          disabled={state === 'loading'}
          className="inline-flex items-center gap-2 rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {state === 'loading' ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <SearchIcon aria-hidden className="size-4" />
          )}
          Найти
        </button>
      </form>

      {asOf && (
        <p className="mt-2 text-xs text-[color:var(--color-muted)]">
          Показаны нормы, действовавшие на {asOf}. Действующая редакция может отличаться.
        </p>
      )}

      <div className="mt-6" aria-live="polite">
        {state === 'error' && (
          <p className="flex items-start gap-2 rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/5 p-3 text-sm">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        {state === 'done' && response && response.results.length === 0 && (
          <p className="rounded-md border border-[color:var(--color-line)] p-4 text-sm text-[color:var(--color-muted)]">
            Ничего не найдено. Это может означать и отсутствие нормы, и то, что
            соответствующая часть корпуса ещё не загружена — второе вероятнее,
            пока система в разработке.
          </p>
        )}

        {state === 'done' && response && response.results.length > 0 && (
          <ol className="space-y-4">
            {response.results.map((result) => (
              <li
                key={String(result.id)}
                className="rounded-lg border border-[color:var(--color-line)] bg-white p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="citation">{String(result.citation ?? '')}</p>
                  <span className="shrink-0 text-xs text-[color:var(--color-muted)]">
                    близость {result.score.toFixed(2)}
                  </span>
                </div>
                <p className="legal-prose mt-2 text-[0.95rem]">{String(result.text ?? '')}</p>
                {result.citationFull ? (
                  <p className="mt-3 border-t border-[color:var(--color-line)] pt-2 text-xs text-[color:var(--color-muted)]">
                    {String(result.citationFull)}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
