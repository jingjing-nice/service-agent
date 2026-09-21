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
    ConversationsService,
    type PublicConversation,
} from './conversations.service.js';

/**
 * 创建会话接口接收的请求体。
 *
 * HTTP 请求来自应用外部，运行时数据不一定符合预期，
 * 所以字段先声明为 unknown，再由 Controller 完成类型校验。
 */
type CreateConversationBody = {
    /// 客户业务编号，例如 demo-customer-001。
    customerId?: unknown;

    /// 客服工作台展示的客户名称。
    customerName?: unknown;

    /// 会话来源渠道，例如 WEB、APP、WECHAT。
    channel?: unknown;

    /// 会话主题，例如退款咨询。
    topic?: unknown;
};

/**
 * 会话 REST API。
 *
 * 基础地址：
 * /api/conversations
 *
 * 当前提供：
 * POST /api/conversations     创建会话
 * GET  /api/conversations     查询会话列表
 * GET  /api/conversations/:id 查询会话详情
 */
@Controller('/api/conversations')
export class ConversationsController {
    /**
     * @param conversationsService 会话领域服务
     * @param configService NestJS 环境配置服务
     */
    constructor(
        private readonly conversationsService:
            ConversationsService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * 创建新会话。
     *
     * 请求示例：
     *
     * POST /api/conversations
     *
     * {
     *   "customerId": "demo-customer-001",
     *   "customerName": "演示客户",
     *   "channel": "WEB",
     *   "topic": "退款咨询"
     * }
     */
    @Post()
    async create(
        @Body() body: CreateConversationBody,
    ): Promise<PublicConversation> {
        /**
         * customerId 是必填字段。
         *
         * 同时拒绝：
         * 1. 未提供；
         * 2. 非字符串；
         * 3. 空字符串；
         * 4. 只包含空格的字符串。
         */
        if (
            typeof body.customerId !== 'string' ||
            !body.customerId.trim()
        ) {
            throw new BadRequestException({
                code: 'INVALID_CUSTOMER_ID',
                message: 'customerId 不能为空',
            });
        }

        /**
         * customerName 用于客服工作台展示，
         * 因此必须是非空字符串。
         */
        if (
            typeof body.customerName !== 'string' ||
            !body.customerName.trim()
        ) {
            throw new BadRequestException({
                code: 'INVALID_CUSTOMER_NAME',
                message: 'customerName 不能为空',
            });
        }

        /**
         * channel 是可选字段。
         *
         * 如果请求中包含 channel，
         * 它必须是非空字符串。
         */
        if (
            body.channel !== undefined &&
            (
                typeof body.channel !== 'string' ||
                !body.channel.trim()
            )
        ) {
            throw new BadRequestException({
                code: 'INVALID_CHANNEL',
                message: 'channel 必须是非空字符串',
            });
        }

        /**
         * topic 是可选字段。
         *
         * 如果提供，必须是字符串；
         * 空字符串会由 Service 转换成 null。
         */
        if (
            body.topic !== undefined &&
            typeof body.topic !== 'string'
        ) {
            throw new BadRequestException({
                code: 'INVALID_TOPIC',
                message: 'topic 必须是字符串',
            });
        }

        /**
         * tenantId 只从服务端配置中获取。
         *
         * 浏览器不能通过请求体指定租户，
         * 避免用户伪造 tenantId 访问其他租户的数据。
         */
        return this.conversationsService.create({
            tenantId: this.getTenantId(),
            customerId: body.customerId,
            customerName: body.customerName,

            /**
             * 前面的校验已经确认 channel
             * 只能是字符串或者 undefined。
             */
            channel:
                typeof body.channel === 'string'
                    ? body.channel
                    : undefined,

            topic:
                typeof body.topic === 'string'
                    ? body.topic
                    : undefined,
        });
    }

    /**
     * 查询当前租户最近的会话列表。
     *
     * 请求：
     * GET /api/conversations
     */
    @Get()
    async findAll(): Promise<PublicConversation[]> {
        return this.conversationsService.findAll(
            this.getTenantId(),
        );
    }

    /**
     * 查询指定会话详情。
     *
     * 请求：
     * GET /api/conversations/{conversationId}
     *
     * ParseUUIDPipe 会在进入 Service 前校验 ID。
     * 非法 UUID 会直接返回 HTTP 400。
     */
    @Get(':id')
    async findById(
        @Param(
            'id',
            new ParseUUIDPipe({
                version: '4',
            }),
        )
        conversationId: string,
    ): Promise<PublicConversation> {
        return this.conversationsService.findById(
            this.getTenantId(),
            conversationId,
        );
    }

    /**
     * 获取当前开发环境使用的租户 ID。
     *
     * 当前项目尚未实现 JWT，
     * 因此暂时读取 DEFAULT_TENANT_ID。
     *
     * TODO：
     * 接入认证模块后，改为从服务端请求上下文读取 tenantId，
     * 并移除默认租户逻辑。
     */
    private getTenantId(): string {
        /**
         * trim 可以避免环境变量只包含空格。
         *
         * 如果没有配置 DEFAULT_TENANT_ID，
         * 本地开发默认使用 tenant-local-dev。
         */
        return (
            this.configService
                .get<string>('DEFAULT_TENANT_ID')
                ?.trim() || 'tenant-local-dev'
        );
    }
}