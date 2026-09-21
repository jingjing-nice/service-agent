import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

/**
 * 会话领域模块。
 *
 * 该模块负责组织与会话相关的 Controller 和 Service。
 *
 * 当前包含：
 * 1. ConversationsController：提供会话 REST API；
 * 2. ConversationsService：处理会话业务逻辑和数据库访问。
 *
 * PrismaService 不需要在这里重复注册。
 * DatabaseModule 已经通过 @Global() 注册为全局模块，
 * 因此 ConversationsService 可以直接注入 PrismaService。
 */
@Module({
    /**
     * 注册会话接口控制器。
     *
     * 注册后，NestJS 才能识别：
     * POST /api/conversations
     * GET  /api/conversations
     * GET  /api/conversations/:id
     *
     * 注意：
     * 当前模块还没有被 AppModule 导入，
     * 所以这些路由暂时不会真正生效。
     */
    controllers: [ConversationsController],

    /**
     * 注册会话领域服务。
     *
     * ConversationsController 会通过构造函数
     * 注入并使用同一个 ConversationsService 实例。
     */
    providers: [ConversationsService],

    /**
     * 导出 ConversationsService。
     *
     * 后续其他模块可能需要调用它，例如：
     * 1. LLM 模块更新会话状态；
     * 2. 审批模块将状态改为 waiting_approval；
     * 3. 人工接管模块将状态改为 human_takeover；
     * 4. LangGraph 流程读取会话信息。
     *
     * 导出后，其他导入 ConversationsModule 的模块
     * 可以注入 ConversationsService。
     */
    exports: [ConversationsService],
})
export class ConversationsModule { }