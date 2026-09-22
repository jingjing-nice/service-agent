import { lexicalScore, rerankHybridKnowledge } from './knowledge-hybrid-ranker.js';

describe('hybrid knowledge reranker', () => {
  const result = (chunkId: string, content: string, score: number) => ({
    chunkId, documentId: `doc-${chunkId}`, title: `${chunkId}.md`, content, score,
  });

  it('adds keyword-only candidates and deduplicates vector hits', () => {
    const ranked = rerankHybridKnowledge(
      '退款 时间',
      [result('semantic', '售后说明', 0.8)],
      [result('keyword', '退款处理时间为三天', 0.5), result('semantic', '售后说明', 0.1)],
    );
    expect(ranked.map((item) => item.chunkId)).toEqual(['semantic', 'keyword']);
  });

  it('scores direct lexical overlap', () => {
    expect(lexicalScore('退款 时间', '退款时间为三个工作日')).toBe(1);
  });
});
