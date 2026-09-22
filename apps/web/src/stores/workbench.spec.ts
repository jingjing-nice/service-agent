import { useWorkbenchStore } from './workbench';

describe('workbench streaming state', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      status: 'idle', streamingText: '', streamingCitations: [],
      streamError: null, localMessages: [], activeId: 'conversation',
    });
  });

  it('clears stale text, citations and errors before a retry', () => {
    useWorkbenchStore.setState({
      streamingText: 'partial', streamError: 'failed',
      streamingCitations: [{ index: 1, title: 'old', source: 'old' }],
    });
    useWorkbenchStore.getState().startSending();
    expect(useWorkbenchStore.getState()).toMatchObject({
      status: 'sending', streamingText: '', streamingCitations: [], streamError: null,
    });
  });

  it('deduplicates citations in one answer', () => {
    const citation = { index: 1, title: 'policy', source: 'document' };
    useWorkbenchStore.getState().appendStreamingCitation(citation);
    useWorkbenchStore.getState().appendStreamingCitation(citation);
    expect(useWorkbenchStore.getState().streamingCitations).toEqual([citation]);
  });
});
