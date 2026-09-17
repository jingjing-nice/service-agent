import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { MAX_KNOWLEDGE_FILE_SIZE } from './modules/knowledge/knowledge-file.validator.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  /**
   * 注册 Fastify Multipart 插件。
   *
   * 为什么在应用入口注册：
   * Multipart 属于 HTTP 请求解析能力，应当由底层 Fastify
   * 在请求进入 Controller 前完成识别。
   */

  await app.register(multipart, {
    limits: {
      /**
       * 不接收额外的普通表单字段。
       * tenantId 必须由服务端确定，不能由客户端上传。
       */
      fields: 0,
      /**
       * 当前上传接口一次只允许上传一个文件。
       */
      files: 1,
      /**
       * 一个请求只允许包含一个 multipart part。
       */
      parts: 1,
      fileSize: MAX_KNOWLEDGE_FILE_SIZE,
    },
  });

  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });

  await app.listen({ port: Number(process.env.PORT ?? 8000), host: '0.0.0.0' });
}
await bootstrap();
