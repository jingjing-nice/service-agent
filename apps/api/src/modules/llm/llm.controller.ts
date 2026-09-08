import { Controller, MessageEvent, Query, Sse } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { LlmService } from './llm.service.js';
import { MessagesService } from '../messages/messages.service.js';

/**
 * AI 流式输出控制器。
 *
 * 浏览器连接 `/api/llm/stream` 后，本控制器会调用大模型服务。
 * 模型每生成一小段文字，后端就通过 SSE 立即发送给浏览器。
 */
@Controller('api/llm')
export class LlmController {
    // NestJS 会自动创建 LlmService，并通过构造函数传递进来。
    constructor(private readonly llmService: LlmService,
        //// 负责保存用户问题和最终的 AI 回答。
        private readonly messagesService: MessagesService) { }

    /**
     * 建立 SSE 流式连接。
     *
     * 请求示例：GET /api/llm/stream?question=退款什么时候到账
     * 如果没有传入 question，则默认向模型发送“你好”。
     */
    @Sse('stream')
    stream(@Query('question') question = '你好', @Query('conversationId') conversationId = 'c1'): Observable<MessageEvent> {
        // Observable 是一条可以多次发送数据的管道，适合 SSE 流式响应。
        return new Observable<MessageEvent>((subscriber) => {
            // requestId：标识本次用户请求。
            const requestId = randomUUID();

            // traceId：串联前端、API 和模型调用，方便以后查询日志。
            const traceId = randomUUID();

            // messageId：标识本次正在生成的 AI 消息。
            const messageId = randomUUID();

            // eventNumber：记录事件顺序，后续可用于断线重连和事件去重。
            let eventNumber = 0;

            // cancelled：记录浏览器是否已经关闭了 SSE 连接。
            let cancelled = false;

            // abortController：用于取消模型调用。
            let abortController = new AbortController();

            // 用来累积本轮 AI 返回的所有文字片段。
            let fullAnswer = ''

            /**
 * 必须在保存当前问题之前读取历史记录，
 * 否则当前问题会在模型上下文中重复出现两次。
 *  只传最近 10 条，避免历史无限增长。
 */

            const history = this.messagesService
                .findByConversationId(conversationId).slice(-10).map((message) => ({
                    role:
                        message.role === 'customer'
                            ? ('user' as const)
                            : ('assistant' as const),
                    content: message.content,
                }));

            // 先保存用户信息
            this.messagesService.create({
                conversationId,
                role: 'customer',
                content: question
            })

            // 在 Observable 内启动异步模型调用，不阻塞 Observable 的创建过程。
            void (async () => {
                try {
                    // streamAnswer 是异步生成器，每次循环只得到一小段模型文字。
                    for await (const text of this.llmService.streamAnswer(question, history, abortController.signal)) {
                        // 浏览器已经断开时，不再继续发送数据。
                        if (cancelled) {
                            return;
                        }

                        // 后端保存完整回答需要把所有 delta 拼接起来。
                        fullAnswer += text
                        eventNumber += 1;

                        // answer.delta 表示“AI 新生成了一小段文字”。
                        // subscriber.next() 只发送本次事件，不会结束 SSE 连接。
                        subscriber.next({
                            type: 'answer.delta',
                            id: String(eventNumber),
                            data: {
                                type: 'answer.delta',
                                event_id: String(eventNumber),
                                request_id: requestId,
                                trace_id: traceId,
                                message_id: messageId,
                                text,
                            },
                        });
                    }

                    if (cancelled) {
                        return;
                    }

                    // 将完整 AI 回答保存到后端。
                    if (fullAnswer.trim()) {
                        this.messagesService.create({
                            conversationId,
                            role: 'agent',
                            content: fullAnswer,
                        });
                    }



                    eventNumber += 1;

                    // 模型没有更多文字时，通知前端当前消息已经生成完毕。
                    subscriber.next({
                        type: 'message.completed',
                        id: String(eventNumber),
                        data: {
                            type: 'message.completed',
                            event_id: String(eventNumber),
                            request_id: requestId,
                            trace_id: traceId,
                            message_id: messageId,
                        },
                    });

                    // 正常结束 Observable，NestJS 随后会关闭本次 SSE 响应。
                    subscriber.complete();
                } catch (error) {
                    if (cancelled || abortController?.signal.aborted) {
                        return;
                    }
                    // 模型调用失败时，把错误交给 Observable 处理并结束连接。
                    subscriber.error(error);
                }
            })();

            // 浏览器关闭页面或主动断开连接时，RxJS 会调用这个清理函数。
            return () => {
                cancelled = true;
                // 取消模型调用，避免浪费算力。
                abortController.abort();
            };
        });
    }
}
