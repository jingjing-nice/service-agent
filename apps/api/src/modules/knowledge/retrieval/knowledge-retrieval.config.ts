export type KnowledgeRetrievalConfig = {
  minScore: number;
  /**
 * Milvus 初始召回的候选数量。
 *
 * 候选召回应大于最终上下文数量，让后续关键词融合和重排
 * 有足够的候选空间。
 */
  vectorCandidateLimit: number;

  /**
   * 混合排序后允许进入模型上下文的最大切片数量。
   */
  contextLimit: number;
};

/** Validate retrieval tuning in one place instead of inside domain services. */
export function getKnowledgeRetrievalConfig(): KnowledgeRetrievalConfig {
  const minScore = Number(process.env.KNOWLEDGE_MIN_SCORE?.trim() ?? '0.55');

  if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1) {
    throw new Error('KNOWLEDGE_MIN_SCORE must be a number between -1 and 1');
  }

  return {
    minScore,
    vectorCandidateLimit: 30,
    contextLimit: 5,
  };
}
