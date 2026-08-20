import postgres from 'postgres';
import * as Y from 'yjs';

/**
 * Хранение состояния совместного редактирования.
 *
 * Схема — журнал обновлений с периодическим сворачиванием:
 *
 *  - каждое изменение дописывается в `draft_yjs_update`; запись дешёвая
 *    и не требует блокировок;
 *  - при отключении последнего участника журнал сворачивается в снимок
 *    `draft.yjs_state`, а записи журнала удаляются.
 *
 * Почему не «переписывать снимок при каждом изменении»: при активном
 * совместном редактировании изменения приходят десятками в секунду,
 * и перезапись снимка целиком превращается в узкое место и в источник
 * конфликтов записи.
 *
 * Почему не полагаться на снимок в памяти: перезапуск сервиса не должен
 * терять правки. Документ, ожидающий визы, живёт неделями.
 */

export interface PersistenceOptions {
  databaseUrl: string;
  /** Порог числа записей журнала, после которого выполняется сворачивание. */
  compactAfterUpdates?: number;
}

export class DraftPersistence {
  private readonly sql: postgres.Sql;
  private readonly compactAfter: number;

  constructor(options: PersistenceOptions) {
    this.sql = postgres(options.databaseUrl, { max: 5, onnotice: () => undefined });
    this.compactAfter = options.compactAfterUpdates ?? 200;
  }

  /** Восстанавливает документ: снимок плюс накопленные обновления. */
  async load(draftId: string): Promise<Uint8Array | null> {
    const [snapshot] = await this.sql<Array<{ yjs_state: Buffer | null }>>`
      select yjs_state from public.draft where id = ${draftId}::uuid
    `;
    if (!snapshot) return null;

    const updates = await this.sql<Array<{ update: Buffer }>>`
      select update from public.draft_yjs_update
      where draft_id = ${draftId}::uuid
      order by id
    `;

    if (!snapshot.yjs_state && updates.length === 0) return null;

    const document = new Y.Doc();
    if (snapshot.yjs_state) {
      Y.applyUpdate(document, new Uint8Array(snapshot.yjs_state));
    }
    for (const row of updates) {
      Y.applyUpdate(document, new Uint8Array(row.update));
    }
    return Y.encodeStateAsUpdate(document);
  }

  /** Дописывает обновление в журнал. */
  async append(draftId: string, update: Uint8Array): Promise<void> {
    await this.sql`
      insert into public.draft_yjs_update (draft_id, update)
      values (${draftId}::uuid, ${Buffer.from(update)})
    `;
  }

  /** Число накопленных обновлений — для решения о сворачивании. */
  async pendingUpdates(draftId: string): Promise<number> {
    const [row] = await this.sql<Array<{ count: string }>>`
      select count(*)::text as count from public.draft_yjs_update
      where draft_id = ${draftId}::uuid
    `;
    return Number(row?.count ?? 0);
  }

  /**
   * Сворачивает журнал в снимок.
   *
   * Выполняется в транзакции и удаляет только те записи, которые вошли
   * в снимок: обновления, пришедшие во время сворачивания, сохраняются.
   * Иначе при активном редактировании сворачивание теряло бы правки.
   */
  async compact(draftId: string, plainText?: string): Promise<{ compacted: number }> {
    return this.sql.begin(async (tx) => {
      const updates = await tx<Array<{ id: string; update: Buffer }>>`
        select id::text as id, update from public.draft_yjs_update
        where draft_id = ${draftId}::uuid
        order by id
        for update
      `;
      if (updates.length === 0) return { compacted: 0 };

      const [current] = await tx<Array<{ yjs_state: Buffer | null }>>`
        select yjs_state from public.draft where id = ${draftId}::uuid
      `;

      const document = new Y.Doc();
      if (current?.yjs_state) Y.applyUpdate(document, new Uint8Array(current.yjs_state));
      for (const row of updates) Y.applyUpdate(document, new Uint8Array(row.update));

      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      const stateVector = Buffer.from(Y.encodeStateVector(document));
      const lastId = updates[updates.length - 1]!.id;

      await tx`
        update public.draft
        set yjs_state = ${state},
            yjs_state_vector = ${stateVector}
            ${plainText === undefined ? tx`` : tx`, plain_text = ${plainText}`}
        where id = ${draftId}::uuid
      `;
      await tx`
        delete from public.draft_yjs_update
        where draft_id = ${draftId}::uuid and id <= ${lastId}::bigint
      `;

      return { compacted: updates.length };
    }) as Promise<{ compacted: number }>;
  }

  /** Нужно ли свернуть журнал прямо сейчас. */
  async shouldCompact(draftId: string): Promise<boolean> {
    return (await this.pendingUpdates(draftId)) >= this.compactAfter;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
