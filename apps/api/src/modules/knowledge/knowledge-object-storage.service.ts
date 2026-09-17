import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import {
  ValidatedKnowledgeFile,
  MAX_KNOWLEDGE_FILE_SIZE,
} from './knowledge-file.validator.js';
import { extname } from 'path';

/**
 * 文件成功写入 MinIO 后返回的标准结果。
 *
 * 后续 KnowledgeService 会把 objectName
 * 保存到 PostgreSQL 文档记录中。
 */
export interface StoredKnowledgeObject {
  bucketName: string;
  objectName: string;
  etag: string;
  versionId: string | null;
}

/**
 * 知识文档对象存储服务。
 *
 * 负责初始化知识库 bucket，以及原始文档的上传、读取和删除。
 */
@Injectable()
export class KnowledgeObjectStorageService implements OnModuleInit {
  /**
   * 使用 NestJS Logger 记录初始化结果。
   *
   * 日志中只记录 bucket 名称，
   * 不能输出 accessKey 或 secretKey。
   */
  private readonly logger = new Logger(KnowledgeObjectStorageService.name);

  /**
   * MinIO S3 兼容客户端。
   */
  private readonly client: MinioClient;

  /**
   * 知识文档专用 bucket。
   *
   * Milvus 有自己的内部 bucket，
   * 用户上传的原文件不能和 Milvus 数据混合保存。
   */
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    /**
     * getOrThrow 可以让缺少关键配置时立即停止应用启动。
     *
     * 如果使用普通 get()，配置缺失可能直到第一次上传文件时
     * 才暴露问题，排查起来更加困难。
     */
    const endPoint = this.configService.getOrThrow<string>('MINIO_HOST');

    const portText = this.configService.getOrThrow<string>('MINIO_PORT');
    const accessKey = this.configService.getOrThrow<string>('MINIO_ROOT_USER');
    const secretKey = this.configService.getOrThrow<string>(
      'MINIO_ROOT_PASSWORD',
    );
    const useSslText = this.configService.getOrThrow<string>('MINIO_USE_SSL');

    this.bucketName = this.configService.getOrThrow<string>(
      'MINIO_KNOWLEDGE_BUCKET',
    );

    const port = Number(portText);

