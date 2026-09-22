import { Injectable } from '@nestjs/common';

export type SimulatedOrder = {
  orderNo: string;
  customerId: string;
  amount: number;
  currency: 'CNY';
  paidAt: Date;
  status: 'PAID' | 'SHIPPED' | 'REFUNDED';
};

/** 可替换为真实订单 API 的演示适配器。 */
@Injectable()
export class SimulatedOrderService {
  findByOrderNo(orderNo: string, customerId: string): SimulatedOrder | null {
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const orders: SimulatedOrder[] = [
      { orderNo: 'DEMO-ORDER-001', customerId, amount: 299, currency: 'CNY', paidAt: daysAgo(2), status: 'PAID' },
      { orderNo: 'DEMO-ORDER-OLD', customerId, amount: 199, currency: 'CNY', paidAt: daysAgo(30), status: 'PAID' },
      { orderNo: 'DEMO-ORDER-REFUNDED', customerId, amount: 99, currency: 'CNY', paidAt: daysAgo(1), status: 'REFUNDED' },
    ];
    return orders.find((order) => order.orderNo === orderNo) ?? null;
  }
}
