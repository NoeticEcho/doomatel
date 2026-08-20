'use client';

import { useRef, useState } from 'react';
import { Loader2, Send, Square } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Диалог с помощником.
 *
 * Ответ приходит потоком: работа над правовым вопросом занимает десятки
 * секунд, и депутат должен видеть ход рассуждения, а не пустой экран.
 * Прерывание обязательно — если помощник пошёл не туда, ждать окончания
 * бессмысленно.
 */

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantPanelProps {
  /** Агент: supervisor, analyst, drafter, expert, finance, speech. */
  agentId?: string;
  projectId?: string;
  getToken: () => string | undefined | Promise<string | undefined>;
  className?: string;
}

const AGENT_LABELS: Record<string, string> = {
  supervisor: 'Координатор',
  analyst: 'Правовой аналитик',
  drafter: 'Составитель',
  expert: 'Эксперт по экспертизе',
  finance: 'Финансовый аналитик',
  speech: 'Помощник по выступлениям',
};

export function AssistantPanel({
  agentId = 'supervisor',
  projectId,
  getToken,
  className,
}: AssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3001'}/api/agents/stream`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            agentId,
            messages: next.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            ...(projectId ? { projectId } : {}),
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok || !response.body) {
        throw new Error(
          response.status === 503
            ? 'Помощник недоступен. Поиск и работа с документами при этом доступны.'
            : `Ошибка обращения к помощнику (${response.status})`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((current) => {
          const updated = [...current];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + chunk };
          }
          return updated;
        });
      }
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') {
        setError((cause as Error).message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <header className="border-b border-[color:var(--color-line)] px-4 py-3">
        <h2 className="text-sm font-semibold">{AGENT_LABELS[agentId] ?? agentId}</h2>
        <p className="text-xs text-[color:var(--color-muted)]">
          Каждое утверждение о праве приводится со ссылкой на норму
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-sm text-[color:var(--color-muted)]">
            Задайте вопрос о действующем регулировании или поручите подготовить документ.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              message.role === 'user'
                ? 'ml-8 bg-[color:var(--color-accent-soft)]'
                : 'mr-4 border border-[color:var(--color-line)] bg-white',
            )}
          >
            {message.content || (
              <span className="inline-flex items-center gap-2 text-[color:var(--color-muted)]">
                <Loader2 aria-hidden className="size-3 animate-spin" />
                Готовит ответ…
              </span>
            )}
          </div>
        ))}
        {error && (
          <p className="rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/5 px-3 py-2 text-sm">
            {error}
          </p>
        )}
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-[color:var(--color-line)] p-3">
        <label htmlFor="assistant-input" className="sr-only">
          Вопрос помощнику
        </label>
        <textarea
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              void send(event as unknown as React.FormEvent);
            }
          }}
          rows={2}
          placeholder="Вопрос помощнику…"
          className="flex-1 resize-none rounded-md border border-[color:var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus-visible:border-[color:var(--color-accent)]"
        />
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="self-end rounded-md border border-[color:var(--color-line)] px-3 py-2"
            aria-label="Прервать"
          >
            <Square aria-hidden className="size-4" />
          </button>
        ) : (
          <button
            type="submit"
            className="self-end rounded-md bg-[color:var(--color-accent)] px-3 py-2 text-white"
            aria-label="Отправить"
          >
            <Send aria-hidden className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}
