import { hashKnowledgeText } from '../indexing/knowledge-index.utils.js';
import { mapVerifiedKnowledgeHits } from './knowledge-retrieval.mapper.js';
import { ragRegressionCases } from './rag-regression.cases.js';

describe('RAG regression set', () => {
  it.each(ragRegressionCases)('$question retrieves the standard source and answer evidence', (testCase) => {
    const chunkId = `${testCase.expectedDocumentId}-chunk`;
    const [result] = mapVerifiedKnowledgeHits([{
      chunkId, documentId: testCase.expectedDocumentId, chunkIndex: 0,
      textSha256: hashKnowledgeText(testCase.content), indexVersion: 'version', score: 0.9,
    }], [{
      id: chunkId, documentId: testCase.expectedDocumentId, chunkIndex: 0,
      content: testCase.content,
      document: { fileName: `${testCase.expectedDocumentId}.md`, indexVersion: 'version' },
    }], (chunk) => chunk.document.indexVersion ?? null);

    expect(result.documentId).toBe(testCase.expectedDocumentId);
    for (const term of testCase.expectedAnswerTerms) expect(result.content).toContain(term);
  });
});
