import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type RefundGatewayResult = {
  gatewayRefundId: string;
  executedAt: Date;
};

/**
 * 可替换的退款渠道适配器。
 *
 * 简历项目不触碰真实资金，但保留了真实支付渠道需要的幂等键、渠道流水号
 * 和失败语义。订单号包含 `FAIL` 时用于演示渠道失败与补偿处理。
 */
@Injectable()
export class SimulatedRefundGatewayService {
  async refund(input: {
    orderNo: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<RefundGatewayResult> {
    if (input.orderNo.includes('FAIL')) {
      throw new Error('模拟退款渠道暂时不可用');
    }

    const digest = createHash('sha256')
      .update(input.idempotencyKey)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();

    return {
      gatewayRefundId: `SIM-${digest}`,
      executedAt: new Date(),
    };
  }
}
