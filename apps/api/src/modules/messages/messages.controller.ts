import { Controller, Get, Post, Body, BadRequestException, Param } from '@nestjs/common';
import { MessagesService, type ConversationMessage } from './messages.service.js';


/**
 * 浏览器创建消息时提交的数据。
 *
 * conversationId 来自 URL，所以请求体只需要提交角色和正文。
 */
type CreateMessageBody = {
    role?: unknown;
    content?: unknown;
};



/**
 * 会话消息接口。
 *
 * 对应的基础地址是：
 * /api/conversations/:conversationId/messages
 *
 * 例如：
 * /api/conversations/c1/messages
 */

@Controller('/api/conversations/:conversationId/messages')
export class MessagesController {
    constructor(private readonly messagesService: MessagesService) { }

    /**
 * 查询指定会话的全部消息。
 *
 * 请求示例：
 * GET /api/conversations/c1/messages
 */
    @Get()
    findAll(@Param('conversationId') conversationId: string): ConversationMessage[] {

        // URL 中必须提供有效的会话 ID。
        if (!conversationId) {
            throw new BadRequestException('会话ID不能为空');
        }

        return this.messagesService.findByConversationId(conversationId)
    }
    /**
     * 向指定会话中添加一条消息。
     *
     * 请求示例：
     * POST /api/conversations/c1/messages
     *
     * 请求体：
     * {
     *   "role": "customer",
     *   "content": "退款什么时候到账？"
     * }
     */

    @Post()
    create(@Param('conversationId') conversationId: string,
        @Body() body: CreateMessageBody): ConversationMessage {
        // 防止创建没有会话归属的消息。
        if (!conversationId) {
            throw new BadRequestException('会话ID不能为空');
        }

        // 接口目前只接受客户消息和 AI 消息。
        if (body.role !== 'customer' && body.role !== 'agent') {
            throw new BadRequestException('消息角色必须是 customer 或 agent');
        }

        // 消息正文不能为空。
        if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
            throw new BadRequestException('消息正文不能为空');
        }

        // 调用服务创建消息，并返回该会话的全部消息。
        return this.messagesService.create({
            conversationId,
            role: body.role,
            content: body.content,
        });


    }

}
