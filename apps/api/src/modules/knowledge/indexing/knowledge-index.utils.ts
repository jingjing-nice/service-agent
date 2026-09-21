import { createHash } from 'node:crypto';

/** Stable draft version used by the current single-version indexing flow. */
export function createKnowledgeIndexVersion(documentId: string): string {
  return `v1-${documentId}`;
}

/** Hash stored beside a vector so stale Milvus rows can be rejected. */
export function hashKnowledgeText(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
