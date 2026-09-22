import { Injectable } from '@nestjs/common';
import type { SimulatedOrder } from './simulated-order.service.js';

export type RefundEligibilityDecision =
  | { eligible: true; refundWindowDays: number; orderAgeDays: number }
  | { eligible: false; refundWindowDays: number; orderAgeDays: number; reason: string };

/**
 * 确定性退款规则引擎。
 *
 * RAG 负责找到并解释政策，是否允许资金操作必须由可测试、可审计的规则决定，
 * 不能交给大模型自由推断。
 */
@Injectable()
export class RefundPolicyRulesService {
  evaluate(order: SimulatedOrder): RefundEligibilityDecision {
    const refundWindowDays = this.getRefundWindowDays();
    const orderAgeDays = Math.floor(
      (Date.now() - order.paidAt.getTime()) / 86_400_000,
    );

    if (order.status === 'REFUNDED') {
      return {
        eligible: false,
        refundWindowDays,
        orderAgeDays,
        reason: '订单已经退款，不能重复申请',
      };
    }
    if (order.status !== 'PAID') {
      return {
        eligible: false,
        refundWindowDays,
        orderAgeDays,
        reason: `订单状态 ${order.status} 不允许直接退款`,
      };
    }
    if (orderAgeDays > refundWindowDays) {
      return {
        eligible: false,
        refundWindowDays,
        orderAgeDays,
        reason: `订单已超过 ${refundWindowDays} 天退款期限`,
      };
    }
    return { eligible: true, refundWindowDays, orderAgeDays };
  }

  private getRefundWindowDays(): number {
    const value = Number(process.env.REFUND_WINDOW_DAYS ?? 7);
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      throw new Error('REFUND_WINDOW_DAYS must be an integer between 1 and 365');
    }
    return value;
  }
}
