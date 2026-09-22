import type { KnowledgeDocument } from '../../../generated/prisma/client.js';

export function normalizeHeadingPath(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((heading): heading is string => typeof heading === 'string')
    : [];
}

export function getKnowledgeDocumentActions(
  document: Pick<
    KnowledgeDocument,
    'status' | 'publishStatus' | 'knowledgeBaseId' | 'indexVersion'
  >,
) {
  return {
    canPublish:
      document.status === 'READY' &&
      document.publishStatus === 'DRAFT' &&
      document.knowledgeBaseId !== null &&
      document.indexVersion !== null,
    canRetryIndex:
      document.status === 'CHUNKED' && document.knowledgeBaseId !== null,
  };
}

export function mapKnowledgeDocumentDetail(document: KnowledgeDocument) {
  return {
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    status: document.status,
    publishStatus: document.publishStatus,
    indexVersion: document.indexVersion,
    publishedAt: document.publishedAt?.toISOString() ?? undefined,
    errorCode: document.errorCode,
    ...getKnowledgeDocumentActions(document),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function mapCreatedKnowledgeDocument(
  document: KnowledgeDocument,
  chunkCount?: number,
) {
  return {
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    status: document.status,
    publishStatus: document.publishStatus,
    indexVersion: document.indexVersion,
    publishedAt: document.publishedAt?.toISOString() ?? undefined,
    errorCode: document.errorCode,
    ...getKnowledgeDocumentActions(document),
    chunkCount,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
