import { LlmController, MODEL_TIMEOUT_MS } from './llm.controller.js';

const localRequest = { ip: '127.0.0.1' } as never;
const conversationId = 'conversation-id';
const requestId = '11111111-1111-4111-8111-111111111111';

function makeController(streamAnswer: (...args: never[]) => AsyncGenerator<string>) {
  const messages = {
    findByConversationId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async (input) => ({ id: 'saved', ...input })),
  };
  const knowledge = { retrievePublishedKnowledge: vi.fn().mockResolvedValue([{
    chunkId: '22222222-2222-4222-8222-222222222222',
    documentId: '33333333-3333-4333-8333-333333333333',
    title: 'policy.md', content: '退款需要三个工作日', score: 0.9,
  }]) };
  const refunds = {
    isRefundIntent: vi.fn().mockReturnValue(false),
    start: vi.fn(),
  };
  const refundGraph = { streamWorkflow: vi.fn() };
  const prisma = {
    conversation: { findFirst: vi.fn() },
  };
  return {
    controller: new LlmController(
      { streamAnswer } as never,
      messages as never,
      knowledge as never,
      refunds as never,
      refundGraph as never,
      prisma as never,
    ),
    messages,
    knowledge,
    refunds,
  };
}

describe('LlmController SSE lifecycle', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.DEFAULT_TENANT_ID = 'tenant';
    process.env.DEFAULT_KNOWLEDGE_BASE_ID = '44444444-4444-4444-8444-444444444444';
  });

  it('aborts the model when the SSE client disconnects', async () => {
    let receivedSignal: AbortSignal | undefined;
    const { controller } = makeController(async function* (...args: never[]) {
      receivedSignal = args[3] as AbortSignal;
      await new Promise(() => undefined);
      yield '';
    });
    const subscription = controller.stream('question', conversationId, requestId, localRequest)
      .subscribe();
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());
    subscription.unsubscribe();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('emits timeout failure and aborts a stalled model', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const { controller } = makeController(async function* (...args: never[]) {
      receivedSignal = args[3] as AbortSignal;
      await new Promise(() => undefined);
      yield '';
    });
    const events: unknown[] = [];
    controller.stream('question', conversationId, requestId, localRequest)
      .subscribe((event) => events.push(event.data));
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.failed', code: 'MODEL_TIMEOUT' }));
    expect(receivedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('keeps concurrent streams isolated', async () => {
    const signals: AbortSignal[] = [];
    const { controller } = makeController(async function* (...args: never[]) {
      signals.push(args[3] as AbortSignal);
      yield 'answer [1]';
    });
    const completed = (id: string) => new Promise<unknown[]>((resolve, reject) => {
      const events: unknown[] = [];
      controller.stream('question', conversationId, id, localRequest).subscribe({
        next: (event) => events.push(event.data), error: reject, complete: () => resolve(events),
      });
    });
    const [first, second] = await Promise.all([
      completed(requestId), completed('55555555-5555-4555-8555-555555555555'),
    ]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    const firstId = (first[0] as { message_id: string }).message_id;
    const secondId = (second[0] as { message_id: string }).message_id;
    expect(firstId).not.toBe(secondId);
  });
});
