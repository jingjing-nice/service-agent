import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma 数据库服务。
 *
 * 为什么单独封装：
 * 1. 整个 NestJS 应用共享一个数据库连接池；
 * 2. 业务模块不需要重复创建 PrismaClient；
 * 3. 应用启动和关闭时，可以统一管理数据库连接；
 * 4. 后续 KnowledgeService 可以直接注入该服务。
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    // 数据库地址属于必需配置，缺失时应在启动阶段立即失败，
    // 避免等到处理用户请求时才出现难以定位的连接错误。
    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }

    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  /**
   * NestJS 初始化该服务时主动建立数据库连接。
   *
   * 这样数据库不可用时，应用会在启动阶段直接报错，
   * 而不是在第一次查询时才暴露问题。
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * NestJS 关闭时释放数据库连接池，
   * 防止开发热更新或测试结束后残留数据库连接。
   */

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
