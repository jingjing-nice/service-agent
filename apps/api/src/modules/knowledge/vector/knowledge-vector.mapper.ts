import { createKnowledgeVectorId } from './knowledge-vector.schema.js';
import {
  KNOWLEDGE_VECTOR_DIMENSION,
  type KnowledgeVectorRecord,
} from './knowledge-vector.types.js';

export function toMilvusRow(record: KnowledgeVectorRecord) {
  if (
    record.id !== createKnowledgeVectorId(record.indexVersion, record.chunkId)
  ) {
    throw new Error('Knowledge vector ID does not match its version and chunk');
  }
  if (
    record.embedding.length !== KNOWLEDGE_VECTOR_DIMENSION ||
    record.embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Knowledge vector must contain 1024 finite numbers');
  }

  return {
    id: record.id,
    chunk_id: record.chunkId,
    knowledge_base_id: record.knowledgeBaseId,
    tenant_id: record.tenantId,
    document_id: record.documentId,
    chunk_index: record.chunkIndex,
    embedding: record.embedding,
    embedding_model: record.embeddingModel,
    text_sha256: record.textSha256,
    index_version: record.indexVersion,
    publish_status: record.publishStatus,
  };
}
