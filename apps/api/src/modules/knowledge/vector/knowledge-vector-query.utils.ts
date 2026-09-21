import { KNOWLEDGE_VECTOR_DIMENSION } from './knowledge-vector.types.js';

export const KNOWLEDGE_VECTOR_SEARCH_OUTPUT_FIELDS = [
  'chunk_id',
  'document_id',
  'chunk_index',
  'text_sha256',
  'index_version',
];

export type KnowledgeVectorHit = {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  textSha256: string;
  indexVersion: string;
  score: number;
};

export function createKnowledgeVectorSearchFilter(
  tenantId: string,
  knowledgeBaseId: string,
  publishStatus: 'DRAFT' | 'PUBLISHED',
): string {
  return [
    `tenant_id == ${JSON.stringify(tenantId)}`,
    `knowledge_base_id == ${JSON.stringify(knowledgeBaseId)}`,
    `publish_status == ${JSON.stringify(publishStatus)}`,
  ].join(' && ');
}

export function createKnowledgeDocumentVectorFilter(
  tenantId: string,
  knowledgeBaseId: string,
  documentId: string,
  indexVersion: string,
): string {
  return [
    `tenant_id == ${JSON.stringify(tenantId)}`,
    `knowledge_base_id == ${JSON.stringify(knowledgeBaseId)}`,
    `document_id == ${JSON.stringify(documentId)}`,
    `index_version == ${JSON.stringify(indexVersion)}`,
    'publish_status == "DRAFT"',
  ].join(' && ');
}

export function assertValidKnowledgeQueryVector(embedding: number[]): void {
  if (
    embedding.length !== KNOWLEDGE_VECTOR_DIMENSION ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(
      `Knowledge query vector must contain ${KNOWLEDGE_VECTOR_DIMENSION} finite numbers`,
    );
  }
}

export function mapKnowledgeVectorHits(
  results: Array<Record<string, unknown>>,
): KnowledgeVectorHit[] {
  return results.map((hit) => ({
    chunkId: String(hit.chunk_id),
    documentId: String(hit.document_id),
    chunkIndex: Number(hit.chunk_index),
    textSha256: String(hit.text_sha256),
    indexVersion: String(hit.index_version),
    score: Number(hit.score),
  }));
}
