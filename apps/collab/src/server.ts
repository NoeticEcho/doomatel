import { Server } from '@hocuspocus/server';
import { CollabAuth, CollabAuthError, parseDocumentName, type DocumentAccess } from './auth.js';
import { DraftPersistence } from './persistence.js';

/**
 * Сервис совместного редактирования.
 *
 * Отдельный процесс, а не часть прикладного сервиса: соединения живут часами,
 * и перезапуск прикладного сервиса при выкладке не должен разрывать сеансы
 * редактирования. Обратное тоже верно — обновление правил редактора
 * не требует перезапуска прикладного сервиса.
 */

export interface CollabServerOptions {
  port: number;
  databaseUrl: string;
  supabaseUrl?: string;
  jwtSecret?: string;
  /** Порог сворачивания журнала обновлений. */
  compactAfterUpdates?: number;
}

export function createCollabServer(options: CollabServerOptions) {
  const auth = new CollabAuth({
    databaseUrl: options.databaseUrl,
    ...(options.supabaseUrl ? { supabaseUrl: options.supabaseUrl } : {}),
    ...(options.jwtSecret ? { jwtSecret: options.jwtSecret } : {}),
  });

  const persistence = new DraftPersistence({
    databaseUrl: options.databaseUrl,
    ...(options.compactAfterUpdates ? { compactAfterUpdates: options.compactAfterUpdates } : {}),
  });

  const server = new Server({
    port: options.port,
    name: 'doomatel-collab',

    async onAuthenticate(data) {
      const token = data.token;
      if (!token) throw new CollabAuthError('Требуется токен доступа');

      const access = await auth.authorize(token, data.documentName);

      // Рецензент подключается в режиме чтения: правки он вносит
      // предложениями через прикладной сервис, а не изменением текста.
      if (!access.canWrite) {
        data.connectionConfig.readOnly = true;
      }

      return { access };
    },

    async onLoadDocument(data) {
      const { draftId } = parseDocumentName(data.documentName);
      const state = await persistence.load(draftId);
      if (state) {
        const { applyUpdate } = await import('yjs');
        applyUpdate(data.document, state);
      }
      return data.document;
    },

    async onStoreDocument(data) {
      const { draftId } = parseDocumentName(data.documentName);
      const { encodeStateAsUpdate } = await import('yjs');
      await persistence.append(draftId, encodeStateAsUpdate(data.document));

      if (await persistence.shouldCompact(draftId)) {
        await persistence.compact(draftId, extractPlainText(data.document));
      }
    },

    // Последний участник отключился — сворачиваем журнал и записываем
    // простой текст для поиска и разбора.
    async onDisconnect(data) {
      if (data.clientsCount > 0) return;
      const { draftId } = parseDocumentName(data.documentName);
      await persistence.compact(draftId, extractPlainText(data.document));
    },
  });

  return {
    server,
    async listen() {
      await server.listen();
    },
    async close() {
      await server.destroy();
      await Promise.all([auth.close(), persistence.close()]);
    },
  };
}

/**
 * Извлекает простой текст из документа.
 *
 * Нужен для полнотекстового поиска и для детерминированного разбора ссылок:
 * оба работают с текстом, а не со структурой редактора.
 */
export function extractPlainText(document: {
  getXmlFragment: (name: string) => { toString(): string };
}): string {
  try {
    const fragment = document.getXmlFragment('default');
    return fragment
      .toString()
      .replace(/<[^>]+>/gu, '\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  } catch {
    return '';
  }
}

export type { DocumentAccess };
