import { answerDeltaEventSchema, citationEventSchema, messageCompletedEventSchema, messageFailedEventSchema, MessageStartedEvent, messageStartedEventSchema, streamAnswerRequestSchema, type MessageFailedEvent, type CitationEvent } from "@service-agent/contracts";

type StreamAnswerOptions = {
    onText: (text: string) => void;
    onCompleted: () => void;
    /**
   * 后端开始处理当前消息时调用。
   *
   * 每次建立流式请求时都必须提供该回调。
   */
    onStart: (event: MessageStartedEvent) => void
    /**
   * 网络断开、JSON 解析失败等前端连接异常使用该回调。
   *
   * 这类错误不一定具有 trace_id。
   */
    onError: (error: Error) => void;
    /**
     * 后端明确发送 message.failed 时调用。
     *
     * 与 onError 不同，这里能够拿到后端生成的
     * code、trace_id、request_id 和 message_id。
     */
    onFailed: (event: MessageFailedEvent) => void;

    /**
   * 收到经过 Schema 校验的知识来源时调用。
   *
   * 当前设为可选回调，因此加入 citation 协议后，
   * 现有 Hook 即使尚未展示引用也不会受到影响。
   */
    onCitation: (event: CitationEvent) => void

};




/**
 * 连接后端 SSE 接口，接收 AI 流式回复。
 *
 * 返回值是关闭连接的方法。
 */

