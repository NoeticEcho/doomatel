import { describe, expect, it, vi } from 'vitest';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { buildPayload, indexChunks, pointId, IndexerError } from '../src/indexer.js';
import { chunkAct } from '../src/chunking/legal-chunker.js';
import type { EmbeddingsClient } from '../src/embeddings/client.js';

const ACT = {
  type: 'federal-law' as const,
  number: '149-ФЗ',
  date: '2006-07-27',
  title: 'Об информации',
};

const TEXT = `Статья 1. Сфера действия

1. Настоящий Федеральный закон регулирует отношения при поиске информации.
2. Положения не распространяются на охрану результатов интеллектуальной деятельности.

Статья 2. Основные понятия

В настоящем Федеральном законе используются основные понятия, определяющие
порядок обработки сведений и применения информационных технологий в стране.
`;

function fakeEmbeddings(dimension = 4): EmbeddingsClient {
  return {
    model: 'test/model',
    embedDocuments: vi.fn(async (texts: string[]) =>
      texts.map((_, index) => Array.from({ length: dimension }, (_, i) => (index + i) / 10)),
    ),
    embedQuery: vi.fn(async () => Array.from({ length: dimension }, () => 0.1)),
  } as unknown as EmbeddingsClient;
}

function fakeQdrant() {
  const upserts: Array<{ collection: string; points: unknown[] }> = [];
  const client = {
    upsert: vi.fn(async (collection: string, payload: { points: unknown[] }) => {
      upserts.push({ collection, points: payload.points });
      return { status: 'ok' };
    }),
    delete: vi.fn(async () => ({ status: 'ok' })),
  } as unknown as QdrantClient;
  return { client, upserts };
}

describe('идентификатор точки', () => {
  const chunks = chunkAct(TEXT, { act: ACT }).map((chunk) => ({
    ...chunk,
    workUri: 'eli:rf:federal-law:2006-07-27:149-fz',
  }));

  it('устойчив: одинаковый вход даёт одинаковый идентификатор', () => {
    expect(pointId(chunks[0]!)).toBe(pointId({ ...chunks[0]! }));
  });

  it('имеет форму UUID — этого требует хранилище', () => {
    expect(pointId(chunks[0]!)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
  });

  it('разные фрагменты получают разные идентификаторы', () => {
    const ids = chunks.map((chunk) => pointId(chunk));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('не зависит от текста: изменённая норма обновляется на месте', () => {
    // Иначе правка нормы добавляла бы новый фрагмент рядом со старым,
    // и поиск возвращал бы обе редакции как действующие.
    const edited = { ...chunks[0]!, text: 'Совершенно другой текст нормы' };
    expect(pointId(edited)).toBe(pointId(chunks[0]!));
  });

  it('редакции на разные даты различаются', () => {
    const older = { ...chunks[0]!, validFrom: '2006-07-27' };
    const newer = { ...chunks[0]!, validFrom: '2024-08-08' };
    expect(pointId(older)).not.toBe(pointId(newer));
  });
});

describe('полезная нагрузка точки', () => {
  const chunk = {
    ...chunkAct(TEXT, { act: ACT })[0]!,
    workUri: 'eli:rf:federal-law:2006-07-27:149-fz',
    actNumber: '149-ФЗ',
  };

  const payload = buildPayload(chunk, {
    embedModel: 'test/model',
    embedModelRevision: 'rev1',
    embedDim: 4,
  });

  it('содержит готовую ссылку для цитирования', () => {
    expect(payload['citation_short']).toContain('ст. 1');
  });

  it('содержит модель и её ревизию — иначе переиндексация вслепую', () => {
    expect(payload['embed_model']).toBe('test/model');
    expect(payload['embed_model_rev']).toBe('rev1');
    expect(payload['embed_dim']).toBe(4);
  });

  it('нормализует номер акта для точного поиска по реквизитам', () => {
    expect(payload['act_number_normalized']).toBe('149-фз');
  });

  it('по умолчанию фрагмент публичный', () => {
    expect(payload['tenant_id']).toBe('public');
    expect(payload['visibility']).toBe('public');
  });
});

describe('индексация', () => {
  it('записывает плотный и разрежённый векторы', async () => {
    const { client, upserts } = fakeQdrant();
    const chunks = chunkAct(TEXT, { act: ACT }).map((chunk) => ({
      ...chunk,
      workUri: 'eli:rf:federal-law:2006-07-27:149-fz',
    }));

    const result = await indexChunks(chunks, {
      qdrant: client,
      embeddings: fakeEmbeddings(),
      collection: 'legal_chunks',
      embedModelRevision: 'rev1',
    });

    expect(result.indexed).toBe(chunks.length);
    expect(upserts).toHaveLength(1);

    const point = upserts[0]!.points[0] as {
      vector: { dense: number[]; bm25: { indices: number[] } };
    };
    expect(point.vector.dense).toHaveLength(4);
    expect(point.vector.bm25.indices.length).toBeGreaterThan(0);
  });

  it('пропускает пустые фрагменты, а не индексирует пустоту', async () => {
    const { client } = fakeQdrant();
    const base = chunkAct(TEXT, { act: ACT })[0]!;
    const result = await indexChunks(
      [
        { ...base, path: 'st_1', text: '   ' },
        { ...base, path: 'st_2', text: 'Содержательная норма.' },
      ],
      {
        qdrant: client,
        embeddings: fakeEmbeddings(),
        collection: 'legal_chunks',
        embedModelRevision: 'rev1',
      },
    );
    expect(result.skipped).toBe(1);
    expect(result.indexed).toBe(1);
  });

  it('прекращает работу при несоответствии числа векторов', async () => {
    const { client } = fakeQdrant();
    const broken = {
      model: 'test/model',
      embedDocuments: vi.fn(async () => [[0.1, 0.2]]),
      embedQuery: vi.fn(async () => [0.1]),
    } as unknown as EmbeddingsClient;

    // Записать часть данных при рассинхронизации хуже, чем не записать
    // ничего: несоответствие текста и вектора внешне незаметно.
    const base = chunkAct(TEXT, { act: ACT })[0]!;
    await expect(
      indexChunks(
        [
          { ...base, path: 'st_1' },
          { ...base, path: 'st_2' },
        ],
        {
          qdrant: client,
          embeddings: broken,
          collection: 'legal_chunks',
          embedModelRevision: 'rev1',
        },
      ),
    ).rejects.toThrow(IndexerError);
  });

  it('на пустом наборе ничего не делает', async () => {
    const { client, upserts } = fakeQdrant();
    const result = await indexChunks([], {
      qdrant: client,
      embeddings: fakeEmbeddings(),
      collection: 'legal_chunks',
      embedModelRevision: 'rev1',
    });
    expect(result).toEqual({ indexed: 0, skipped: 0, pointIds: [] });
    expect(upserts).toHaveLength(0);
  });

  it('записывает пакетами заданного размера', async () => {
    const { client, upserts } = fakeQdrant();
    const many = Array.from({ length: 5 }, (_, index) => ({
      ...chunkAct(TEXT, { act: ACT })[0]!,
      path: `st_${index + 1}`,
      workUri: 'eli:rf:federal-law:2006-07-27:149-fz',
    }));

    await indexChunks(many, {
      qdrant: client,
      embeddings: fakeEmbeddings(),
      collection: 'legal_chunks',
      embedModelRevision: 'rev1',
      batchSize: 2,
    });

    expect(upserts).toHaveLength(3);
  });
});
