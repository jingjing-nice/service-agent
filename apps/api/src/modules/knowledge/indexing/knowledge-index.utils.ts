import { createHash, randomUUID } from 'node:crypto';

/**
 * Every rebuild gets an immutable version so stale vectors can be identified.
 *
 * Vector primary keys are derived from this version, so a rebuild never
 * overwrites the previous version in place: the old rows stay readable until
 * PostgreSQL commits the new version and they are cleaned up explicitly.
 */
export function createKnowledgeIndexVersion(_documentId: string): string {
  return `v2-${randomUUID()}`;
}

/** Hash stored beside a vector so stale Milvus rows can be rejected. */
export function hashKnowledgeText(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
