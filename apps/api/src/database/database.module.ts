import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * 全局数据库模块。
 *
 * @Global() 让 PrismaService 在整个应用中只注册一次。
 * 后续 KnowledgeModule、MessagesModule 等模块可以直接注入，
 * 不需要分别创建数据库连接池。
 */

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
