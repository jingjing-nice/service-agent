import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma CLI 配置。
 *
 * schema：数据模型文件位置。
 * migrations.path：数据库迁移文件保存位置。
 * datasource.url：从 apps/api/.env 读取 PostgreSQL连接地址。
 */

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
