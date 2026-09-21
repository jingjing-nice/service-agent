import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessagesService,
  type ConversationMessage,
} from './messages.service.js';

/**
 * 浏览器手工创建消息时允许提交的数据。
 *
 * HTTP 请求体属于外部输入，
 * 因此先使用 unknown，再在 Controller 中进行运行时校验。
 */
type CreateMessageBody = {
  /**
   * 消息发送者。
   *
   * 当前允许：
   * customer：客户消息
   * agent：AI 或客服消息
   * system：系统流程消息
   */
  role?: unknown;

  /// 消息正文。
  content?: unknown;

  /**
   * 请求幂等编号。
   *
   * 提供该字段后，相同会话中不能重复保存相同 requestId。
   */
  requestId?: unknown;
};

/**
 * 会话消息 REST API。
 *
 * 基础路径：
 * /api/conversations/:conversationId/messages
 *
 * 当前提供：
 * GET  /api/conversations/:conversationId/messages
 * POST /api/conversations/:conversationId/messages
 */
@Controller('/api/conversations/:conversationId/messages')
export class MessagesController {
  /**
   * @param messagesService 消息持久化服务
   * @param configService NestJS 环境配置服务
   */
  constructor(
    private readonly messagesService: MessagesService,
    private readonly configService: ConfigService,
  ) { }

  /**
   * 查询指定会话最近的历史消息。
   *
   * 请求示例：
   *
   * GET /api/conversations/{conversationId}/messages
   *
   * @param conversationId 会话 UUID
   * @returns 按创建时间正序排列的消息
   */
  @Get()
  async findAll(
    /**
     * ParseUUIDPipe 在调用业务服务前校验会话 ID。
     *
     * 非 UUID 参数会直接得到 HTTP 400，
     * 不会进入 Prisma 查询。
     */
    @Param(
      'conversationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    conversationId: string,
  ): Promise<ConversationMessage[]> {
    /**
     * tenantId 来自服务端环境配置，
     * 不允许客户端自行指定。
     */
    return this.messagesService.findByConversationId(
      this.getTenantId(),
      conversationId,
    );
  }

  /**
   * 手工向指定会话添加一条消息。
   *
   * 请求示例：
   *
   * POST /api/conversations/{conversationId}/messages
   *
   * {
   *   "role": "customer",
   *   "content": "退款什么时候到账？",
   *   "requestId": "request-demo-001"
   * }
   *
   * 模型生成的 AI 消息通常不经过该接口，
   * 而是由 LlmController 直接调用 MessagesService 保存。
   */
  @Post()
  async create(
    @Param(
      'conversationId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    conversationId: string,
    @Body() body: CreateMessageBody,
  ): Promise<ConversationMessage> {
    /**
     * TypeScript 类型无法验证实际 HTTP 请求，
     * 所以必须在运行时检查 role。
     */
    if (
      body.role !== 'customer' &&
      body.role !== 'agent' &&
      body.role !== 'system'
    ) {
      throw new BadRequestException({
        code: 'INVALID_MESSAGE_ROLE',
        message:
          '消息角色必须是 customer、agent 或 system',
      });
    }

    /**
     * 消息正文必须是非空字符串。
     *
     * 同时拒绝：
     * 1. undefined；
     * 2. null；
     * 3. 数字或对象；
     * 4. 空字符串；
     * 5. 只有空格的字符串。
     */
    if (
      typeof body.content !== 'string' ||
      !body.content.trim()
    ) {
      throw new BadRequestException({
        code: 'INVALID_MESSAGE_CONTENT',
        message: '消息正文不能为空',
      });
    }

    /**
     * requestId 是可选字段。
     *
     * 如果请求提供了该字段，
     * 它必须是非空字符串。
     */
    if (
      body.requestId !== undefined &&
      (
        typeof body.requestId !== 'string' ||
        !body.requestId.trim()
      )
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST_ID',
        message: 'requestId 必须是非空字符串',
      });
    }

    /**
     * Controller 只负责校验和传递参数。
     *
     * 会话归属验证、消息写入和会话摘要更新
     * 都由 MessagesService 负责。
     */
    return this.messagesService.create({
      tenantId: this.getTenantId(),
      conversationId,
      role: body.role,
      content: body.content,

      /**
       * 校验完成后统一去除 requestId 首尾空格。
       */
      requestId:
        typeof body.requestId === 'string'
          ? body.requestId.trim()
          : undefined,
    });
  }

  /**
   * 获取当前开发环境使用的租户 ID。
   *
   * 当前项目尚未实现 JWT，
   * 因此暂时从 DEFAULT_TENANT_ID 获取。
   *
   * TODO：
   * 接入认证后，应从服务端 RequestContext 获取 tenantId，
   * 并移除这里的默认租户。
   */
  private getTenantId(): string {
    /**
     * 如果环境变量不存在或只有空格，
     * 本地开发默认使用 tenant-local-dev。
     */
    return (
      this.configService
        .get<string>('DEFAULT_TENANT_ID')
        ?.trim() || 'tenant-local-dev'
    );
  }
}