import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CollabAuthError, parseDocumentName } from '../src/auth.js';
import { DraftPersistence } from '../src/persistence.js';
import { extractPlainText } from '../src/server.js';

const TEST_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_URL ? describe : describe.skip;

describe('имя документа', () => {
  it('разбирает корректное имя', () => {
    const id = randomUUID();
    expect(parseDocumentName(`draft:${id}`)).toEqual({ draftId: id });
  });

  it('отвергает произвольное имя', () => {
    // Иначе клиент мог бы подключиться к документу с любым именем
    // и обойти проверку прав, привязанную к идентификатору документа.
    expect(() => parseDocumentName('что-нибудь')).toThrow(CollabAuthError);
    expect(() => parseDocumentName('draft:не-uuid')).toThrow(/Некорректное имя/u);
  });
});

describe('извлечение текста', () => {
  it('превращает разметку в строки', () => {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment('default');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('Статья 1. Предмет регулирования')]);
    fragment.insert(0, [paragraph]);

    expect(extractPlainText(document)).toContain('Статья 1');
  });

  it('на пустом документе возвращает пустую строку', () => {
    expect(extractPlainText(new Y.Doc())).toBe('');
  });
});

describeIfDb('сохранение состояния совместной работы', () => {
  let sql: postgres.Sql;
  let persistence: DraftPersistence;
  let draftId: string;

  beforeAll(async () => {
    sql = postgres(TEST_URL!, { max: 3, onnotice: () => undefined });
    persistence = new DraftPersistence({ databaseUrl: TEST_URL!, compactAfterUpdates: 3 });

    const userId = randomUUID();
    const projectId = randomUUID();
    draftId = randomUUID();

    await sql`insert into auth.users (id) values (${userId}) on conflict do nothing`;
    await sql`insert into profile (id, full_name) values (${userId}, 'Тест') on conflict do nothing`;
    await sql`
      insert into project (id, scope, name, owner_id)
      values (${projectId}, 'personal', 'Проект для проверки', ${userId})
    `;
    await sql`
      insert into draft (id, project_id, kind, title, created_by)
      values (${draftId}, ${projectId}, 'bill', 'Документ', ${userId})
    `;
  }, 60_000);

  afterAll(async () => {
    await persistence?.close();
    await sql?.end({ timeout: 5 });
  });

  it('на новом документе состояния нет', async () => {
    expect(await persistence.load(draftId)).toBeNull();
  });

  it('накапливает обновления в журнале', async () => {
    const document = new Y.Doc();
    document.getText('body').insert(0, 'Первая правка. ');
    await persistence.append(draftId, Y.encodeStateAsUpdate(document));

    document.getText('body').insert(15, 'Вторая правка.');
    await persistence.append(draftId, Y.encodeStateAsUpdate(document));

    expect(await persistence.pendingUpdates(draftId)).toBe(2);
  });

  it('восстанавливает документ из журнала', async () => {
    const state = await persistence.load(draftId);
    expect(state).not.toBeNull();

    const restored = new Y.Doc();
    Y.applyUpdate(restored, state!);
    expect(restored.getText('body').toString()).toContain('Первая правка');
    expect(restored.getText('body').toString()).toContain('Вторая правка');
  });

  it('сворачивает журнал в снимок и очищает его', async () => {
    const before = await persistence.pendingUpdates(draftId);
    expect(before).toBeGreaterThan(0);

    const result = await persistence.compact(draftId, 'Первая правка. Вторая правка.');
    expect(result.compacted).toBe(before);
    expect(await persistence.pendingUpdates(draftId)).toBe(0);

    // Содержимое после сворачивания то же самое.
    const state = await persistence.load(draftId);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, state!);
    expect(restored.getText('body').toString()).toContain('Первая правка');
  });

  it('простой текст записан для поиска и разбора', async () => {
    const [row] = await sql<Array<{ plain_text: string }>>`
      select plain_text from draft where id = ${draftId}::uuid
    `;
    expect(row!.plain_text).toContain('Первая правка');
  });

  it('сворачивание пустого журнала ничего не делает', async () => {
    expect(await persistence.compact(draftId)).toEqual({ compacted: 0 });
  });

  it('сообщает о необходимости сворачивания по достижении порога', async () => {
    expect(await persistence.shouldCompact(draftId)).toBe(false);

    const document = new Y.Doc();
    for (let i = 0; i < 3; i += 1) {
      document.getText('body').insert(0, `правка ${i} `);
      await persistence.append(draftId, Y.encodeStateAsUpdate(document));
    }
    expect(await persistence.shouldCompact(draftId)).toBe(true);
  });
});
