import { Injectable } from '@nestjs/common';
import { StateGraph, MemorySaver, interrupt } from '@langchain/langgraph';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { SimulatedOrderService } from './simulated-order.service.js';
import {
  RefundWorkflowAnnotation,
  type RefundWorkflowPolicySource,
  type RefundWorkflowState,
} from './refund-workflow.state.js';
import { randomUUID } from 'node:crypto';
import { RefundPolicyRulesService } from './refund-policy-rules.service.js';

/** 将 LangGraph interrupt() 抛出的 GraphInterrupt 错误标准化。 */
export class RefundWorkflowInterruptError extends Error {
  constructor(
    public readonly interruptContext: {
      refundRequestId: string;
      orderNo: string;
      amount: number;
      reason: string;
    },
  ) {
    super('Refund workflow interrupted for human approval');
    this.name = 'RefundWorkflowInterruptError';
  }
}

type RefundInterruptContext = RefundWorkflowInterruptError['interruptContext'];

/**
 * 从 LangGraph 的 updates 流中读取人工审批中断数据。
 *
 * LangGraph 1.x 在流式执行时通常不会抛出 GraphInterrupt，而是返回：
 * `{ __interrupt__: [{ value: ... }] }`。兼容这一路径可以避免控制器把
 * “等待审批”误判成正常完成，导致前端既没有回答也没有审批提示。
 */
export function extractRefundInterruptContext(
  chunk: unknown,
): RefundInterruptContext | null {
  if (!chunk || typeof chunk !== 'object' || !('__interrupt__' in chunk)) {
    return null;
  }

  const interrupts = (chunk as { __interrupt__?: unknown }).__interrupt__;
  if (!Array.isArray(interrupts) || interrupts.length === 0) return null;

  const value = (interrupts[0] as { value?: unknown } | undefined)?.value;
  if (!value || typeof value !== 'object') return null;

  const context = value as Partial<RefundInterruptContext>;
  if (
    typeof context.refundRequestId !== 'string' ||
    typeof context.orderNo !== 'string' ||
    typeof context.amount !== 'number' ||
    typeof context.reason !== 'string'
  ) {
    return null;
  }

  return context as RefundInterruptContext;
}

/**
 * 退款处理 LangGraph 工作流。
 *
 * 链路：RAG 政策检索 → 提取订单号 → 查询订单 → 判断退款资格 →
 *       创建退款申请 → 中断等待人工审批。
 *
 * 使用 LangGraph StateGraph + interrupt 实现 Human-in-the-Loop 模式：
 * - 审批节点调用 interrupt() 暂停图执行
 * - 审批后的资金操作由 PostgreSQL 状态机执行，不依赖进程内检查点
 */
@Injectable()
export class RefundWorkflowGraphService {
  /** LangGraph 编译后的可执行图。使用 any 绕过 TS 对编译图泛型的复杂推断问题。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly graph: any;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: SimulatedOrderService,
    private readonly messages: MessagesService,
    private readonly knowledge: KnowledgeService,
    private readonly rules: RefundPolicyRulesService,
  ) {
    const workflow = new StateGraph(RefundWorkflowAnnotation)
      // ── 节点定义 ──
      .addNode('rag_retrieve', this.ragRetrieveNode.bind(this))
      .addNode('extract_order', this.extractOrderNode.bind(this))
      .addNode('query_order', this.queryOrderNode.bind(this))
      .addNode('check_eligibility', this.checkEligibilityNode.bind(this))
      .addNode('create_refund', this.createRefundNode.bind(this))
      .addNode('await_approval', this.awaitApprovalNode.bind(this))
      .addNode('build_result', this.buildResultNode.bind(this))

      // ── 边：START → rag_retrieve ──
      .addEdge('__start__', 'rag_retrieve')

      // ── 条件边：RAG 无政策 → 直接返回 ──
      .addConditionalEdges('rag_retrieve', this.routeAfterRag.bind(this))

      // ── 条件边：提取订单号 → 有结果则查询 / 无结果则返回 ──
      .addConditionalEdges('extract_order', this.routeAfterExtract.bind(this))

      // ── 条件边：查询订单 → 找到则判断资格 / 未找到则返回 ──
      .addConditionalEdges('query_order', this.routeAfterQuery.bind(this))

      // ── 条件边：资格判断 → 不符合则返回 / 符合则创建申请 ──
      .addConditionalEdges('check_eligibility', this.routeAfterEligibility.bind(this))

      // ── 创建申请 → 等待审批 ──
      .addEdge('create_refund', 'await_approval')

      // ── 审批节点中断当前图；审批后的执行由持久化业务状态机负责 ──
      .addEdge('await_approval', '__end__')

      // ── build_result → __end__ ──
      .addEdge('build_result', '__end__');

    this.graph = workflow.compile({ checkpointer: new MemorySaver() });
  }

  /**
   * 配置 LangGraph 线程标识，保证同一会话的 interrupt/resume 使用相同检查点。
   */
  graphConfig(conversationId: string) {
    return { configurable: { thread_id: `refund:${conversationId}` } };
  }

