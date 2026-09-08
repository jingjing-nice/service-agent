import { Injectable } from '@nestjs/common';



/**
 * 消息发送者。
 *
 * customer：客户发送的消息
 * agent：AI 客服生成的消息
 */
export type MessageRole = 'customer' | 'agent';


/**
 * 后端保存的一条完整会话消息。
 */
export type ConversationMessage = {
    /** 消息的唯一编号。 */
    id: string;
    /** 这条消息属于哪个会话。 */
    conversationId: string;
    /** 消息发送者。 */
    role: MessageRole;
    /** 消息正文。 */
    content: string;
    /** 消息创建时间，使用 ISO 标准时间。 */
    createdAt: string;
}
/**
 * 创建消息时需要传入的数据。
 *
 * id 和 createdAt 由后端生成，因此调用者不需要提供。
 */
export type CreateMessageInput = {
    conversationId: string;
    role: MessageRole;
    content: string;
}

/**
 * 会话消息服务。
 *
 * 负责保存和查询消息。
 * 当前使用 Map 保存在服务器内存中，重启 API 后数据会消失。
 * 后续接入 PostgreSQL 时，可以替换这里的实现，
 * Controller 和前端接口不需要大改。
 */

@Injectable()
export class MessagesService {
    private readonly messagesByConversation = new Map<string, ConversationMessage[]>();

    // 创建并保存一条消息
    create(input: CreateMessageInput): ConversationMessage {
        // TypeScript 类型只在编译阶段生效，运行时仍可能收到错误的数据类型。
        if (typeof input.content !== 'string') {
            throw new TypeError('消息正文必须是字符串');
        }

        // content 是字符串，因此使用 trim() 去掉首尾空格。
        const content = input.content.trim();


        // trim() 后长度为 0，说明正文为空或只包含空格。
        if (content.length === 0) {
            throw new Error('消息正文不能为空');
        }
        //组装后端完整的消息对象。
        const message: ConversationMessage = {
            id: crypto.randomUUID(),
            conversationId: input.conversationId,
            role: input.role,
            content,
            createdAt: new Date().toISOString(),
        };

        // 读取这个会话之前保存的消息。
        // 如果还没有任何消息，就使用空数组。
        const currentMessages = this.messagesByConversation.get(input.conversationId) ?? [];

        // 创建新的数据，避免改到旧值
        this.messagesByConversation.set(input.conversationId, [...currentMessages, message]);

        return message;
    }

    // 查询某个会话的所有消息
    findByConversationId(conversationId: string): ConversationMessage[] {

        // 如果该会话还没有消息，返回空数组。
        const messages = this.messagesByConversation.get(conversationId) ?? [];
        // 返回数组副本，避免外部代码直接修改内部保存的数据。
        return [...messages];
    }

}

