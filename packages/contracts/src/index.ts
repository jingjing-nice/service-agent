/** Public conversation state. Internal model reasoning is deliberately excluded. */

import { z } from 'zod'


/**
 * 所有公开 SSE 事件都必须包含的公共字段。
 *
 * 这个 Schema 只在 contracts 包内部复用，
 * 当前不需要导出给前端或后端。
 */
const baseSseEventSchema = z.object({
  /**
   * 当前 SSE 事件的编号。
   *
   * 同一次请求中的每个事件都应该使用不同的 event_id。
   */
  event_id: z.string().min(1),

  /**
   * 用户本次请求的编号。
   *
   * 同一次回答产生的所有事件，
   * request_id 都应该保持一致。
   */
  request_id: z.string().min(1),

  /**
   * 当前调用链的追踪编号。
   *
   * 后续可以使用 trace_id 关联日志、
   * 模型调用、知识检索库检索和工具执行。
   */
  trace_id: z.string().min(1),

  /**
   * 当前 AI 消息的编号。
   *
   * message.started、answer.delta 和
   * message.completed 应使用相同的 message_id。
   */
  message_id: z.string().min(1),
});

/**
 * 客服会话允许出现的状态。
 *
 * z.enum() 不仅可以生成 TypeScript 类型，
 * 还可以在程序运行时检查接口返回的状态是否合法。
 */

export const conversationStatusSchema = z.enum([
  // 当前没有正在处理的请求。
  'idle',
  // 用户消息正在发送给后端。
  'sending',
  // 后端正在流式生成 AI 回答。
  'streaming',
  // Agent 产生了高风险操作，正在等待人工审批。
  'waiting_approval',

  // 客服坐席已经接管，Agent 暂停自动回复。
  'human_takeover',
  // 当前请求处理失败。
  'failed',

  // 用户主动停止了本次生成。
  'cancelled',

  // 当前消息已经处理完成。
  'completed',
])


/**
 * 根据 Zod Schema 自动生成 TypeScript 类型。
 *
 * 所以前端仍然可以继续使用：
 * const status: ConversationStatus = 'streaming';
 */
export type ConversationStatus = z.infer<
  typeof conversationStatusSchema
>;

/**
 * AI 流式回答中的一个文本片段。
 *
 * 大模型不会等待完整答案生成后再一次性返回，
 * 而是会通过多个 answer.delta 事件逐步返回文字。
 */
export const answerDeltaEventSchema = baseSseEventSchema.extend({
  /**
    * 当前事件只能是 answer.delta。
    */
  type: z.literal('answer.delta'),

  /**
   * 大模型本次新生成的文字。
   *
   * 前端会将多个 text 按顺序拼接成完整回答。
   */
  text: z.string(),
})

/**
 * 根据 Zod Schema 自动生成 TypeScript 类型。
 *
 * 前端和后端都可以导入该类型，
 * 不需要重复声明 answer.delta 的数据结构。
 */
export type AnswerDeltaEvent = z.infer<typeof answerDeltaEventSchema>

/**
 * AI 消息开始生成事件。
 *
 * 后端接受用户请求并完成必要的初始化后，
 * 应先发送该事件，再开始发送 answer.delta。
 */
export const messageStartedEventSchema = baseSseEventSchema.extend({
  type: z.literal('message.started')
})

/**
 * 根据 Schema 自动生成开始事件的 TypeScript 类型。
 */
export type MessageStartedEvent = z.infer<
  typeof messageStartedEventSchema
>;


/**
 * AI 消息生成完成事件。
 *
 * 当大模型不再产生新的文本片段时，
 * 后端会发送 message.completed 通知前端。
 */
export const messageCompletedEventSchema = baseSseEventSchema.extend({
  type: z.literal('message.completed'),
});
/**
 * 根据 Schema 自动生成完成事件的 TypeScript 类型。
 */
export type MessageCompletedEvent = z.infer<
  typeof messageCompletedEventSchema
>;

/**
 * AI 消息生成失败事件。
 *
 * 该事件只暴露稳定错误码和可直接展示给用户的提示，
 * 不包含服务端异常堆栈等内部信息。
 */
export const messageFailedEventSchema = baseSseEventSchema.extend({
  type: z.literal('message.failed'),
  code: z.enum([
    'MODEL_STREAM_FAILED',
    'MODEL_TIMEOUT',
  ]),
  message: z.string().min(1),
});

export type MessageFailedEvent = z.infer<
  typeof messageFailedEventSchema
>;


