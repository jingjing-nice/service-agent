import { describe, expect, it } from 'vitest';
import { SimulatedRefundGatewayService } from './simulated-refund-gateway.service.js';

describe('SimulatedRefundGatewayService', () => {
  it('returns the same channel reference for the same idempotency key', async () => {
    const gateway = new SimulatedRefundGatewayService();
    const input = {
      orderNo: 'DEMO-ORDER-001',
      amount: 299,
      currency: 'CNY',
      idempotencyKey: 'refund:request-1',
    };
    const first = await gateway.refund(input);
    const second = await gateway.refund(input);
    expect(first.gatewayRefundId).toBe(second.gatewayRefundId);
  });

  it('supports a deterministic failure scenario', async () => {
    const gateway = new SimulatedRefundGatewayService();
    await expect(
      gateway.refund({
        orderNo: 'DEMO-ORDER-FAIL',
        amount: 100,
        currency: 'CNY',
        idempotencyKey: 'refund:failed',
      }),
    ).rejects.toThrow('模拟退款渠道暂时不可用');
  });
});
