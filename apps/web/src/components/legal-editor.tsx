'use client';

import { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { cn } from '@/lib/cn';
import { LegalArticle, LegalClause, LegalItem } from './legal-nodes';

/**
 * Редактор текста законопроекта.
 *
 * Три особенности, отличающие его от обычного текстового редактора:
 *
 * 1. **Структурные единицы — типы блоков, а не оформление.** Статья, часть,
 *    пункт хранятся как узлы документа с номерами. Благодаря этому правка
 *    адресуется точно («часть 3 статьи 15»), а не по смещению в тексте.
 *
 * 2. **Совместная работа без сервера-посредника для текста.** Изменения
 *    расходятся между участниками напрямую через сеанс; сервер лишь хранит
 *    состояние. Это позволяет продолжать работу при кратковременной потере
 *    связи — правки уходят при восстановлении.
 *
 * 3. **Работа без сети.** Состояние сохраняется в браузере. Заседание
 *    в зале, где связь неустойчива, не должно приводить к потере правок.
 */

export interface LegalEditorProps {
  draftId: string;
  /** Адрес сервиса совместной работы. */
  collabUrl: string;
  /** Токен доступа: сервис проверяет права на документ при подключении. */
  token: string;
  /** Имя участника — показывается соавторам. */
  userName: string;
  /** Только чтение: роль не позволяет изменять документ. */
  readOnly?: boolean;
  className?: string;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'denied';

export function LegalEditor({
  draftId,
  collabUrl,
  token,
  userName,
  readOnly = false,
  className,
}: LegalEditorProps) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [peers, setPeers] = useState(0);

  const { document, provider } = useMemo(() => {
    const doc = new Y.Doc();
    const hocuspocus = new HocuspocusProvider({
      url: collabUrl,
      name: `draft:${draftId}`,
      document: doc,
      token,
      // Не подключаться заново бесконечно: если доступ отозван, повторные
      // попытки не помогут, а будут маскировать причину.
      onAuthenticationFailed: () => setState('denied'),
    });
    return { document: doc, provider: hocuspocus };
  }, [draftId, collabUrl, token]);

  useEffect(() => {
    // Локальное хранение: правки не теряются при потере связи.
    const persistence = new IndexeddbPersistence(`doomatel-draft-${draftId}`, document);

    const onStatus = ({ status }: { status: string }) => {
      setState(status === 'connected' ? 'connected' : 'disconnected');
    };
    const onAwareness = () => {
      setPeers(Math.max(0, provider.awareness?.getStates().size ?? 1) - 1);
    };

    provider.on('status', onStatus);
    provider.on('awarenessUpdate', onAwareness);

    return () => {
      provider.off('status', onStatus);
      provider.off('awarenessUpdate', onAwareness);
      void persistence.destroy();
      provider.destroy();
      document.destroy();
    };
  }, [document, provider, draftId]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: [
        StarterKit.configure({
          // История отключена: при совместной работе отменой управляет
          // общий журнал изменений, иначе отмена затрагивала бы чужие правки.
          undoRedo: false,
        }),
        LegalArticle,
        LegalClause,
        LegalItem,
        Collaboration.configure({ document }),
      ],
      editorProps: {
        attributes: {
          class: 'legal-prose focus:outline-none min-h-[60vh]',
          spellcheck: 'true',
          lang: 'ru',
        },
      },
    },
    [document, readOnly],
  );

  useEffect(() => {
    provider.awareness?.setLocalStateField('user', {
      name: userName,
      color: colorFromName(userName),
    });
  }, [provider, userName]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <StatusBar state={state} peers={peers} readOnly={readOnly} />
      <EditorContent editor={editor} />
    </div>
  );
}

function StatusBar({
  state,
  peers,
  readOnly,
}: {
  state: ConnectionState;
  peers: number;
  readOnly: boolean;
}) {
  const label: Record<ConnectionState, string> = {
    connecting: 'Подключение…',
    connected: peers > 0 ? `Совместное редактирование: ещё ${peers}` : 'Соединение установлено',
    disconnected: 'Нет связи — правки сохраняются локально и уйдут при восстановлении',
    denied: 'Нет доступа к документу',
  };

  const tone: Record<ConnectionState, string> = {
    connecting: 'text-[color:var(--color-muted)]',
    connected: 'text-[color:var(--color-ok)]',
    disconnected: 'text-[color:var(--color-warn)]',
    denied: 'text-[color:var(--color-danger)]',
  };

  return (
    <div className="no-print flex items-center gap-3 text-xs">
      <span className={tone[state]} role="status" aria-live="polite">
        {label[state]}
      </span>
      {readOnly && (
        <span className="rounded bg-[color:var(--color-accent-soft)] px-2 py-0.5 text-[color:var(--color-accent)]">
          Только чтение — правки вносятся предложениями
        </span>
      )}
    </div>
  );
}

/** Устойчивый цвет курсора участника — один и тот же в каждом сеансе. */
function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return `oklch(0.6 0.14 ${hash % 360})`;
}
