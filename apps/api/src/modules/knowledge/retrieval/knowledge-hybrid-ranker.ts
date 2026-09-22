import type { KnowledgeRetrievalResult } from './knowledge-retrieval.mapper.js';

/**
 * 提取去重后的字母/数字连续片段。
 *
 * 使用 Unicode 属性而不是仅匹配 ASCII，确保中文、英文和数字问题
 * 使用同一套轻量规则。这里不是分词器：中文长句通常会成为一个 term，
 * 因此当前实现只适合作为小型知识库的补充召回信号。
 */
function terms(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
}

/** 返回查询词在正文中的覆盖率，范围为 0 到 1。 */
export function lexicalScore(question: string, content: string): number {
  const queryTerms = terms(question);
  if (queryTerms.length === 0) return 0;
  const normalized = content.toLowerCase();
  return (
    queryTerms.filter((term) => normalized.includes(term)).length /
    queryTerms.length
  );
}

/**
 * 将语义相似度和关键词覆盖率融合成稳定的本地排序结果。
 *
 * 同一切片可能同时出现在向量结果和关键词候选中，因此先按 chunkId
 * 去重，再保留最高融合分。固定权重与稳定截断使测试和线上行为可复现；
 * 返回前移除内部 rankScore，避免排序实现泄漏到公共检索结果类型。
 */
export function rerankHybridKnowledge(
  question: string,
  vectorResults: KnowledgeRetrievalResult[],
  lexicalCandidates: KnowledgeRetrievalResult[],
  limit: number,
): KnowledgeRetrievalResult[] {
  const byChunk = new Map<
    string,
    KnowledgeRetrievalResult & { rankScore: number }
  >();
  for (const result of [...vectorResults, ...lexicalCandidates]) {
    const semantic =
      vectorResults.find((item) => item.chunkId === result.chunkId)?.score ?? 0;
    const lexical = lexicalScore(question, result.content);
    const rankScore = semantic * 0.7 + lexical * 0.3;
    const existing = byChunk.get(result.chunkId);
    if (!existing || rankScore > existing.rankScore)
      byChunk.set(result.chunkId, { ...result, rankScore });
  }
  return [...byChunk.values()]
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, limit)
    .map(({ rankScore: _rankScore, ...result }) => result);
}
