import { hashKnowledgeText } from '../indexing/knowledge-index.utils.js';
import type { KnowledgeVectorHit } from '../vector/knowledge-vector-query.utils.js';

export type KnowledgeRetrievalChunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  document: {
    fileName: string;
    indexVersion?: string | null;
  };
};

export type KnowledgeRetrievalResult = {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  score: number;
};

/**
 * Treat PostgreSQL as the source of truth and discard stale or inconsistent
 * vector-store hits before they enter an LLM context.
 */
export function mapVerifiedKnowledgeHits(
  hits: KnowledgeVectorHit[],
  chunks: KnowledgeRetrievalChunk[],
  getExpectedIndexVersion: (chunk: KnowledgeRetrievalChunk) => string | null,
): KnowledgeRetrievalResult[] {
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  return hits.flatMap((hit) => {
    const chunk = chunksById.get(hit.chunkId);
    if (
      !chunk ||
      hit.documentId !== chunk.documentId ||
      hit.chunkIndex !== chunk.chunkIndex ||
      hit.indexVersion !== getExpectedIndexVersion(chunk) ||
      hit.textSha256 !== hashKnowledgeText(chunk.content)
    ) {
      return [];
    }

    return [
      {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        title: chunk.document.fileName,
        content: chunk.content,
        score: hit.score,
      },
    ];
  });
}
