import {
  createObsoleteKnowledgeVectorFilter,
  mapKnowledgeVectorHits,
} from './knowledge-vector-query.utils.js';

describe('knowledge vector queries', () => {
  it('scopes obsolete-vector deletion to tenant, knowledge base and document', () => {
    expect(createObsoleteKnowledgeVectorFilter('t', 'kb', 'doc', 'current')).toBe(
      'tenant_id == "t" && knowledge_base_id == "kb" && document_id == "doc" && index_version != "current"',
    );
  });

  it('preserves non-finite scores for the retrieval layer to reject', () => {
    const [hit] = mapKnowledgeVectorHits([{
      chunk_id: 'c', document_id: 'd', chunk_index: 0,
      text_sha256: 'hash', index_version: 'version', score: Number.NaN,
    }]);
    expect(Number.isNaN(hit.score)).toBe(true);
  });
});
