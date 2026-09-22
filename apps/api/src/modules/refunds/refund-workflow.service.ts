import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { SimulatedRefundGatewayService } from './simulated-refund-gateway.service.js';

@Injectable()
export class RefundWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly gateway: SimulatedRefundGatewayService,
  ) {}

  /**
   * 仅当用户同时提到退款相关关键词和订单号时，才判定为退款意图。
   *
   * 纯政策咨询（如“退款政策是啥”）应走正常 RAG + LLM 流，
   * 由模型基于检索到的知识生成完整回答。
   */
  isRefundIntent(question: string): boolean {
    return (
      /(退款|退货|refund)/iu.test(question) &&
      /\b[A-Z][A-Z0-9-]{5,31}\b/u.test(question.toUpperCase())
    );
  }

  listApprovals(tenantId: string) {
    return this.prisma.refundRequest.findMany({
      where: { tenantId },
      include: {
        conversation: {
          select: { customerName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async decide(input: {
    tenantId: string;
    refundRequestId: string;
    approved: boolean;
    reviewerId: string;
    note?: string;
  }) {
    const request = await this.prisma.refundRequest.findFirst({
      where: { id: input.refundRequestId, tenantId: input.tenantId },
    });
    if (!request) throw new NotFoundException('Refund request was not found');

    if (request.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(
        `退款申请已经处理，当前状态为 ${request.status}，不允许重复审批`,
      );
    }

    const reviewedAt = new Date();
    const targetStatus = input.approved ? 'EXECUTING' : 'REJECTED';
    const updated = await this.prisma.refundRequest.updateMany({
      where: {
        id: request.id,
        tenantId: input.tenantId,
        status: 'PENDING_APPROVAL',
      },
      data: {
        status: targetStatus,
        reviewedBy: input.reviewerId,
        reviewNote: input.note,
        reviewedAt,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException('Refund request was decided concurrently');

    if (!input.approved) {
      await this.persistResult(
        request,
        `退款申请 ${request.id} 已被人工拒绝：${input.note}。`,
      );
      return this.prisma.refundRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
    }

    try {
      const gatewayResult = await this.gateway.refund({
        orderNo: request.orderNo,
        amount: request.amount.toNumber(),
        currency: request.currency,
        idempotencyKey: `refund:${request.id}`,
      });
      await this.prisma.refundRequest.updateMany({
        where: {
          id: request.id,
          tenantId: input.tenantId,
          status: 'EXECUTING',
        },
        data: {
          status: 'EXECUTED',
          gatewayRefundId: gatewayResult.gatewayRefundId,
          executionError: null,
          executedAt: gatewayResult.executedAt,
        },
      });
      await this.persistResult(
        request,
        `退款申请 ${request.id} 已批准并执行，订单 ${request.orderNo} 将退回 ¥${request.amount.toString()}，渠道流水号 ${gatewayResult.gatewayRefundId}。[1]`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '退款渠道执行失败';
      await this.prisma.refundRequest.updateMany({
        where: {
          id: request.id,
          tenantId: input.tenantId,
          status: 'EXECUTING',
        },
        data: { status: 'EXECUTION_FAILED', executionError: message },
      });
      await this.persistResult(
        request,
        `退款申请 ${request.id} 已通过审批，但退款渠道执行失败，已转人工处理：${message}。[1]`,
      );
    }
    return this.prisma.refundRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
  }

  private async persistResult(
    request: {
      id: string;
      tenantId: string;
      conversationId: string;
      traceId: string;
      policyCitations: unknown;
    },
    content: string,
  ) {
    await this.messages.create({
      tenantId: request.tenantId,
      conversationId: request.conversationId,
      role: 'agent',
      content,
      citations: Array.isArray(request.policyCitations)
        ? (request.policyCitations as never)
        : undefined,
      traceId: request.traceId,
      requestId: `refund:${request.id}:result`,
    });
    await this.prisma.conversation.updateMany({
      where: { id: request.conversationId, tenantId: request.tenantId },
      data: { status: 'COMPLETED' },
    });
  }
}
