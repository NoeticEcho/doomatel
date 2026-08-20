import { Injectable } from '@nestjs/common';
import {
  COLLECTIONS,
  expandToParents,
  hybridSearch,
  passthroughRerank,
  searchFilterSchema,
} from '@doomatel/retrieval';
import { AccessService } from '../auth/access.service.js';
import { QdrantService } from '../common/qdrant.service.js';

export interface SearchRequest {
  query: string;
  filter?: Record<string, unknown>;
  limit: number;
  expandToArticle: boolean;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly qdrant: QdrantService,
    private readonly access: AccessService,
  ) {}

  async searchLegal(userId: string, request: SearchRequest) {
    const scope = await this.access.scope(userId);
    const parsedFilter = request.filter
      ? searchFilterSchema.safeParse(request.filter)
      : { success: true as const, data: {} };

    if (!parsedFilter.success) {
      return {
        results: [],
        total: 0,
        warning: 'Условия отбора не распознаны, поиск не выполнен',
      };
    }

    const denseVector = await this.qdrant.embeddings.embedQuery(request.query);
    const hits = await hybridSearch(this.qdrant.client, {
      collection: COLLECTIONS.legalChunks,
      denseVector,
      queryText: request.query,
      filter: parsedFilter.data,
      // Ограничение прав применяется здесь, на сервере, а не приходит
      // от клиента: клиент не может расширить себе выдачу.
      accessScope: {
        userId: scope.userId,
        projectIds: scope.projectIds,
        tenantIds: scope.tenantIds,
      },
      limit: 100,
    });

    const expanded = request.expandToArticle
      ? await expandToParents(this.qdrant.client, COLLECTIONS.legalChunks, hits)
      : hits;

    const candidates = expanded.map((hit) => ({
      id: String(hit.id),
      text: String(hit.payload['text'] ?? ''),
    }));

    const ranked = this.qdrant.reranker
      ? await this.qdrant.reranker.rerank(request.query, candidates, request.limit)
      : passthroughRerank(candidates, request.limit);

    const byId = new Map(expanded.map((hit) => [String(hit.id), hit]));
    const results = ranked
      .map((item) => {
        const hit = byId.get(String(item.id));
        if (!hit) return null;
        return {
          id: hit.id,
          score: item.score,
          citation: hit.payload['citation_short'],
          citationFull: hit.payload['citation_full'],
          text: hit.payload['text'],
          workUri: hit.payload['work_uri'],
          path: hit.payload['path'],
          docKind: hit.payload['doc_kind'],
          validFrom: hit.payload['valid_from'],
          validTo: hit.payload['valid_to'],
        };
      })
      .filter((item) => item !== null);

    return { results, total: results.length, candidatesConsidered: expanded.length };
  }
}
