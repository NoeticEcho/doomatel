import { createHash } from 'node:crypto';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { EmbeddingsClient } from './embeddings/client.js';
import { encodeDocument } from './lexical/russian.js';
import type { LegalChunk } from './chunking/legal-chunker.js';

/**
 * Индексация фрагментов в векторное хранилище.
 *
 * Три свойства, ради которых написан отдельный модуль:
 *
 * 1. **Идемпотентность.** Идентификатор точки выводится из содержимого
 *    и расположения фрагмента, поэтому повторная индексация обновляет
 *    ту же запись, а не создаёт дубликат. Ингест повторяется ежедневно,
 *    и без этого корпус разрастался бы копиями.
 *
 * 2. **Прослеживаемость модели.** В полезной нагрузке сохраняется имя
 *    и ревизия модели эмбеддингов. Без этого невозможно понять, какие
 *    фрагменты нужно переиндексировать после смены модели — а смешение
 *    векторов двух моделей в одной коллекции делает поиск бессмысленным
 *    и притом внешне работающим.
 *
 * 3. **Отказ вместо порчи.** Несовпадение размерности вектора с коллекцией
 *    прекращает индексацию, а не записывает часть данных.
 */

export interface IndexableChunk extends LegalChunk {
  /** Идентификатор акта, если фрагмент получен из акта. */
  workUri?: string;
  /** Номер законопроекта, если фрагмент получен из его материалов. */
  billNumber?: string;
  /** Арендатор: организация или `public`. */
  tenantId?: string;
  visibility?: 'public' | 'organization' | 'project' | 'private';
  projectId?: string;
  ownerUserId?: string;
  /** Период действия нормы. */
  validFrom?: string;
  validTo?: string;
  actNumber?: string;
  actDate?: string;
  convocation?: number;
  /** Ссылки, извлечённые из текста фрагмента. */
  refsOut?: string[];
}

export interface IndexerOptions {
  qdrant: QdrantClient;
  embeddings: EmbeddingsClient;
  collection: string;
  /** Ревизия модели эмбеддингов — обязательна для безопасной переиндексации. */
  embedModelRevision: string;
  /** Размер пакета при записи в хранилище. */
  batchSize?: number;
  /** Ожидать подтверждения записи. Замедляет загрузку, но делает её проверяемой. */
  waitForWrite?: boolean;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  /** Идентификаторы записанных точек — для сохранения в базе. */
  pointIds: string[];
}

export class IndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexerError';
  }
}

/**
 * Идентификатор точки.
 *
 * Выводится из источника и расположения, но **не из текста**: при
 * изменении редакции нормы фрагмент должен обновиться на месте, а не
 * появиться рядом со старым. Различение редакций обеспечивает `validFrom`
 * в составе ключа.
 */
export function pointId(chunk: IndexableChunk): string {
  const source = chunk.workUri ?? chunk.billNumber ?? 'unknown';
  const parts = [source, chunk.path, chunk.partIndex, chunk.validFrom ?? 'current'];
  const hash = createHash('sha256').update(parts.join('|')).digest('hex');
  // Qdrant принимает идентификатор в виде UUID; строим его детерминированно.
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

/** Формирует полезную нагрузку точки. */
export function buildPayload(
  chunk: IndexableChunk,
  options: { embedModel: string; embedModelRevision: string; embedDim: number },
): Record<string, unknown> {
  return {
    text: chunk.text,
    embed_input: chunk.embedInput,
    doc_kind: chunk.docKind,
    kind: chunk.kind,
    path: chunk.path,
    parent_path: chunk.parentPath ?? null,
    label: chunk.label,
    heading: chunk.heading ?? null,
    citation_short: chunk.citationShort,
    citation_full: chunk.citationFull,
    work_uri: chunk.workUri ?? null,
    bill_number: chunk.billNumber ?? null,
    act_number: chunk.actNumber ?? null,
    // Нормализованный номер нужен для точной ветви поиска по реквизитам.
    act_number_normalized: chunk.actNumber
      ? chunk.actNumber.toLowerCase().replace(/\s+/gu, '')
      : null,
    act_date: chunk.actDate ?? null,
    convocation: chunk.convocation ?? null,
    valid_from: chunk.validFrom ?? null,
    valid_to: chunk.validTo ?? null,
    tenant_id: chunk.tenantId ?? 'public',
    visibility: chunk.visibility ?? 'public',
    project_id: chunk.projectId ?? null,
    owner_user_id: chunk.ownerUserId ?? null,
    refs_out: chunk.refsOut ?? [],
    char_start: chunk.charStart,
    char_end: chunk.charEnd,
    is_partial: chunk.isPartial,
    part_index: chunk.partIndex,
    part_total: chunk.partTotal,
    embed_model: options.embedModel,
    embed_model_rev: options.embedModelRevision,
    embed_dim: options.embedDim,
    indexed_at: new Date().toISOString(),
  };
}

/** Индексирует фрагменты в векторное хранилище. */
export async function indexChunks(
  chunks: IndexableChunk[],
  options: IndexerOptions,
): Promise<IndexResult> {
  if (chunks.length === 0) return { indexed: 0, skipped: 0, pointIds: [] };

  const batchSize = options.batchSize ?? 32;
  const pointIds: string[] = [];
  let indexed = 0;
  let skipped = 0;

  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const usable = batch.filter((chunk) => chunk.text.trim().length > 0);
    skipped += batch.length - usable.length;
    if (usable.length === 0) continue;

    const vectors = await options.embeddings.embedDocuments(
      usable.map((chunk) => chunk.embedInput),
    );

    if (vectors.length !== usable.length) {
      throw new IndexerError(
        `Сервис эмбеддингов вернул ${vectors.length} векторов на ${usable.length} фрагментов. ` +
          'Индексация прекращена, чтобы не записать несоответствие текста и вектора.',
      );
    }

    const points = usable.map((chunk, index) => {
      const dense = vectors[index]!;
      const sparse = encodeDocument(chunk.text);
      const id = pointId(chunk);
      pointIds.push(id);

      return {
        id,
        vector: {
          dense,
          // Разрежённый вектор для лексической ветви поиска.
          bm25: { indices: sparse.indices, values: sparse.values },
        },
        payload: buildPayload(chunk, {
          embedModel: options.embeddings.model,
          embedModelRevision: options.embedModelRevision,
          embedDim: dense.length,
        }),
      };
    });

    await options.qdrant.upsert(options.collection, {
      wait: options.waitForWrite ?? true,
      points: points as never,
    });

    indexed += points.length;
  }

  return { indexed, skipped, pointIds };
}

/**
 * Удаляет из хранилища фрагменты, проиндексированные прежней моделью.
 *
 * Смешение векторов двух моделей в одной коллекции даёт поиск, который
 * внешне работает, но ранжирует бессмысленно: расстояния между векторами
 * разных моделей не сопоставимы. Поэтому переиндексация начинается
 * с удаления старых.
 */
export async function dropStaleVectors(
  qdrant: QdrantClient,
  collection: string,
  currentModel: string,
  currentRevision: string,
): Promise<void> {
  await qdrant.delete(collection, {
    wait: true,
    filter: {
      must_not: [
        {
          must: [
            { key: 'embed_model', match: { value: currentModel } },
            { key: 'embed_model_rev', match: { value: currentRevision } },
          ],
        },
      ],
    } as never,
  });
}
