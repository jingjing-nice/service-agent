import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RefundWorkflowService } from './refund-workflow.service.js';

describe('RefundWorkflowService approval guard', () => {
  it('rejects an approval that has already been processed', async () => {
    const prisma = {
      refundRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'refund-1',
          status: 'EXECUTED',
        }),
      },
    };
    const gateway = { refund: vi.fn() };
    const service = new RefundWorkflowService(
      prisma as never,
      { create: vi.fn() } as never,
      gateway as never,
    );

    await expect(
      service.decide({
        tenantId: 'tenant-1',
        refundRequestId: 'refund-1',
        approved: true,
        reviewerId: 'reviewer-1',
        note: '重复审批测试',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(gateway.refund).not.toHaveBeenCalled();
  });
});