    /**
     * 防止配置成无法转换为有效端口的字符串。
     */
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('MINIO_PORT must be a valid TCP port');
    }

    /**
     * 环境变量读取出来都是字符串，
     * 因此需要显式转换成 boolean。
     */
    const useSSL = useSslText.toLowerCase() === 'true';

    /**
     * 创建 MinIO 客户端。
     *
     * 构造客户端不会立即访问 MinIO，
     * 真正的连通性检查在 onModuleInit() 中发生。
     */

    this.client = new MinioClient({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
  }
  /**
   * NestJS 初始化模块时检查知识库 bucket。
   *
   * 这样 MinIO 不可用或凭据错误时，
   * 应用会在启动阶段直接失败。
   */
  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * 将已经通过校验的知识文档上传到 MinIO。
   *
   * 当前方法只负责对象存储：
   * 1. 校验服务端传入的租户 ID 和文档 ID；
   * 2. 生成不会暴露原始文件名的对象路径；
   * 3. 上传文件及必要元数据；
   * 4. 返回对象存储信息。
   */
  async uploadDocument(
    tenantId: string,
    documentId: string,
    file: ValidatedKnowledgeFile,
  ): Promise<StoredKnowledgeObject> {
    const normalizedTenantId = tenantId.trim();
    const normalizedDocumentId = documentId.trim();

    /**
     * 这两个参数应该由服务端提供。
     * 空值表示内部调用方式错误，不属于客户端文件错误。
     */
    if (normalizedTenantId.length === 0) {
      throw new Error('tenantId must not be empty');
    }

    if (normalizedDocumentId.length === 0) {
      throw new Error('documentId must not be empty');
    }

    /**
     * 文件已通过 validateKnowledgeFile() 校验，
     * 因此扩展名只可能是 .md、.pdf 或 .docx。
     */
    const extension = extname(file.fileName).toLowerCase();
    /**
     * 不直接使用原始文件名，避免：
     * 1. 同名文件相互覆盖；
     * 2. 文件名中的斜杠改变对象路径；
     * 3. 在对象路径中暴露用户文件名。
     *
     * encodeURIComponent 防止 tenantId 中的斜杠
     * 改变预期的目录层级。
     */
    const objectName = [
      'tenants',
      encodeURIComponent(normalizedTenantId),
      'documents',
      normalizedDocumentId,
      `source${extension}`,
    ].join('/');
    const result = await this.client.putObject(
      this.bucketName,
      objectName,
      file.buffer,
      file.sizeBytes,
      {
        'Content-Type': file.mimeType,
        /**
         * 原始文件名可能包含中文。
         * 编码后保存，避免 HTTP Header 字符兼容问题。
         */
        'X-Amz-Meta-Original-File-Name': encodeURIComponent(file.fileName),

        /**
         * 保存标准业务文件类型：
         * MARKDOWN、PDF 或 DOCX。
         */
        'X-Amz-Meta-File-Type': file.fileType,
      },
    );

    /**
     * 日志只记录对象路径，
     * 不记录正文或 MinIO 访问凭据。
     */
    this.logger.log(`Uploaded knowledge object: ${objectName}`);
    return {
      bucketName: this.bucketName,
      objectName,
      etag: result.etag,
      versionId: result.versionId ?? null,
    };
  }

  /**
   * 确保知识文档 bucket 已经存在。
   *
   * 首次启动时创建 bucket；
   * 后续启动时复用已有 bucket，不会删除其中的数据。
   */

  private async ensureBucketExists(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucketName);

    if (!exists) {
      await this.client.makeBucket(this.bucketName, 'us-east-1');
      this.logger.log(`Created knowledge bucket: ${this.bucketName}`);

      return;
    }
    this.logger.log(`Knowledge bucket is ready: ${this.bucketName}`);
  }

  /**
   * 删除一份已经保存的知识文档对象。
   *
   * 用途：
   * MinIO 上传成功、PostgreSQL 保存失败时，
   * 删除已上传文件，避免产生孤立对象。
   *
   * objectName 必须来自服务端生成或数据库保存的记录，
   * 不能直接使用客户端传入的路径。
   */
  async deleteDocument(objectName: string): Promise<void> {
    const normalizedObjectName = objectName.trim();

    if (normalizedObjectName.length === 0) {
      throw new Error('objectName must not be empty');
    }
    await this.client.removeObject(this.bucketName, normalizedObjectName);
    this.logger.log(`Deleted knowledge object: ${normalizedObjectName}`);
  }

  /**
   * 根据服务端保存的对象路径下载知识文档。
   *
   * 当前文件最大为 10 MiB，因此先读取为 Buffer。
   * 后续支持更大文件时，应改为流式解析。
   *
   * objectName 必须来自数据库记录，
   * 不能直接接受客户端提供的任意对象路径。
   */
  async downloadDocument(objectName: string): Promise<Buffer> {
    const normalizedObjectName = objectName.trim();

    if (normalizedObjectName.length === 0) {
      throw new Error('objectName must not be empty');
    }
    const stream = await this.client.getObject(
      this.bucketName,
      normalizedObjectName,
    );

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      totalBytes += buffer.length;

      /**
       * 即使上传接口有限制，也要限制下载大小。
       *
       * 对象可能由其他程序写入 MinIO，
       * 不能默认所有对象都经过本服务校验。
       */
      if (totalBytes > MAX_KNOWLEDGE_FILE_SIZE) {
        stream.destroy();
        throw new Error('KNOWLEDGE_OBJECT_TOO_LARGE');
      }

      chunks.push(buffer);
    }
    return Buffer.concat(chunks, totalBytes);
  }
}
