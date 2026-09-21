import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
/**
 * Prisma 既用于 JSON 输入类型，
 * 也用于识别数据库唯一约束异常。
 *
 * 这里不能继续使用 import type，
 * 因为 PrismaClientKnownRequestError 需要在运行时判断。
 */
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * API 对外公开的消息角色。
 *
 * 数据库中的枚举使用大写，
 * API 保留前端当前使用的小写格式。
 */
export type MessageRole = 'customer' | 'agent' | 'system';

/**
 * AI 回答所引用的一条知识来源。
 */
export type MessageCitation = {
  /// 引用在回答中的编号，例如 [1] 对应 index = 1。
  index: number;

  /// 来源文档标题。
  title: string;

  /// 来源文档 ID，不直接暴露 MinIO 对象路径。
  source: string;

  /**
   * 回答实际使用的知识切片 ID。
   *
   * 可选字段用于兼容精确引用功能上线前保存的历史消息。
   */
  chunkId?: string;
};

/**
 * 返回给 Controller 和前端的消息结构。
 */
export type ConversationMessage = {
  /// 消息唯一编号。
  id: string;

  /// 消息所属会话。
  conversationId: string;

  /// 消息发送者。
  role: MessageRole;

  /// 消息正文。
  content: string;

  /// AI 回答实际使用的知识引用。
  citations?: MessageCitation[];

  /// 本轮请求的调用链编号。
  traceId?: string;

  /// 前端产生的幂等请求编号。
  requestId?: string;

  /// ISO 8601 格式的消息创建时间。
  createdAt: string;
};

/**
 * 创建消息时需要提供的数据。
 */
export type CreateMessageInput = {
  /**
   * 当前请求所属租户。
   *
   * 必须由服务端上下文提供，
   * 不能信任浏览器传入的 tenantId。
   */
  tenantId: string;

  /// 消息所属会话。
  conversationId: string;

  /// 消息发送者。
  role: MessageRole;

  /// 消息正文。
  content: string;

  /// AI 回答引用的知识来源。
  citations?: MessageCitation[];

  /// 本轮调用的 traceId。
  traceId?: string;

  /// 请求幂等编号。
  requestId?: string;

  /// 当前使用的模型名称。
  modelName?: string;
};

/**
 * 将 API 使用的小写角色转换为数据库枚举。
 */
function toDatabaseRole(
  role: MessageRole,
): 'CUSTOMER' | 'AGENT' | 'SYSTEM' {
  switch (role) {
    case 'customer':
      return 'CUSTOMER';

    case 'agent':
      return 'AGENT';

    case 'system':
      return 'SYSTEM';
  }
}

/**
 * 将数据库枚举转换为 API 使用的小写角色。
 */
function toPublicRole(
  role: 'CUSTOMER' | 'AGENT' | 'SYSTEM',
): MessageRole {
  switch (role) {
    case 'CUSTOMER':
      return 'customer';

    case 'AGENT':
      return 'agent';

    case 'SYSTEM':
      return 'system';
  }
}

/**
 * 验证并转换数据库中的 citations JSON。
 *
 * Prisma JSON 字段返回的是通用 JSON 类型，
 * 不能直接假设里面一定是 MessageCitation[]。
 */
function parseCitations(
  value: unknown,
): MessageCitation[] | undefined {
  // 非数组数据不符合引用结构，直接视为没有引用。
  if (!Array.isArray(value)) {
    return undefined;
  }

  /**
   * 逐项检查字段类型。
   *
   * 这样可以避免数据库中存在历史错误数据时，
   * 前端因为访问不存在的字段而崩溃。
   */
  const citations = value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' &&
        item !== null &&
        typeof Reflect.get(item, 'index') === 'number' &&
        typeof Reflect.get(item, 'title') === 'string' &&
        typeof Reflect.get(item, 'source') === 'string' &&
        /**
         * 历史引用允许没有 chunkId；
         * 新引用如果包含该字段，则必须是字符串。
         */
        (Reflect.get(item, 'chunkId') === undefined ||
          typeof Reflect.get(item, 'chunkId') === 'string'),
    )
    .map((item): MessageCitation => ({
      index: item.index as number,
      title: item.title as string,
      source: item.source as string,
      /** 不为历史引用主动生成错误的切片 ID。 */
      chunkId:
        typeof item.chunkId === 'string'
          ? item.chunkId
          : undefined,
    }));

  return citations.length > 0 ? citations : undefined;
}

/**
 * 将 Prisma 消息记录转换为公开消息结构。
 *
 * 集中转换可以避免 create 和 find 方法分别维护一套映射逻辑。
 */
function toConversationMessage(message: {
  id: string;
  conversationId: string;
  role: 'CUSTOMER' | 'AGENT' | 'SYSTEM';
  content: string;
  citations: unknown;
  traceId: string | null;
  requestId: string | null;
  createdAt: Date;
}): ConversationMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: toPublicRole(message.role),
    content: message.content,
    citations: parseCitations(message.citations),
    traceId: message.traceId ?? undefined,
    requestId: message.requestId ?? undefined,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * 会话消息持久化服务。
 *
 * 职责：
 * 1. 验证会话是否存在并属于当前租户；
 * 2. 将消息写入 PostgreSQL；
 * 3. 同步更新会话列表需要的最近消息；
 * 4. 查询指定会话的历史消息。
 */
