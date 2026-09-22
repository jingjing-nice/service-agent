import { Prisma } from '../../generated/prisma/client.js';
import { MessagesService } from './messages.service.js';

describe('MessagesService idempotency', () => {
  it('returns the original message after a duplicate concurrent request', async () => {
    const createdAt = new Date('2026-01-01');
    const existing = {
      id: 'message-id', conversationId: 'conversation-id', role: 'CUSTOMER',
      content: 'same question', citations: null, traceId: 'trace',
      requestId: 'request-id', createdAt,
    };
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002', clientVersion: 'test', meta: {},
    });
    const prisma = {
      conversation: { findFirst: vi.fn().mockResolvedValue({ id: 'conversation-id' }) },
      $transaction: vi.fn().mockRejectedValue(duplicate),
      message: { findFirst: vi.fn().mockResolvedValue(existing) },
    };
    const service = new MessagesService(prisma as never);

    await expect(service.create({
      tenantId: 'tenant', conversationId: 'conversation-id', role: 'customer',
      content: 'same question', requestId: 'request-id', traceId: 'new-trace',
    })).resolves.toMatchObject({ id: 'message-id', requestId: 'request-id' });
    expect(prisma.message.findFirst).toHaveBeenCalledWith({ where: {
      tenantId: 'tenant', conversationId: 'conversation-id', requestId: 'request-id',
    } });
  });
});
