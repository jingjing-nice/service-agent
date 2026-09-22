import { describe, expect, it } from 'vitest';
import { RefundPolicyRulesService } from './refund-policy-rules.service.js';

const rules = new RefundPolicyRulesService();

function order(overrides: Partial<Parameters<typeof rules.evaluate>[0]> = {}) {
  return {
    orderNo: 'DEMO-ORDER-001',
    customerId: 'customer-1',
    amount: 299,
    currency: 'CNY' as const,
    paidAt: new Date(),
    status: 'PAID' as const,
    ...overrides,
  };
}

describe('RefundPolicyRulesService', () => {
  it('accepts a paid order inside the configured window', () => {
    expect(rules.evaluate(order())).toEqual(
      expect.objectContaining({ eligible: true }),
    );
  });

  it('rejects an expired order deterministically', () => {
    const decision = rules.evaluate(
      order({ paidAt: new Date(Date.now() - 30 * 86_400_000) }),
    );
    expect(decision).toEqual(
      expect.objectContaining({ eligible: false, reason: expect.stringContaining('退款期限') }),
    );
  });

  it('rejects an already refunded order', () => {
    expect(rules.evaluate(order({ status: 'REFUNDED' }))).toEqual(
      expect.objectContaining({ eligible: false, reason: expect.stringContaining('不能重复') }),
    );
  });
});