@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * 保存一条会话消息。
   *
   * @param input 创建消息需要的数据
   * @returns 已经持久化的公开消息对象
   * @throws NotFoundException 会话不存在或不属于当前租户
   */
  async create(
    input: CreateMessageInput,
  ): Promise<ConversationMessage> {
    // 去除正文首尾空白，避免保存只有空格的消息。
    const content = input.content.trim();

    if (!content) {
      throw new TypeError('消息正文不能为空');
    }

    /**
     * 查询时必须同时携带 id 和 tenantId。
     *
     * 即使攻击者获得其他租户的 conversationId，
     * 也不能通过当前租户上下文向其中写入消息。
     */
    const conversation =
      await this.prisma.conversation.findFirst({
        where: {
          id: input.conversationId,
          tenantId: input.tenantId,
        },
        select: {
          id: true,
        },
      });

    /**
     * “不存在”和“无权访问”返回相同结果，
     * 避免通过错误信息探测其他租户的数据。
     */
    if (!conversation) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: '会话不存在',
      });
    }

    /**
    * 消息写入和会话摘要更新使用同一个数据库事务。
    *
    * 如果任何一步失败，事务会整体回滚，
    * 避免消息已经保存但会话摘要没有更新。
    */
    try {
      const message = await this.prisma.$transaction(
        async (transaction) => {
          /**
           * 保存完整消息。
           *
           * conversationId 和 requestId 存在联合唯一索引，
           * 相同请求重复执行时，数据库会抛出 P2002。
           */
          const createdMessage =
            await transaction.message.create({
              data: {
                tenantId: input.tenantId,
                conversationId: input.conversationId,
                role: toDatabaseRole(input.role),
                content,

                /**
                 * Prisma JSON 字段要求使用 InputJsonValue。
                 *
                 * 没有引用时传入 undefined，
                 * 数据库中的 citations 字段保持为 null。
                 */
                citations: input.citations
                  ? (input.citations as Prisma.InputJsonValue)
                  : undefined,

                traceId: input.traceId,
                requestId: input.requestId,
                modelName: input.modelName,
              },
            });

          /**
           * 同步更新会话列表需要的最近消息。
           *
           * 该更新与消息创建属于同一事务，
           * 任何一步失败都会全部回滚。
           */
          await transaction.conversation.update({
            where: {
              id: input.conversationId,
            },
            data: {
              /**
               * 数据库字段最大长度为 500，
               * 超长消息只保存前 500 个字符作为摘要。
               */
              lastMessage: content.slice(0, 500),

              /**
               * 使用消息的数据库创建时间，
               * 保证摘要时间与消息时间完全一致。
               */
              lastMessageAt: createdMessage.createdAt,
            },
          });

          return createdMessage;
        },
      );

      return toConversationMessage(message);
    } catch (error: unknown) {
      /**
       * Prisma 错误码 P2002 表示唯一约束冲突。
       *
       * 当前模型定义了：
       * @@unique([conversationId, requestId])
       *
       * 因此客户端使用相同 requestId 重试时，
       * 第二次插入会触发该错误。
       */
      const isDuplicateRequest =
        input.requestId !== undefined &&
        error instanceof
        Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002';

      /**
       * 非幂等冲突异常不在这里处理。
       *
       * 数据库断开、字段错误等异常继续向上抛出，
       * 避免把真实故障错误地伪装成成功。
       */
      if (!isDuplicateRequest) {
        throw error;
      }

      /**
       * 唯一约束冲突说明同一请求可能已经执行成功。
       *
       * 根据租户、会话和 requestId 查询之前保存的消息，
       * 将原结果返回给调用方，实现幂等重试。
       */
      const existingMessage =
        await this.prisma.message.findFirst({
          where: {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            requestId: input.requestId,
          },
        });

      /**
       * 理论上 P2002 发生后应该能查询到原消息。
       *
       * 如果查不到，可能是数据被并发删除或发生其他异常，
       * 此时不能伪造成功，继续抛出原始错误。
       */
      if (!existingMessage) {
        throw error;
      }

      /**
       * 返回第一次请求创建的原消息。
       *
       * 不再更新会话摘要，也不会新增第二条消息。
       */
      return toConversationMessage(existingMessage);
    }
  }

  /**
   * 查询指定会话最近的历史消息。
   *
   * @param tenantId 当前请求所属租户
   * @param conversationId 会话 ID
   * @param limit 最多返回多少条消息
   * @returns 按时间正序排列的消息
   */
  async findByConversationId(
    tenantId: string,
    conversationId: string,
    limit = 100,
  ): Promise<ConversationMessage[]> {
    /**
     * 先验证会话归属。
     *
     * 这里不能只按 conversationId 查询，
     * 所有业务查询都必须携带 tenantId。
     */
    const conversation =
      await this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId,
        },
        select: {
          id: true,
        },
      });

    if (!conversation) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: '会话不存在',
      });
    }

    /**
     * 将返回数量限制在 1～200 条之间。
     *
     * 即使调用方传入异常值，
     * 也不会一次读取无限量的历史记录。
     */
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    /**
     * 数据库使用倒序查询最后 N 条消息，
     * 避免先读取全部消息再在内存中截取。
     */
    const messages = await this.prisma.message.findMany({
      where: {
        tenantId,
        conversationId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: safeLimit,
    });

    /**
     * 页面和模型上下文都需要按时间正序消费消息，
     * 因此将数据库返回的倒序结果反转。
     */
    return messages
      .reverse()
      .map(toConversationMessage);
  }
}