export function streamAnswer(
    conversationId: string,
    question: string,
    options: StreamAnswerOptions,
): () => void {
    /**
 * 在发起请求前先校验会话编号和用户问题。
 *
 * 前后端使用同一个 Schema，
 * 可以保证两边的参数规则保持一致。
 */
    const requestId = crypto.randomUUID();
    const parseResult = streamAnswerRequestSchema.safeParse({
        conversationId, question, requestId
    })
    /**
 * 参数不符合规则时，不建立 SSE 连接。
 */
    if (!parseResult.success) {
        /**
         * 通知上层请求参数不正确。
         *
         * useLlmStream 收到错误后，
         * 会把页面状态设置为 failed。
         */
        options.onError(
            new Error('发送内容不符合要求'),
        );
        /**
  * streamAnswer 的返回类型要求必须返回一个关闭函数。
  *
  * 当前没有建立连接，所以返回一个空函数。
  * 调用这个空函数不会产生任何副作用。
  */
        return () => { }
    }

    const validatedRequest = parseResult.data;

    // URLSearchParams 会自动处理中文、空格和特殊符号的编码。
    const query = new URLSearchParams({
        conversationId: validatedRequest.conversationId,
        question: validatedRequest.question,
        requestId: validatedRequest.requestId
    });


    // query 已经同时包含 conversationId 和 question，
    // 这里直接拼接，避免重复生成 question 参数。
    const url = `/api/llm/stream?${query.toString()}`;

    //创建 SSE 连接
    const eventSource = new EventSource(url);


    /**
     * 当前这次连接是否已经结束。
     *
     * 完成、失败、网络错误、用户主动停止都会将它设为 true。
     * 必须放在 streamAnswer 内部，让每条连接拥有独立状态。
     */
    let ended = false;

    /**
 * 一次流式请求允许持续的最长时间。
 *
 * 这是前端等待上限，当前暂定 60 秒。
 * 后续可以根据实际响应耗时调整。
 */
    const STREAM_TIMEOUT_MS = 60_000;

    /**
     * 从建立连接开始计时。
     *
     * 超时后复用现有错误处理：
     * 关闭连接 → 标记结束 → 通知 Hook 显示失败。
     *
     * reportStreamError 是函数声明，可以在定义位置之前引用。
     */
    const timeoutId = window.setTimeout(() => {
        reportStreamError('回答生成超时，请稍后重试')
    }, STREAM_TIMEOUT_MS)

    /**
     * 结束当前连接。
     *
     * 返回 true：本次调用首次结束连接，可以发送终止通知。
     * 返回 false：连接之前已经结束，不应重复通知页面。
     */


    function finishStream(): boolean {
        if (ended) {
            return false
        }
        // 先标记结束，再关闭连接，确保后续回调能看到终止状态。
        ended = true
        window.clearTimeout(timeoutId)
        eventSource.close()
        return true

    }

    /**
 * 统一处理协议错误和网络错误。
 *
 * 先结束连接，再通知页面；已经结束的连接不再报错，
 * 避免 completed 被后续错误改成 failed。
 */
    function reportStreamError(message: string): void {
        if (!finishStream()) {
            return;
        }

        options.onError(new Error(message));
    }

    /**
 * 当前连接最后一条已接受事件的编号。
 *
 * 后端从 1 开始编号，所以初始值使用 0。
 * 该变量属于本次 streamAnswer 调用，
 * 不会与下一次连接共享。
 */
    let lastEventNumber = 0;
    /**
     * 判断当前事件是否应继续交给业务回调处理。
     *
     * 返回 true：新事件，继续处理。
     * 返回 false：重复事件，直接忽略。
     * 抛出异常：编号非法或倒序，由监听器的 catch 处理。
     *
     * 必须先完成 Schema 和身份校验，再调用这个函数，
     * 防止非法事件修改 lastEventNumber。
     */
    function shouldAcceptEvent(eventId: string): boolean {

        /**
         * 只接受不带前导零的正整数字符串。
         *
         * 接受："1"、"12"。
         * 拒绝："0"、"-1"、"1.5"、"01"、" 1 "、"abc"。
         *
         * 不能只用 parseInt：
         * parseInt("2abc", 10) 也会得到 2。
         */
        if (!/^[1-9]\d*$/.test(eventId)) {
            throw new Error('INVALID_EVENT_ID');
        }

        const eventNumber = Number(eventId)
        /**
       * JavaScript 对过大的整数不能保证精确比较，
       * 因此需要检查是否处于安全整数范围。
       */
        if (!Number.isSafeInteger(eventNumber)) {
            throw new Error('INVALID_EVENT_ID');
        }
        /**
        * 相同编号不再次触发回调，
        * 避免同一段文本重复追加。
        */
        if (eventNumber === lastEventNumber) {
            return false;
        }
        /**
        * 更小的编号表示事件倒序。
        * 本步不缓存、重排或重新播放这些事件。
        */
        if (eventNumber < lastEventNumber) {
            throw new Error('EVENT_OUT_OF_ORDER');
        }
        // 只有确认接受之后，才更新最后处理的编号。
        lastEventNumber = eventNumber;
        return true;
    }

    /**
     * 保存 message.started 声明的当前流身份。
     *
     * 后续的文本、完成和失败事件必须携带相同的
     * request_id、trace_id 和 message_id。
     */
    let currentStreamIdentity: {
        requestId: string;
        traceId: string;
        messageId: string;
    } | null = null;

    /**
     * 确认事件属于当前正在处理的回答。
     *
     * 如果 message.started 尚未到达，或者任一身份字段不一致，
     * 就拒绝该事件，防止旧连接或异常数据污染当前回答。
     */
    function assertCurrentStream(event: {
        request_id: string;
        trace_id: string;
        message_id: string;
    }): void {
        if (!currentStreamIdentity) {
            throw new Error('STREAM_NOT_STARTED');
        }

        const matchesCurrentStream =
            event.request_id === currentStreamIdentity.requestId
            && event.trace_id === currentStreamIdentity.traceId
            && event.message_id === currentStreamIdentity.messageId;

        if (!matchesCurrentStream) {
            throw new Error('STREAM_IDENTITY_MISMATCH');
        }
    }



    /**
 * 监听后端发送的消息开始事件。
 *
 * message.started 表示后端已经接收请求，
 * 并准备开始调用大模型。
 */
    eventSource.addEventListener('message.started', (event) => {
        if (ended) {
            return;
        }
        try {
            const rowData: unknown = JSON.parse(event.data)
            /**
 * 使用共享 Schema 校验事件。
 *
 * 校验成功后，data 会自动被推断为
 * MessageStartedEvent 类型。
 */
            const data = messageStartedEventSchema.parse(rowData)

            /**
 * 开始事件必须对应前端刚刚发出的请求。
 *
 * 原有 assertCurrentStream 检查后续事件是否与开始事件一致；
 * 这里进一步确认开始事件本身属于本次请求。
 */
            if (data.request_id !== validatedRequest.requestId) {
                throw new Error('REQUEST_ID_MISMATCH');
            }



            // 一条 SSE 连接只允许出现一次开始事件。
            if (currentStreamIdentity) {
                // // 即使是重复事件，也必须先确认属于当前回答。
                assertCurrentStream(data)

                if (!shouldAcceptEvent(data.event_id)) {
                    // 相同编号的重复开始事件，不再次初始化页面状态。
                    return;
                }

                throw new Error('STREAM_ALREADY_STARTED');
            }
            // 首次开始事件也需要验证编号。
            shouldAcceptEvent(data.event_id)

            // 记录本轮回答的身份，供后续事件校验。
            currentStreamIdentity = {
                requestId: data.request_id,
                traceId: data.trace_id,
                messageId: data.message_id,
            };
            /**
    * 把经过校验的开始事件交给调用方。
    */
            options.onStart(data)
        } catch {
            reportStreamError('AI 流式事件格式、身份或顺序不正确');
        }
    })

    // 听 AI 新生成的文字：
    eventSource.addEventListener('answer.delta', (event) => {
        /**
 * 连接已经完成、失败或被用户停止时，
 * 不再解析数据，也不再追加文本。
 */
        if (ended) {
            return;
        }
        try {
            /**
      * EventSource 返回的 event.data 是 JSON 字符串，
      * 所以第一步先使用 JSON.parse() 转换为 JavaScript 数据。
      */
            const rawData: unknown = JSON.parse(event.data);
            /**
              * 使用共享的 Zod Schema 校验后端数据。
              *
              * parse() 校验成功时返回类型安全的数据；
              * 校验失败时会抛出 ZodError，并进入下面的 catch。
              */
            const data = answerDeltaEventSchema.parse(rawData);


            // 只有属于当前回答的文本才能追加到页面。
            assertCurrentStream(data);
            // 第二步：忽略重复事件；非法或倒序编号会抛出异常。
            if (!shouldAcceptEvent(data.event_id)) {
                return
            }
            options.onText(data.text);
        } catch {
            reportStreamError('AI 流式事件格式、身份或顺序不正确');
        }

    });

    /**
 * 监听知识来源事件。
 *
 * citation 属于当前 AI 回答的一部分，
 * 因此需要执行与文本事件相同的身份和顺序校验。
 */
    eventSource.addEventListener('citation', (event) => {
        if (ended) {
            return
        }

        try {
            const rawData: unknown = JSON.parse(event.data);
            const citation = citationEventSchema.parse(rawData)

            // 引用必须属于 message.started 声明的当前回答。
            assertCurrentStream(citation);

            if (!shouldAcceptEvent(citation.event_id)) {
                return
            }
            options.onCitation(citation)


        } catch (error) {
            reportStreamError('AI 流式事件格式、身份或顺序不正确',)

        }


    })


    /**
 * 监听 AI 消息生成完成事件。
 *
 * 后端不再产生 answer.delta 后，
 * 会发送一次 message.completed。
 */
    eventSource.addEventListener('message.completed', (event) => {
        if (ended) {
            return;
        }
        try {
            /**
  * event.data 是后端发送的 JSON 字符串。
  *
  * 先解析成 unknown，表示在通过 Zod 校验前，
  * 我们还不能信任其中的字段。
  */
            const rowData: unknown = JSON.parse(event.data)
            /**
       * 检查完成事件是否符合共享契约。
       *
       * 本次虽然没有直接使用校验后的字段，
       * 但必须确认事件有效后才能结束本次回答。
       */
            const completedEvent = messageCompletedEventSchema.parse(rowData)

            // 防止其他请求的完成事件错误地结束当前回答。
            assertCurrentStream(completedEvent);

            if (!shouldAcceptEvent(completedEvent.event_id)) {
                return
            }
            /**
             * finishStream 同时完成两个动作：
             * 1. 将 ended 设为 true；
             * 2. 关闭 SSE 连接。
             *
             * 必须先标记结束，再通知 Hook 保存回答，
             * 后续事件才能被监听器开头的 ended 检查拦住。
             */
            if (finishStream()) {
                options.onCompleted();
            }
        } catch {
            reportStreamError('AI 流式事件格式、身份或顺序不正确');
        }

    });

    /**
     * 监听后端返回的结构化模型失败事件。
     */
    eventSource.addEventListener('message.failed', (event) => {
        if (ended) {
            return;
        }
        try {
            const rawData: unknown = JSON.parse(event.data);
            const failedEvent = messageFailedEventSchema.parse(rawData);

            // 只有当前请求产生的失败事件才能修改工作台状态。
            assertCurrentStream(failedEvent);

            if (!shouldAcceptEvent(failedEvent.event_id)) {
                return
            }
            /**
   * finishStream 同时完成两个动作：
   * 1. 将 ended 设为 true；
   * 2. 关闭 SSE 连接。
   *
   * 必须先标记结束，再通知 Hook 保存回答，
   * 后续事件才能被监听器开头的 ended 检查拦住。
   */
            if (finishStream()) {
                options.onFailed(failedEvent);
            }
        } catch {
            reportStreamError('AI 流式事件格式、身份或顺序不正确');
        }
    });

    eventSource.addEventListener('error', () => {
        reportStreamError('连接中断，请稍后重试');

    });

    return () => {
        finishStream();
    };
}
