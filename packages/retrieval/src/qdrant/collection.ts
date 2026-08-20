import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Настройка коллекций Qdrant.
 *
 * Особенности конфигурации и их основания:
 *
 *  - `hnsw_config: { m: 0, payload_m: 16 }` — глобальный граф не строится,
 *    вместо него строятся отдельные графы по ключу арендатора. Для системы,
 *    где почти каждый запрос ограничен фракцией или проектом, это и быстрее,
 *    и экономнее по памяти.
 *  - `sparse_vectors.bm25.modifier: 'idf'` — обратную документную частоту
 *    считает сервер по всему корпусу; клиент передаёт только насыщенную
 *    частоту терма.
 *  - Текстовый индекс обязан быть настроен на русский стеммер: по умолчанию
 *    Qdrant использует английский, и русские словоформы не склеиваются.
 *  - Все индексы по полям создаются **до** массовой загрузки: добавление
 *    индекса после загрузки требует повторной записи точек.
 */

export const COLLECTIONS = {
  /** Действующее право: законы, кодексы, подзаконные акты. */
  legalChunks: 'legal_chunks',
  /** Сопроводительные материалы законопроектов из СОЗД. */
  billDocs: 'bill_docs',
  /** Рабочие черновики депутатов: высокая частота записи, малый объём. */
  drafts: 'drafts',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export interface CollectionConfig {
  /** Размерность плотного вектора. Для `deepvk/USER-bge-m3` — 1024. */
  denseSize: number;
  /** Хранить плотные векторы на диске: экономит память на больших корпусах. */
  onDisk?: boolean;
  /** Квантование до int8: примерно четырёхкратная экономия памяти. */
  quantize?: boolean;
  /** Число сегментов оптимизатора. */
  segments?: number;
}

const DEFAULT_CONFIG: Required<CollectionConfig> = {
  denseSize: 1024,
  onDisk: true,
  quantize: true,
  segments: 8,
};

/** Стоп-слова, добавляемые к русским в текстовом индексе Qdrant. */
export const INDEX_CUSTOM_STOPWORDS = [
  'статья',
  'пункт',
  'часть',
  'настоящий',
  'федеральный',
  'российской',
  'федерации',
];

export interface CreateCollectionOptions extends CollectionConfig {
  /** Пересоздать коллекцию, если она уже существует. */
  recreate?: boolean;
}

/** Создаёт коллекцию со всеми индексами по полям. */
export async function ensureCollection(
  client: QdrantClient,
  name: string,
  options: CreateCollectionOptions = {} as CreateCollectionOptions,
): Promise<{ created: boolean }> {
  const config = { ...DEFAULT_CONFIG, ...options };
  const exists = await collectionExists(client, name);

  if (exists && !options.recreate) return { created: false };
  if (exists && options.recreate) await client.deleteCollection(name);

  await client.createCollection(name, {
    vectors: {
      dense: {
        size: config.denseSize,
        distance: 'Cosine',
        on_disk: config.onDisk,
      },
    },
    sparse_vectors: {
      bm25: { modifier: 'idf' },
    },
    hnsw_config: { m: 0, payload_m: 16 },
    ...(config.quantize
      ? { quantization_config: { scalar: { type: 'int8' as const, always_ram: true } } }
      : {}),
    optimizers_config: { default_segment_number: config.segments },
  });

  await createPayloadIndexes(client, name);
  return { created: true };
}

async function collectionExists(client: QdrantClient, name: string): Promise<boolean> {
  try {
    const result = await client.collectionExists(name);
    return result.exists;
  } catch {
    const list = await client.getCollections();
    return list.collections.some((collection) => collection.name === name);
  }
}

/**
 * Создаёт индексы по полям полезной нагрузки.
 *
 * Порядок важен: индекс арендатора создаётся первым, потому что от него
 * зависит построение графов HNSW.
 */
export async function createPayloadIndexes(client: QdrantClient, name: string): Promise<void> {
  await client.createPayloadIndex(name, {
    field_name: 'tenant_id',
    field_schema: { type: 'keyword', is_tenant: true },
    wait: true,
  });

  await client.createPayloadIndex(name, {
    field_name: 'text',
    field_schema: {
      type: 'text',
      tokenizer: 'word',
      lowercase: true,
      min_token_len: 2,
      max_token_len: 30,
      // Без явного указания Qdrant применяет английский стеммер,
      // и русские словоформы не приводятся к одной основе.
      stemmer: { type: 'snowball', language: 'russian' },
      stopwords: { languages: ['russian'], custom: INDEX_CUSTOM_STOPWORDS },
      phrase_matching: true,
    },
    wait: true,
  });

  const keywordFields = [
    'work_uri',
    'act_number',
    'doc_kind',
    'article_no',
    'project_id',
    'bill_number',
    'committee_id',
    'visibility',
    'owner_user_id',
    'status',
  ];
  for (const field of keywordFields) {
    await client.createPayloadIndex(name, {
      field_name: field,
      field_schema: 'keyword',
      wait: true,
    });
  }

  for (const field of ['valid_from', 'valid_to', 'act_date', 'indexed_at']) {
    await client.createPayloadIndex(name, {
      field_name: field,
      field_schema: 'datetime',
      wait: true,
    });
  }

  await client.createPayloadIndex(name, {
    field_name: 'convocation',
    field_schema: 'integer',
    wait: true,
  });
}
