import { describe, expect, it, vi } from 'vitest';
import { RefundController } from './refund.controller.js';

function controller() {
  const refunds = { listApprovals: vi.fn(), decide: vi.fn() };
  return {
    refunds,
    controller: new RefundController(
      refunds as never,
      { get: vi.fn().mockReturnValue('tenant-1') } as never,
    ),
  };
}

describe('RefundController', () => {
  it('allows an empty approval note', async () => {
    const { controller: subject, refunds } = controller();
    refunds.decide.mockResolvedValue({ status: 'EXECUTED' });
    await subject.decide('11111111-1111-4111-8111-111111111111', {
      approved: true,
      reviewerId: 'reviewer-1',
      note: '   ',
    });
    expect(refunds.decide).toHaveBeenCalledWith(
      expect.objectContaining({ note: undefined }),
    );
  });

  it('passes a trimmed optional note to the workflow service', async () => {
    const { controller: subject, refunds } = controller();
    refunds.decide.mockResolvedValue({ status: 'EXECUTED' });
    await subject.decide('11111111-1111-4111-8111-111111111111', {
      approved: true,
      reviewerId: ' reviewer-1 ',
      note: ' 同意退款 ',
    });
    expect(refunds.decide).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      refundRequestId: '11111111-1111-4111-8111-111111111111',
      approved: true,
      reviewerId: 'reviewer-1',
      note: '同意退款',
    });
  });
});
