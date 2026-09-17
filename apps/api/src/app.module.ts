import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LlmModule } from './modules/llm/llm.module.js';
import { MessagesModule } from './modules/messages/messages.module.js';
import { DatabaseModule } from './database/database.module.js';
import { KnowledgeModule } from './modules/knowledge/knowledge.module.js';

/**
 * 应用根模块。
 *
 * NestJS 启动时会先读取这个模块，并根据这里的配置加载其他模块、
 * Controller 和 Service。
 */
@Module({
  imports: [
    // 读取 apps/api/.env 中的环境变量，例如模型名称、API Key 和接口地址。
    ConfigModule.forRoot({
      // 设置为全局模块后，其他模块不需要再次导入 ConfigModule。
      isGlobal: true,
    }),
    // 创建全局 Prisma 数据库连接。
    DatabaseModule,
    /**
     * 注册知识文档状态查询接口。
     */
    KnowledgeModule,

    // 注册大模型模块，使应用可以访问 AI 流式输出接口。
    LlmModule,
    // 注册消息模块，使应用可以访问会话消息接口。
    MessagesModule,
  ],

  // 注册应用基础接口，例如 /api/health。
  controllers: [AppController],

  // 注册 AppController 依赖的基础服务。
  providers: [AppService],
})
export class AppModule {}
