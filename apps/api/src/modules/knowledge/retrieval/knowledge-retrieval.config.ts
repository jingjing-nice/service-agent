export type KnowledgeRetrievalConfig = {
  minScore: number;
};

/** Validate retrieval tuning in one place instead of inside domain services. */
export function getKnowledgeRetrievalConfig(): KnowledgeRetrievalConfig {
  const minScore = Number(process.env.KNOWLEDGE_MIN_SCORE?.trim() ?? '0.55');

  if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1) {
    throw new Error('KNOWLEDGE_MIN_SCORE must be a number between -1 and 1');
  }

  return { minScore };
}
