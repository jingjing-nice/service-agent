type StreamAnswerOptions = {
    onText: (text: string) => void;
    onCompleted: () => void;
    onError: (error: Error) => void;
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

    // URLSearchParams 会自动处理中文、空格和特殊符号的编码。
    const query = new URLSearchParams({
        conversationId,
        question,
    });


    // query 已经同时包含 conversationId 和 question，
    // 这里直接拼接，避免重复生成 question 参数。
    const url = `/api/llm/stream?${query.toString()}`;

    //创建 SSE 连接
    const eventSource = new EventSource(url);

    // 听 AI 新生成的文字：
    eventSource.addEventListener('answer.delta', (event) => {
        try {
            const data = JSON.parse(event.data) as {
                type: 'answer.delta';
                event_id: string;
                request_id: string;
                trace_id: string;
                message_id: string;
                text: string;
            };
            options.onText(data.text);
        } catch (error) {
            options.onError(new Error('AI 流式数据解析失败'),);
            eventSource.close();
        }

    });

    eventSource.addEventListener('message.completed', () => {
        options.onCompleted();
        eventSource.close();
    });

    eventSource.addEventListener('error', (event) => {
        options.onError(new Error('SSE connection error'));
        eventSource.close();
    });

    return () => {
        eventSource.close();
    };
}
