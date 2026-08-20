import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { EmbeddingsClient, RerankerClient } from '@doomatel/retrieval';

/** Клиенты поискового слоя. */
@Injectable()
export class QdrantService {
  readonly client: QdrantClient;
  readonly embeddings: EmbeddingsClient;
  readonly reranker?: RerankerClient;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('QDRANT_API_KEY');
    this.client = new QdrantClient({
      url: config.get<string>('QDRANT_URL') ?? 'http://127.0.0.1:6333',
      ...(apiKey ? { apiKey } : {}),
    });

    const embeddingsKey = config.get<string>('EMBEDDINGS_API_KEY');
    this.embeddings = new EmbeddingsClient({
      baseUrl: config.get<string>('EMBEDDINGS_BASE_URL') ?? 'http://127.0.0.1:8001/v1',
      ...(embeddingsKey ? { apiKey: embeddingsKey } : {}),
      model: config.get<string>('EMBEDDINGS_MODEL') ?? 'deepvk/USER-bge-m3',
      dimensions: Number(config.get<string>('EMBEDDINGS_DIMENSIONS') ?? 1024),
    });

    const rerankerUrl = config.get<string>('RERANKER_URL');
    const rerankerModel = config.get<string>('RERANKER_MODEL');
    if (rerankerUrl) {
      this.reranker = new RerankerClient({
        url: rerankerUrl,
        ...(rerankerModel ? { model: rerankerModel } : {}),
      });
    }
  }
}