  /**
   * 启动退款工作流并流式返回每个节点的执行事件。
   *
   * 使用 LangGraph streamMode: "updates" 按节点粒度产出事件。
   * 当遇到审批节点时，图会在 interrupt() 处暂停，
   * 调用方捕获 RefundWorkflowInterruptError 后通知前端进入人工审批。
   */
  async *streamWorkflow(
    input: Partial<RefundWorkflowState>,
    conversationId: string,
  ): AsyncGenerator<{
    event: string;
    node: string;
    data: Partial<RefundWorkflowState>;
  }> {
    const config = this.graphConfig(conversationId);

    try {
      const stream = await this.graph.stream(input, {
        ...config,
        streamMode: 'updates' as const,
      });

      for await (const chunk of stream) {
        const interruptContext = extractRefundInterruptContext(chunk);
        if (interruptContext) {
          throw new RefundWorkflowInterruptError(interruptContext);
        }

        // chunk 格式：{ nodeName: { ...stateUpdates } }
        for (const [node, data] of Object.entries(chunk as Record<string, unknown>)) {
          yield { event: 'node_completed', node, data: data as Partial<RefundWorkflowState> };
        }
      }
    } catch (error: unknown) {
      // LangGraph interrupt() 抛出 GraphInterrupt 错误（注意类名不带 Error 后缀）
      if (error instanceof Error && error.name === 'GraphInterrupt') {
        // 中断上下文保存在 interrupts 数组第一项的 value 字段中
        const interrupts = (error as Error & {
          interrupts?: Array<{ value?: unknown }>;
        }).interrupts;
        const interruptValue = interrupts?.[0]?.value;
        throw new RefundWorkflowInterruptError(
          interruptValue as {
            refundRequestId: string;
            orderNo: string;
            amount: number;
            reason: string;
          },
        );
      }
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 节点 1：RAG 政策检索
  // ══════════════════════════════════════════════════════════════════
  private async ragRetrieveNode(
    state: RefundWorkflowState,
  ): Promise<Partial<RefundWorkflowState>> {
    const knowledgeBaseId = process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim();
    if (!knowledgeBaseId) {
      return {
        directAnswer: '系统未配置默认知识库，无法检索退款政策。',
        policySources: [],
      };
    }

    const sources = await this.knowledge.retrievePublishedKnowledge(
      state.tenantId,
      knowledgeBaseId,
      state.question,
    );

    const policySources: RefundWorkflowPolicySource[] = sources.map((s) => ({
      chunkId: s.chunkId,
      documentId: s.documentId,
      title: s.title,
      content: s.content,
    }));

    return { policySources, directAnswer: null };
  }

  /** RAG 后路由：有政策 → extract_order / 无政策 → 直接结束。 */
  private routeAfterRag(state: RefundWorkflowState): string {
    if (state.policySources.length === 0) {
      return 'build_result';
    }
    return 'extract_order';
  }

  /** 提取订单号后路由：有订单号 → query_order / 无 → build_result。 */
  private routeAfterExtract(state: RefundWorkflowState): string {
    if (state.directAnswer) return 'build_result';
    return 'query_order';
  }

  /** 查询订单后路由：找到订单 → check_eligibility / 未找到 → build_result。 */
  private routeAfterQuery(state: RefundWorkflowState): string {
    if (state.directAnswer) return 'build_result';
    return 'check_eligibility';
  }

  // ══════════════════════════════════════════════════════════════════
  // 节点 2：提取订单号
  // ══════════════════════════════════════════════════════════════════
  private async extractOrderNode(
    state: RefundWorkflowState,
  ): Promise<Partial<RefundWorkflowState>> {
    const orderNo =
      state.question.toUpperCase().match(/\b[A-Z][A-Z0-9-]{5,31}\b/u)?.[0] ?? null;

    if (!orderNo) {
      return {
        orderNo: null,
        directAnswer:
          '我已找到退款政策。请提供订单号后再继续；本地演示可使用 DEMO-ORDER-001。[1]',
      };
    }

    return { orderNo, directAnswer: null };
  }

  // ══════════════════════════════════════════════════════════════════
  // 节点 3：查询订单（真实或模拟）
  // ══════════════════════════════════════════════════════════════════
  private async queryOrderNode(
    state: RefundWorkflowState,
  ): Promise<Partial<RefundWorkflowState>> {
    const customerId = state.customerId!;
    const orderNo = state.orderNo!;

    const order = this.orders.findByOrderNo(orderNo, customerId);

    if (!order) {
      return {
        order: null,
        directAnswer: `没有找到订单 ${orderNo}，请核对订单号或联系人工客服。[1]`,
      };
    }

    return { order, directAnswer: null };
  }

  // ══════════════════════════════════════════════════════════════════
  // 节点 4：判断是否符合退款条件
  // ══════════════════════════════════════════════════════════════════
  private async checkEligibilityNode(
    state: RefundWorkflowState,
  ): Promise<Partial<RefundWorkflowState>> {
    const order = state.order!;
    const orderNo = state.orderNo!;
    const eligibility = this.rules.evaluate(order);
    if (!eligibility.eligible) {
      const reason = `订单 ${orderNo} 不符合退款条件：${eligibility.reason}。[1]`;
      return {
        isEligible: false,
        ineligibleReason: reason,
        directAnswer: reason,
      };
    }

    return { isEligible: true, ineligibleReason: null };
  }

  /** 资格判断后路由：不符合 → build_result / 符合 → create_refund。 */
  private routeAfterEligibility(state: RefundWorkflowState): string {
    if (!state.isEligible) {
      return 'build_result';
    }
    return 'create_refund';
  }

  // ══════════════════════════════════════════════════════════════════
  // 节点 5：创建退款申请
  // ══════════════════════════════════════════════════════════════════
  private async createRefundNode(
    state: RefundWorkflowState,
  ): Promise<Partial<RefundWorkflowState>> {
    const order = state.order!;
    const orderNo = state.orderNo!;

    const citations = state.policySources.map((source, index) => ({
      index: index + 1,
      title: source.title,
      source: source.documentId,
      chunkId: source.chunkId,
    }));

    const idempotencyKey = `${state.conversationId}:refund:${orderNo}:${state.requestId}`;

    let refundRequest;
    try {
      refundRequest = await this.prisma.refundRequest.create({
        data: {
          tenantId: state.tenantId,
          conversationId: state.conversationId,
          customerId: state.customerId!,
          orderNo,
          amount: order.amount,
          currency: order.currency,
          reason: '客户通过智能客服申请退款',
          idempotencyKey,
          policyCitations: citations as Prisma.InputJsonValue,
          traceId: state.traceId,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      refundRequest = await this.prisma.refundRequest.findFirstOrThrow({
        where: { tenantId: state.tenantId, idempotencyKey },
      });
    }

    await this.prisma.conversation.updateMany({
      where: { id: state.conversationId, tenantId: state.tenantId },
      data: { status: 'WAITING_APPROVAL' },
    });

    return {
      refundRequestId: refundRequest.id,
      refundAmount: order.amount,
      citations,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // 节点 6：中断等待人工审批（Human-in-the-Loop）
  // ══════════════════════════════════════════════════════════════════
  private async awaitApprovalNode(
    state: RefundWorkflowState,
  ): Promise<Partial<RefundWorkflowState>> {
    // LangGraph interrupt：暂停申请图并携带审批上下文。
    // 后续审批和退款执行交给 PostgreSQL 状态机，避免依赖进程内检查点。
    const interruptContext = {
      refundRequestId: state.refundRequestId!,
      orderNo: state.orderNo!,
      amount: state.refundAmount!,
      reason: '客户通过智能客服申请退款',
    };

    await interrupt(interruptContext);
    return {};
  }

  // ══════════════════════════════════════════════════════════════════
  // 节点 8：组装处理结果及政策引用
  // ══════════════════════════════════════════════════════════════════
  private async buildResultNode(
    state: RefundWorkflowState,
  ): Promise<Partial<RefundWorkflowState>> {
    // 提前返回（directAnswer）路径：中间节点已设置直接答案。
    if (state.directAnswer) {
      const hasCitations =
        Array.isArray(state.citations) && state.citations.length > 0;
      await this.persistMessage(state, state.directAnswer);
      return {
        finalAnswer: state.directAnswer,
        citations: hasCitations ? state.citations : [],
      };
    }

    // 无政策路径
    if (state.policySources.length === 0) {
      const answer = '当前已发布知识中没有找到退款政策依据，无法发起退款申请。';
      await this.persistMessage(state, answer);
      return { finalAnswer: answer, citations: [] };
    }

    // 兜底
    const fallback = '退款处理流程已完成。';
    await this.persistMessage(state, fallback);
    return { finalAnswer: fallback, citations: state.citations ?? [] };
  }

  // ══════════════════════════════════════════════════════════════════
  // 辅助方法
  // ══════════════════════════════════════════════════════════════════

  /**
   * 将工作流最终结果持久化为 Agent 消息，并恢复会话状态为 COMPLETED。
   */
  private async persistMessage(
    state: RefundWorkflowState,
    content: string,
  ): Promise<void> {
    await this.messages.create({
      tenantId: state.tenantId,
      conversationId: state.conversationId,
      role: 'agent',
      content,
      citations: Array.isArray(state.citations)
        ? (state.citations as never)
        : undefined,
      traceId: state.traceId,
      requestId: `refund:${state.refundRequestId ?? randomUUID()}:result`,
    });

    await this.prisma.conversation.updateMany({
      where: { id: state.conversationId, tenantId: state.tenantId },
      data: { status: 'COMPLETED' },
    });
  }

}
