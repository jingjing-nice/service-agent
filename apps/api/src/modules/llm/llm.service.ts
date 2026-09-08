import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';



/**
 * 发送给模型的历史消息。
 *
 * user 表示客户消息；
 * assistant 表示 AI 之前的回答。
 */
export type LlmHistoryMessage = {
    role: 'user' | 'assistant';
    content: string;
};

@Injectable()
export class LlmService {
    private readonly model = new ChatOpenAI({
        model: process.env.LLM_MODEL,
        apiKey: process.env.LLM_API_KEY,
        configuration: {
            baseURL: process.env.LLM_BASE_URL,
        },
        temperature: 0,
        maxRetries: 2,
    });
    //async * 表示这是一个“异步生成器”，它可以多次返回结果。
    //ortSignal 是浏览器和 Node.js 自带的类型，不需要额外导入
    async *streamAnswer(question: string, history: LlmHistoryMessage[], signal?: AbortSignal): AsyncGenerator<string> {
        const stream = await this.model.stream([
            {
                role: 'system',
                content: '你是一个企业智能客服。你需要根据用户的提问，结合企业知识库中的信息，给出准确、简洁的回答。请确保回答内容与企业知识库相关，并且避免提供不相关或虚假的信息。',
            },
            // 展开当前会话之前的消息。
            ...history,
            {
                role: 'user',
                content: question,
            },

        ], { signal })

        for await (const chunk of stream) {
            // 如果浏览器已经断开连接，signal.aborted 会变为 true，此时我们应该停止生成答案。
            if (signal?.aborted) {
                throw new Error('用户已取消请求');
            }
            if (chunk.text) {
                yield chunk.text;
            }
        }
    }



}
