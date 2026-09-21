import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import type {
    Conversation as PrismaConversation,
    ConversationStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * API 对外公开的会话状态。
 *
 * 数据库枚举使用大写格式，例如 WAITING_APPROVAL；
 * 前端状态机使用小写格式，例如 waiting_approval。
 */
export type PublicConversationStatus =
    | 'idle'
    | 'sending'
    | 'streaming'
    | 'waiting_approval'
    | 'human_takeover'
    | 'completed'
    | 'failed';

/**
 * API 返回给前端的会话结构。
 *
 * 该类型不直接暴露 Prisma 模型，
 * 避免数据库字段调整直接影响前端接口。
 */
export type PublicConversation = {
    /// 会话唯一编号。
    id: string;

    /// 客户业务编号。
    customerId: string;

    /// 客服工作台展示的客户名称。
    customerName: string;

    /// 会话来源渠道，例如 WEB、APP、WECHAT。
    channel: string;

    /// 会话主题；新会话可能暂时没有主题。
    topic?: string;

    /// 前端状态机使用的会话状态。
    status: PublicConversationStatus;

    /**
     * 会话列表中展示的最近消息。
     *
     * 新会话还没有消息时返回“暂无消息”。
     */
    preview: string;

    /// 最近消息的 ISO 时间；新会话可能没有该字段。
    lastMessageAt?: string;

    /// 会话创建时间，使用 ISO 8601 格式。
    createdAt: string;
};

/**
 * 创建会话需要的数据。
 *
 * tenantId 必须由服务端上下文提供，
 * 不能直接信任浏览器传入的租户编号。
 */
export type CreateConversationInput = {
    /// 当前请求所属租户。
    tenantId: string;

    /// 客户业务编号。
    customerId: string;

    /// 客户展示名称。
    customerName: string;

    /// 来源渠道；未提供时默认使用 WEB。
    channel?: string;

    /// 会话主题；允许暂时为空。
    topic?: string;
};

/**
 * Prisma 会话状态与前端公开状态之间的映射。
 *
 * 使用 Record<ConversationStatus, PublicConversationStatus>
 * 可以让 TypeScript 检查所有数据库枚举是否都已经处理。
 *
 * 后续如果 Prisma 枚举增加新状态而这里没有同步修改，
 * TypeScript 构建会直接报错。
 */
const PUBLIC_STATUS_BY_DATABASE_STATUS: Record<
    ConversationStatus,
    PublicConversationStatus
> = {
    IDLE: 'idle',
    SENDING: 'sending',
    STREAMING: 'streaming',
    WAITING_APPROVAL: 'waiting_approval',
    HUMAN_TAKEOVER: 'human_takeover',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

/**
 * 将 Prisma Conversation 转换成公开 API 结构。
 *
 * 转换逻辑独立成普通函数，便于复用和单元测试。
 */
function toPublicConversation(
    conversation: PrismaConversation,
): PublicConversation {
    return {
        id: conversation.id,
        customerId: conversation.customerId,
        customerName: conversation.customerName,
        channel: conversation.channel,

        /**
         * 数据库使用 null 表示没有主题，
         * API 使用 undefined 表示可选字段不存在。
         */
        topic: conversation.topic ?? undefined,

        /**
         * 不直接把数据库枚举暴露给前端，
         * 统一转换成前端状态机使用的小写形式。
         */
        status:
            PUBLIC_STATUS_BY_DATABASE_STATUS[
            conversation.status
            ],

        /**
         * 新会话还没有消息时，
         * 使用稳定的页面提示代替空字符串。
         */
        preview: conversation.lastMessage ?? '暂无消息',

        /**
         * Date 对象不能直接作为公共接口类型使用。
         * 转换成 ISO 字符串后，前端可以根据本地时区格式化。
         */
        lastMessageAt:
            conversation.lastMessageAt?.toISOString(),

        createdAt: conversation.createdAt.toISOString(),
    };
}

/**
 * 会话领域服务。
 *
 * 当前职责：
 * 1. 创建新会话；
 * 2. 查询当前租户的会话列表；
 * 3. 查询指定会话详情；
 * 4. 保证所有查询携带 tenantId；
 * 5. 将数据库模型转换为稳定的 API 模型。
 */
@Injectable()
export class ConversationsService {
    /**
     * PrismaService 由全局 DatabaseModule 提供。
     *
     * 应用内共享一个 PrismaClient 和数据库连接池，
     * 不需要在当前服务中创建新的 PrismaClient。
     */
    constructor(private readonly prisma: PrismaService) { }

    /**
     * 创建一条新会话。
     *
     * @param input 创建会话需要的数据
     * @returns 创建完成后的公开会话结构
     */
    async create(
        input: CreateConversationInput,
    ): Promise<PublicConversation> {
        /**
         * Service 仍然执行基础规范化，
         * 不能完全依赖 Controller 的参数校验。
         */
        const tenantId = input.tenantId.trim();
        const customerId = input.customerId.trim();
        const customerName = input.customerName.trim();
        const channel = input.channel?.trim() || 'WEB';
        const topic = input.topic?.trim() || null;

        /**
         * 当前租户由服务端配置或认证上下文提供。
         * 如果 tenantId 为空，说明服务端配置存在问题。
         */
        if (!tenantId) {
            throw new TypeError('tenantId 不能为空');
        }

        if (!customerId) {
            throw new TypeError('customerId 不能为空');
        }

        if (!customerName) {
            throw new TypeError('customerName 不能为空');
        }

        /**
         * 创建会话时不主动填写 status，
         * 让数据库使用 IDLE 默认值。
         *
         * lastMessage 和 lastMessageAt 也保持为空，
         * 等第一条消息保存成功后再更新。
         */
        const conversation =
            await this.prisma.conversation.create({
                data: {
                    tenantId,
                    customerId,
                    customerName,
                    channel,
                    topic,
                },
            });

        return toPublicConversation(conversation);
    }

    /**
     * 查询当前租户的最近会话。
     *
     * @param tenantId 当前请求所属租户
     * @returns 当前租户最近的会话列表
     */
    async findAll(
        tenantId: string,
    ): Promise<PublicConversation[]> {
        const normalizedTenantId = tenantId.trim();

        if (!normalizedTenantId) {
            throw new TypeError('tenantId 不能为空');
        }

        const conversations =
            await this.prisma.conversation.findMany({
                /**
                 * 所有业务查询都必须包含 tenantId。
                 *
                 * 即使当前个人项目只有一个租户，
                 * 也应保持数据隔离习惯。
                 */
                where: {
                    tenantId: normalizedTenantId,
                },

                /**
                 * 有消息的会话优先按最近消息时间排列。
                 *
                 * 对于没有消息的新会话，
                 * 再使用创建时间进行稳定排序。
                 */
                orderBy: [
                    {
                        lastMessageAt: 'desc',
                    },
                    {
                        createdAt: 'desc',
                    },
                ],

                /**
                 * 当前接口最多返回最近 100 条会话，
                 * 防止数据增加后一次加载全部记录。
                 *
                 * 后续可以改为 cursor 分页。
                 */
                take: 100,
            });

        return conversations.map(toPublicConversation);
    }

    /**
     * 查询指定会话详情。
     *
     * @param tenantId 当前请求所属租户
     * @param conversationId 会话唯一编号
     * @returns 指定会话的公开结构
     * @throws NotFoundException 会话不存在或不属于当前租户
     */
    async findById(
        tenantId: string,
        conversationId: string,
    ): Promise<PublicConversation> {
        const normalizedTenantId = tenantId.trim();
        const normalizedConversationId =
            conversationId.trim();

        if (!normalizedTenantId) {
            throw new TypeError('tenantId 不能为空');
        }

        if (!normalizedConversationId) {
            throw new TypeError('conversationId 不能为空');
        }

        /**
         * 使用 findFirst 而不是只按 id 调用 findUnique，
         * 是为了强制在同一查询中加入 tenantId 条件。
         */
        const conversation =
            await this.prisma.conversation.findFirst({
                where: {
                    id: normalizedConversationId,
                    tenantId: normalizedTenantId,
                },
            });

        /**
         * “记录不存在”和“属于其他租户”统一返回 404。
         *
         * 这样调用者无法通过错误差异探测
         * 其他租户是否存在某个会话 ID。
         */
        if (!conversation) {
            throw new NotFoundException({
                code: 'CONVERSATION_NOT_FOUND',
                message: '会话不存在',
            });
        }

        return toPublicConversation(conversation);
    }
}