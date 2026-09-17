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
} from '@service-agent/contracts';
import { randomUUID } from 'node:crypto';
import { Observable, type Subscriber } from 'rxjs';
import { MessagesService } from '../messages/messages.service.js';
import { LlmService } from './llm.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import type { CitationEvent } from '@service-agent/contracts';
import type { FastifyRequest } from 'fastify';

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
  | MessageFailedEvent;

type StreamEventMetadata = Pick<
  MessageStartedEvent,
  'event_id' | 'request_id' | 'trace_id' | 'message_id'
>;

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
  ) {}

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

      // 必须先读取历史再保存当前问题，否则问题会在模型上下文中出现两次。
      const history = this.messagesService
        .findByConversationId(conversationId)
        .slice(-HISTORY_LIMIT)
        .map((message) => ({
          role:
            message.role === 'customer'
              ? ('user' as const)
              : ('assistant' as const),
          content: message.content,
        }));

      this.messagesService.create({
        conversationId,
        role: 'customer',
        content: question,
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
          emitEvent(subscriber, {
            type: 'message.started',
            ...createEventMetadata(),
          });

          if (!knowledgeBaseId) {
            throw new Error('DEFAULT_KNOWLEDGE_BASE_ID is required');
          }

          const sources = await this.knowledgeService.retrieveDraftKnowledge(
            tenantId,
            knowledgeBaseId,
            question,
          );

          for await (const text of this.llmService.streamAnswer(
            question,
            history,
            sources,
            abortController.signal,
          )) {
            if (cancelled) return;

            fullAnswer += text;
            emitEvent(subscriber, {
              type: 'answer.delta',
              ...createEventMetadata(),
              text,
            });
          }

          if (cancelled) return;

          // 空答案不能伪装成成功，否则前端会完成但消息列表中没有 AI 回复。
          if (!fullAnswer.trim()) {
            throw new Error('MODEL_EMPTY_ANSWER');
          }

          const citedIndexes = new Set(
            [...fullAnswer.matchAll(/\[(\d+)\]/g)]
              .map((match) => Number(match[1]))
              .filter((index) => index >= 1 && index <= sources.length),
          );

          const citations = [...citedIndexes].map((index) => {
            const source = sources[index - 1];
            return { index, title: source.title, source: source.documentId };
          });

          // 与回答一起保存引用，避免前端重新获取消息后来源卡片消失。
          this.messagesService.create({
            conversationId,
            role: 'agent',
            content: fullAnswer,
            citations,
          });

          for (const citation of citations) {
            emitEvent(subscriber, {
              type: 'citation',
              ...createEventMetadata(),
              ...citation,
            });
          }

          emitEvent(subscriber, {
            type: 'message.completed',
            ...createEventMetadata(),
          });
          subscriber.complete();
        } catch {
          // complete/unsubscribe 会触发 teardown；取消造成的异常不应再生成失败事件。
          if (cancelled || abortController.signal.aborted) return;

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
}