/**
* 发起 AI 流式回答时提交的数据。
*/
export const streamAnswerRequestSchema = z.object({

  /**
   * 当前会话编号。
   */
  conversationId: z
    .string()
    .trim()
    .min(1, '会话 ID 不能为空')
    .max(100, '会话 ID 不能超过 100 个字符'),

  /**
   * 用户发送的问题。
   */
  question: z
    .string()
    .trim()
    .min(1, '问题不能为空')
    .max(4000, '问题不能超过 4000 个字符'),

  /**
 * 本次请求的唯一编号，由前端在发送前生成。
 *
 * 使用 UUID 格式校验，拒绝任意字符串。
 * 请求参数使用 requestId，SSE 事件仍使用 request_id。
 */
  requestId: z.uuid()
});

export type StreamAnswerRequest = z.infer<
  typeof streamAnswerRequestSchema
>;



/**
 * RAG 回答引用的知识来源事件。
 *
 * 后端只返回可公开的来源信息，
 * 不在事件中暴露完整文档内容、向量或内部检索分数。
 */
export const citationEventSchema = baseSseEventSchema.extend({
  /**
   * citation 表示当前回答使用了一条知识来源。
   */
  type: z.literal('citation'),

  /**
   * 引用在当前回答中的展示序号，从 1 开始。
   *
   * 前端可以将它显示为 [1]、[2] 等引用标记。
   */
  index: z.number().int().positive(),

  /**
   * 用户可理解的文档标题。
   */
  title: z.string().trim().min(1),

  /**
   * 来源文档 ID。
   *
   * 当前 RAG 流程返回 KnowledgeDocument 的 UUID，
   * 前端使用该字段确定引用属于哪一份文档。
   * 字段名称保留 source，以兼容现有消息结构。
   */
  source: z.string().uuid(),

  /**
   * 回答实际使用的知识切片 ID。
   *
   * 新回答会提供该字段，前端据此读取精确切片；
   * optional 用于兼容数据库中没有 chunkId 的历史引用。
   */
  chunkId: z.string().uuid().optional(),

  /**
   * 来源页码。
   *
   * Markdown 或网页文本可能没有页码，所以该字段允许缺省。
   */
  page: z.number().int().positive().optional(),
});

/**
 * 前端和后端共享的引用事件类型。
 */
export type CitationEvent = z.infer<
  typeof citationEventSchema
>;

export const knowledgeDocumentStatusSchema = z.enum([
  'UPLOADED', 'PARSING', 'CHUNKED', 'READY', 'FAILED',
]);

export const knowledgePublishStatusSchema = z.enum([
  'DRAFT', 'PUBLISHED', 'ARCHIVED',
]);

export const knowledgeDocumentSchema = z.object({
  id: z.uuid(),
  fileName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  status: knowledgeDocumentStatusSchema,
  publishStatus: knowledgePublishStatusSchema,
  indexVersion: z.string().nullable(),
  publishedAt: z.iso.datetime().optional(),
  errorCode: z.string().nullable(),
  canRetryIndex: z.boolean(),
  canPublish: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const knowledgeDocumentListSchema = z.array(knowledgeDocumentSchema);

export const knowledgeChunkPreviewSchema = z.object({
  documentId: z.uuid(),
  fileName: z.string().min(1),
  chunkCount: z.number().int().nonnegative(),
  chunks: z.array(z.object({
    index: z.number().int().nonnegative(),
    content: z.string(),
    characterCount: z.number().int().nonnegative(),
    headingPath: z.array(z.string()),
  })),
});

export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;
export type KnowledgeDocumentStatus = z.infer<typeof knowledgeDocumentStatusSchema>;
export type KnowledgePublishStatus = z.infer<typeof knowledgePublishStatusSchema>;
export type KnowledgeChunkPreview = z.infer<typeof knowledgeChunkPreviewSchema>;

// ── 退款工作流 SSE 事件 ────────────────────────────────────────────

/** 工作流步骤名称枚举。 */
export const workflowStepSchema = z.enum([
  'rag_retrieve',
  'extract_order',
  'query_order',
  'check_eligibility',
  'create_refund',
  'await_approval',
  'build_result',
]);

export type WorkflowStep = z.infer<typeof workflowStepSchema>;

/** 工作流步骤完成事件。 */
export const workflowStepCompletedEventSchema = baseSseEventSchema.extend({
  type: z.literal('workflow.step_completed'),
  step: workflowStepSchema,
  label: z.string().min(1),
  /** 步骤产出摘要，例如 "找到 3 条退款政策"。 */
  summary: z.string().optional(),
});

export type WorkflowStepCompletedEvent = z.infer<typeof workflowStepCompletedEventSchema>;

/** 工作流等待人工审批事件。 */
export const workflowWaitingApprovalEventSchema = baseSseEventSchema.extend({
  type: z.literal('workflow.waiting_approval'),
  refundRequestId: z.string().uuid(),
  orderNo: z.string().min(1),
  amount: z.number().nonnegative(),
  reason: z.string().min(1),
});

export type WorkflowWaitingApprovalEvent = z.infer<typeof workflowWaitingApprovalEventSchema>;
