import { describe, expect, it } from 'vitest';
import {
  extractRefundInterruptContext,
  RefundWorkflowGraphService,
  RefundWorkflowInterruptError,
} from './refund-workflow-graph.service.js';

describe('extractRefundInterruptContext', () => {
  it('extracts the approval context emitted by LangGraph updates streams', () => {
    expect(
      extractRefundInterruptContext({
        __interrupt__: [
          {
            value: {
              refundRequestId: 'refund-1',
              orderNo: 'DEMO-ORDER-001',
              amount: 299,
              reason: '客户通过智能客服申请退款',
            },
          },
        ],
      }),
    ).toEqual({
      refundRequestId: 'refund-1',
      orderNo: 'DEMO-ORDER-001',
      amount: 299,
      reason: '客户通过智能客服申请退款',
    });
  });

  it('does not mistake normal node updates for approval interrupts', () => {
    expect(
      extractRefundInterruptContext({ query_order: { orderNo: 'DEMO-ORDER-001' } }),
    ).toBeNull();
  });

  it('rejects malformed interrupt payloads', () => {
    expect(
      extractRefundInterruptContext({
        __interrupt__: [{ value: { refundRequestId: 'refund-1' } }],
      }),
    ).toBeNull();
  });

  it('turns a real LangGraph approval interrupt into the workflow error', async () => {
    const prisma = {
      refundRequest: {
        create: vi.fn().mockResolvedValue({ id: 'refund-1' }),
      },
      conversation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const orders = {
      findByOrderNo: vi.fn().mockReturnValue({
        orderNo: 'DEMO-ORDER-001',
        customerId: 'customer-1',
        amount: 299,
        currency: 'CNY',
        paidAt: new Date(),
        status: 'PAID',
      }),
    };
    const knowledge = {
      retrievePublishedKnowledge: vi.fn().mockResolvedValue([
        {
          chunkId: 'chunk-1',
          documentId: 'document-1',
          title: '退款政策',
          content: '支付后七天内可申请退款。',
        },
      ]),
    };
    const service = new RefundWorkflowGraphService(
      prisma as never,
      orders as never,
      { create: vi.fn() } as never,
      knowledge as never,
      {
        evaluate: vi.fn().mockReturnValue({
          eligible: true,
          refundWindowDays: 7,
          orderAgeDays: 0,
        }),
      } as never,
    );

    process.env.DEFAULT_KNOWLEDGE_BASE_ID = 'knowledge-base-1';
    const run = async () => {
      for await (const _update of service.streamWorkflow(
        {
          tenantId: 'tenant-1',
          conversationId: 'conversation-1',
          question: '帮我退款 DEMO-ORDER-001',
          requestId: 'request-1',
          traceId: 'trace-1',
          customerId: 'customer-1',
        },
        'conversation-1',
      )) {
        // Consume all updates until LangGraph reaches interrupt().
      }
    };

    await expect(run()).rejects.toEqual(
      expect.objectContaining({
        name: RefundWorkflowInterruptError.name,
        interruptContext: expect.objectContaining({
          refundRequestId: 'refund-1',
          orderNo: 'DEMO-ORDER-001',
          amount: 299,
        }),
      }),
    );
  });
});
