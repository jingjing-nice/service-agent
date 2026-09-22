import {
  BadRequestException,
  Controller,
  Query,
  Req,
  Sse,
  type MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import {
  streamAnswerRequestSchema,
  type AnswerDeltaEvent,
  type MessageCompletedEvent,
  type MessageFailedEvent,
  type MessageStartedEvent,
  type WorkflowStep,
  type WorkflowStepCompletedEvent,
  type WorkflowWaitingApprovalEvent,
} from '@service-agent/contracts';
import { randomUUID } from 'node:crypto';
import { Observable, type Subscriber } from 'rxjs';
import { MessagesService } from '../messages/messages.service.js';
import { LlmService } from './llm.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import type { CitationEvent } from '@service-agent/contracts';
import type { FastifyRequest } from 'fastify';
import { RefundWorkflowService } from '../refunds/refund-workflow.service.js';
import {
  RefundWorkflowGraphService,
  RefundWorkflowInterruptError,
} from '../refunds/refund-workflow-graph.service.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * 单次模型流允许占用的最长时间。
 *
 * 导出常量是为了让测试使用虚拟时钟精确推进到同一个边界，
 * 避免复制一个可能与生产配置逐渐失去同步的数字。
 */
export const MODEL_TIMEOUT_MS = 45_000;
const HISTORY_LIMIT = 10;

type StreamEvent =
  | MessageStartedEvent
  | AnswerDeltaEvent
  | MessageCompletedEvent
  | CitationEvent
  | MessageFailedEvent
  | WorkflowStepCompletedEvent
  | WorkflowWaitingApprovalEvent;

type StreamEventMetadata = Pick<
  MessageStartedEvent,
  'event_id' | 'request_id' | 'trace_id' | 'message_id'
>;

export type AnswerCitation = {
  index: number;
  title: string;
  source: string;
  chunkId: string;
};

/** Only references to supplied chunks are allowed to become public citations. */
export function extractVerifiedCitations(
  answer: string,
  sources: Array<{
    title: string;
    documentId: string;
    chunkId: string;
  }>,
): AnswerCitation[] {
  const indexes = new Set(
    [...answer.matchAll(/\[(\d+)\]/g)]
      .map((match) => Number(match[1]))
      .filter((index) => index >= 1 && index <= sources.length),
  );

  return [...indexes].map((index) => ({
    index,
    title: sources[index - 1].title,
    source: sources[index - 1].documentId,
    chunkId: sources[index - 1].chunkId,
  }));
}

/**
 * 把业务事件转换成 NestJS 所需的 SSE 消息格式。
 * 统一从 event_id 设置 SSE id，避免各分支出现协议字段不一致。
 */
function emitEvent(
  subscriber: Subscriber<MessageEvent>,
  event: StreamEvent,
): void {
  subscriber.next({ type: event.type, id: event.event_id, data: event });
}

/** 负责校验流式请求、维护 SSE 生命周期并持久化完整会话消息。 */
@Controller('api/llm')
export class LlmController {
  constructor(
    private readonly llmService: LlmService,
    private readonly messagesService: MessagesService,
    private readonly knowledgeService: KnowledgeService,
    private readonly refundWorkflow: RefundWorkflowService,
    private readonly refundGraph: RefundWorkflowGraphService,
    private readonly prisma: PrismaService,
  ) { }

  /**
   * 建立 AI 回答流。
   *
   * 事件顺序固定为 message.started -> answer.delta* ->
   * message.completed/message.failed，所有事件共享同一组请求标识。
   */
  @Sse('stream')
  stream(
    @Query('question') rawQuestion: unknown,
    @Query('conversationId') rawConversationId: unknown,
    @Query('requestId') rawRequestId: unknown,
    @Req() request: FastifyRequest,
  ): Observable<MessageEvent> {
    const tenantId = process.env.DEFAULT_TENANT_ID ?? 'tenant-local-dev';
    const knowledgeBaseId = process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim();

    const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

    // 草稿检索仅供本机开发验证，未接入正式鉴权前不能对外开放。
    if (
      process.env.NODE_ENV === 'production' ||
      !localAddresses.has(request.ip)
    ) {
      throw new NotFoundException();
    }

    const parseResult = streamAnswerRequestSchema.safeParse({
      conversationId: rawConversationId,
      question: rawQuestion,
      requestId: rawRequestId,
    });

    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'INVALID_STREAM_REQUEST',
        message: '流式请求参数不正确',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { conversationId, question, requestId } = parseResult.data;

    return new Observable<MessageEvent>((subscriber) => {
      const traceId = randomUUID();
      const messageId = randomUUID();
      const abortController = new AbortController();
      let eventNumber = 0;
      let cancelled = false;
      let fullAnswer = '';

      /** 为每个事件生成递增编号，同时复用本次流的关联标识。 */
      const createEventMetadata = (): StreamEventMetadata => ({
        event_id: String(++eventNumber),
        request_id: requestId,
        trace_id: traceId,
        message_id: messageId,
      });


      /** 以公开、安全的错误信息结束流；底层异常不会泄漏到客户端。 */
      const failStream = (
        code: MessageFailedEvent['code'],
        message: string,
      ): void => {
        if (cancelled || subscriber.closed) return;

        emitEvent(subscriber, {
          type: 'message.failed',
          ...createEventMetadata(),
          code,
          message,
        });
        subscriber.complete();
      };

      // 总时限不会随新片段重置，保证慢速或卡住的模型调用也能被终止。
      const timeoutId = setTimeout(() => {
        failStream('MODEL_TIMEOUT', '回答生成超时，请稍后重试');
      }, MODEL_TIMEOUT_MS);

      // Observable 构造函数不能直接使用 async，因此在订阅后单独启动生成任务。
      void (async () => {
        try {
          /**
      * 必须先读取历史消息，再保存当前问题。
      *
      * 如果先保存当前问题，随后查询历史，
      * 当前问题会同时作为历史消息和本次 question 发送给模型，
      * 导致同一个问题在模型上下文中出现两次。
      */
          const previousMessages =
            await this.messagesService.findByConversationId(
              tenantId,
              conversationId,
              HISTORY_LIMIT,
            );

          /**
           * 将数据库消息转换为 LlmService 接收的消息格式。
           *
           * system 消息暂时不放进普通历史记录；
           * 系统规则继续由 LlmService 中的 system prompt 统一管理。
           */
          const history = previousMessages
            .filter((message) => message.role !== 'system')
            .map((message) => ({
              /**
               * 客户消息转换成 OpenAI 的 user 角色；
               * Agent 消息转换成 assistant 角色。
               */
              role:
                message.role === 'customer'
                  ? ('user' as const)
                  : ('assistant' as const),

              content: message.content,
            }));

          /**
           * 将本次客户问题保存到 PostgreSQL。
           *
           * tenantId 用于租户隔离；
           * requestId 用于避免客户端重试产生重复消息；
           * traceId 用于关联本轮回答的后续检索、工具和审批记录。
           */
          await this.messagesService.create({
            tenantId,
            conversationId,
            role: 'customer',
            content: question,
            requestId,
            traceId,
          });

          /**
     * 通知前端回答流程已经开始。
     *
     * 此时客户问题已经成功保存到 PostgreSQL。
     */
          emitEvent(subscriber, {
            type: 'message.started',
            ...createEventMetadata(),
          });

          /**
           * 退款属于高风险写操作，使用 LangGraph 确定性工作流而不是让模型自行调用。
           *
           * isRefundIntent 仅当用户同时提到退款关键词和订单号时才返回 true，
           * 工作流内部会自主完成 RAG 检索、订单查询、资格校验、申请创建和审批中断。
           *
           * 纯政策咨询（如“退款政策是啥”）不包含订单号，走下面普通 LLM 流式回答，
           * 由模型基于 RAG 检索到的知识生成完整政策说明。
           */
          if (this.refundWorkflow.isRefundIntent(question)) {
            await this.handleRefundWorkflow(
              subscriber,
              createEventMetadata,
              { tenantId, conversationId, question, requestId, traceId },
              { cancelled, timeoutId, abortController },
            );
            return;
          }

          /**
           * 当前 RAG 流程必须指定知识库。
           */
          if (!knowledgeBaseId) {
            throw new Error('DEFAULT_KNOWLEDGE_BASE_ID is required');
          }

          /**
           * 从当前租户的默认知识库检索已发布知识。
           *
           * 正式聊天不能使用 DRAFT 文档。
           */
          const sources =
            await this.knowledgeService.retrievePublishedKnowledge(
              tenantId,
              knowledgeBaseId,
              question,
            );

          /**
           * 调用大模型并逐段读取流式回答。
           */
          const answerStream = this.llmService.streamAnswer(
            question,
            history,
            sources,
            abortController.signal,
          );
          for await (const text of answerStream) {
            /**
             * 客户端断开连接后，不再继续发送 SSE 事件。
             *
             * 模型请求也会在 Observable teardown 中被 abort。
             */
            if (cancelled) {
              return;
            }

            /**
             * 累积完整回答。
             *
             * SSE 返回的是多个文字片段，
             * 数据库只在回答完成后保存一条完整消息，
             * 避免每个 token 都执行一次数据库写入。
             */
            fullAnswer += text;

            /**
             * 将本次文字片段发送给前端。
             */
            emitEvent(subscriber, {
              type: 'answer.delta',
              ...createEventMetadata(),
              text,
            });
          }

          /**
           * 如果模型结束前客户端已经断开，
           * 不保存不完整的回答。
           */
          if (cancelled) {
            return;
          }

          /**
           * 模型没有返回有效正文时不能伪装成成功。
           *
           * 空回答进入 catch 后会通过 message.failed
           * 返回稳定的公开错误信息。
           */
          if (!fullAnswer.trim()) {
            throw new Error('MODEL_EMPTY_ANSWER');
          }

          /**
           * 从完整回答中提取模型实际使用的引用编号。
           *
           * 例如回答中出现：
           * “根据退款政策 [1]，退款将在 3 个工作日内处理。”
           *
           * 正则会提取编号 1。
           */
          const citations = extractVerifiedCitations(fullAnswer, sources);

          /**
           * 将完整 AI 回答和引用保存到 PostgreSQL。
           *
           * 客户消息与 AI 回答共享 traceId，
           * 后续可以通过 traceId 查询同一轮执行产生的全部记录。
           */
          await this.messagesService.create({
            tenantId,
            conversationId,
            role: 'agent',
            content: fullAnswer,
            citations,
            traceId,

            /**
             * 客户问题已经使用原始 requestId。
             *
             * AI 回答增加 :answer 后缀，
             * 既能看出两条消息属于同一请求，
             * 又不会违反数据库中的唯一索引：
             * @@unique([conversationId, requestId])
             */
            requestId: `${requestId}:answer`,

            /**
             * 保存回答使用的模型名称。
             *
             * 后续调用轨迹、评测结果和成本统计
             * 都可以使用该字段。
             */
            modelName:
              process.env.LLM_MODEL ?? 'unknown',
          });

          /**
           * AI 回答保存成功后，
           * 再逐条发送结构化引用事件。
           */
          for (const citation of citations) {
            emitEvent(subscriber, {
              type: 'citation',
              ...createEventMetadata(),
              ...citation,
            });
          }

          /**
           * 通知前端当前回答已经完整结束。
           *
           * message.completed 必须是正常流程的最后一个业务事件。
           */
          emitEvent(subscriber, {
            type: 'message.completed',
            ...createEventMetadata(),
          });

          /**
           * 关闭 SSE Observable。
           *
           * complete 会触发 teardown，
           * 清除超时定时器并释放 AbortController。
           */
          subscriber.complete();
        } catch (error) {
          // complete/unsubscribe 会触发 teardown；取消造成的异常不应再生成失败事件。
          if (cancelled || abortController.signal.aborted) return;

          // 打印真实异常便于排查，客户端仍只看到稳定的公开错误信息。
          console.error('[llm-stream] workflow/model failed:', error);

          failStream('MODEL_STREAM_FAILED', 'AI 服务暂时不可用，请稍后重试');
        }
      })();

      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
        abortController.abort();
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // 退款工作流 LangGraph 处理
  // ══════════════════════════════════════════════════════════════════

  /** 工作流步骤 → 前端展示标签映射。 */
  private static readonly STEP_LABELS: Record<string, string> = {
    rag_retrieve: '检索退款政策',
    extract_order: '提取订单号',
    query_order: '查询订单信息',
    check_eligibility: '判断退款资格',
    create_refund: '创建退款申请',
    await_approval: '等待人工审批',
    build_result: '生成处理结果',
  };

  /**
   * 启动 LangGraph 退款工作流，将每个节点的执行结果以 SSE 事件推送给前端。
   *
   * - 图正常完成（无政策/无订单/不符合条件）：发送 message.completed 关闭流
   * - 图中断（需审批）：发送 workflow.waiting_approval 关闭流
   * - 审批后通过 RefundController.decide 恢复执行并持久化结果
   */
  private async handleRefundWorkflow(
    subscriber: Subscriber<MessageEvent>,
    createEventMetadata: () => StreamEventMetadata,
    params: {
      tenantId: string;
      conversationId: string;
      question: string;
      requestId: string;
      traceId: string;
    },
    cleanup: {
      cancelled: boolean;
      timeoutId: ReturnType<typeof setTimeout>;
      abortController: AbortController;
    },
  ): Promise<void> {
    // 查询会话获取 customerId
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: params.conversationId, tenantId: params.tenantId },
      select: { customerId: true },
    });

    if (!conversation) {
      // 会话不存在，走通用失败处理
      throw new Error('CONVERSATION_NOT_FOUND');
    }

    try {
      for await (const update of this.refundGraph.streamWorkflow(
        {
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          question: params.question,
          requestId: params.requestId,
          traceId: params.traceId,
          customerId: conversation.customerId,
        },
        params.conversationId,
      )) {
        if (cleanup.cancelled) return;

        const label =
          LlmController.STEP_LABELS[update.node] ?? update.node;

        emitEvent(subscriber, {
          type: 'workflow.step_completed',
          ...createEventMetadata(),
          step: update.node as WorkflowStep,
          label,
        });

        /**
         * build_result 节点产出最终答案时，需要将 finalAnswer
         * 以 answer.delta 事件发送给前端，否则前端无法累积
         * streamingText，导致 saveAssistantMessage 不会保存本地消息。
         *
         * 同时发送 citation 事件，保持与普通 LLM 流一致的协议。
         */
        if (update.node === 'build_result' && update.data.finalAnswer) {
          emitEvent(subscriber, {
            type: 'answer.delta',
            ...createEventMetadata(),
            text: update.data.finalAnswer,
          });

          const citations: Array<{
            index: number;
            title: string;
            source: string;
            chunkId?: string;
          }> = Array.isArray(update.data.citations)
            ? (update.data.citations as Array<{
                index: number;
                title: string;
                source: string;
                chunkId?: string;
              }>)
            : [];

          for (const citation of citations) {
            emitEvent(subscriber, {
              type: 'citation',
              ...createEventMetadata(),
              index: citation.index,
              title: citation.title,
              source: citation.source,
              ...(citation.chunkId ? { chunkId: citation.chunkId } : {}),
            });
          }
        }
      }

      // 图正常完成（无政策 / 无订单 / 不符合条件等提前返回路径）
      // 结果已由 buildResultNode 持久化到消息表
      if (!cleanup.cancelled) {
        emitEvent(subscriber, {
          type: 'message.completed',
          ...createEventMetadata(),
        });
        subscriber.complete();
        clearTimeout(cleanup.timeoutId);
      }
    } catch (error: unknown) {
      if (cleanup.cancelled || cleanup.abortController.signal.aborted) return;

      if (error instanceof RefundWorkflowInterruptError) {
        // 审批中断：发送 waiting_approval 事件，客户端进入等待审批状态
        emitEvent(subscriber, {
          type: 'workflow.waiting_approval',
          ...createEventMetadata(),
          refundRequestId: error.interruptContext.refundRequestId,
          orderNo: error.interruptContext.orderNo,
          amount: error.interruptContext.amount,
          reason: error.interruptContext.reason,
        });
        subscriber.complete();
        clearTimeout(cleanup.timeoutId);
        return;
      }

      throw error;
    }
  }
}
