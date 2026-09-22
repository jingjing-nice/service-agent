import { Annotation } from '@langchain/langgraph';
import type { SimulatedOrder } from './simulated-order.service.js';

/** RAG 检索返回的政策来源。 */
export type RefundWorkflowPolicySource = {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
};

/** 工作流每个节点的执行结果都通过此注解定义为 State 字段。 */
export const RefundWorkflowAnnotation = Annotation.Root({
  // ── 请求标识 ──
  tenantId: Annotation<string>,
  conversationId: Annotation<string>,
  question: Annotation<string>,
  requestId: Annotation<string>,
  traceId: Annotation<string>,
  customerId: Annotation<string | null>,

  // ── RAG 检索结果 ──
  policySources: Annotation<RefundWorkflowPolicySource[]>,

  // ── 订单查询 ──
  orderNo: Annotation<string | null>,
  order: Annotation<SimulatedOrder | null>,

  // ── 退款条件判断 ──
  isEligible: Annotation<boolean | null>,
  ineligibleReason: Annotation<string | null>,

  // ── 退款申请 ──
  refundRequestId: Annotation<string | null>,
  refundAmount: Annotation<number | null>,

  // ── 最终输出 ──
  finalAnswer: Annotation<string>,
  citations: Annotation<
    Array<{ index: number; title: string; source: string; chunkId?: string }>
  >,

  // ── 流程控制 ──
  /** 直接返回答案（不再进入后续节点）。 */
  directAnswer: Annotation<string | null>,
});

export type RefundWorkflowState = typeof RefundWorkflowAnnotation.State;
