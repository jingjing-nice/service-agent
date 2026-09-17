import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { ValidatedKnowledgeFile } from './knowledge-file.validator.js';
import { KnowledgeObjectStorageService } from './knowledge-object-storage.service.js';
import { createHash, randomUUID } from 'crypto';
import {
  Prisma,
  type KnowledgeDocument,
} from '../../generated/prisma/client.js';
import { parseMarkdownDocument } from './knowledge-markdown-parser.js';
import { splitKnowledgeText } from './knowledge-text-chunker.js';

import { KnowledgeRagService } from './knowledge-rag.service.js';

/**
 * 知识文档服务。
 *
 * 负责文档上传、元数据查询与 Markdown 切片；索引和检索交给 RAG 服务。
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: KnowledgeObjectStorageService,
    private readonly ragService: KnowledgeRagService,
  ) {}

  /**
   * 创建一份知识文档。
   *
   * 执行流程：
   * 1. 标准化服务端租户 ID；
   * 2. 计算文件 SHA-256；
   * 3. 检查当前租户是否已经上传相同内容；
   * 4. 在应用层生成文档 UUID；
   * 5. 上传原文件到 MinIO；
   * 6. 保存 PostgreSQL 文档元数据；
   * 7. 数据库保存失败时删除 MinIO 对象；
   * 8. Markdown 上传成功后自动切片并保存；
   * 9. 切片成功后建立草稿向量索引，全部成功才标记为 READY。
   */
  async createDocument(tenantId: string, file: ValidatedKnowledgeFile) {
    const normalizedTenantId = tenantId.trim();

    /**
     * tenantId 后续应来自登录用户上下文。
     * 空值表示服务端调用错误。
     */
    if (normalizedTenantId.length === 0) {
      throw new Error('tenantId must not be empty');
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    /**
     * 数据库定义了 tenantId + sha256 联合唯一约束。
     *
     * 这里只检查当前租户，不影响不同租户分别上传
     * 内容相同的公共文档。
     */
    const existingDocument = await this.prisma.knowledgeDocument.findUnique({
      where: {
        tenantId_sha256: {
          tenantId: normalizedTenantId,
          sha256,
        },
      },
    });

    if (existingDocument) {
      throw new ConflictException({
        code: 'KNOWLEDGE_DOCUMENT_ALREADY_EXISTS',
        message: 'The same document content already exists',
        documentId: existingDocument.id,
      });
    }

    const knowledgeBaseId = process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim();
    if (!knowledgeBaseId) {
      throw new Error('DEFAULT_KNOWLEDGE_BASE_ID is required');
    }

    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, tenantId: normalizedTenantId },
      select: { id: true },
    });
    if (!knowledgeBase) {
      throw new Error('Default knowledge base was not found for this tenant');
    }

    // 确认知识库有效后，才生成 ID 并上传 MinIO。
    const documentId = randomUUID();

    const storedObject = await this.objectStorage.uploadDocument(
      normalizedTenantId,
      documentId,
      file,
    );
    // 每次上传使用独立变量，避免并发请求共享文档结果。
    let document: KnowledgeDocument;

    try {
      document = await this.prisma.knowledgeDocument.create({
        data: {
          id: documentId,
          tenantId: normalizedTenantId,
          fileName: file.fileName,
          objectKey: storedObject.objectName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          sha256,
          status: 'UPLOADED',
          knowledgeBaseId: knowledgeBase.id,
        },
      });
    } catch (error) {
      /**
       * MinIO 已成功，但数据库保存失败。
       *
       * 删除刚上传的对象，避免产生数据库无法追踪的
       * 孤立文件。
       */
      try {
        await this.objectStorage.deleteDocument(storedObject.objectName);
      } catch (cleanupError) {
        /**
         * 补偿删除失败不能覆盖最初的数据库异常。
         */
        const cleanupMessage =
          cleanupError instanceof Error
            ? (cleanupError.stack ?? cleanupError.message)
            : String(cleanupError);

        this.logger.error(
          `Failed to delete orphan knowledge object: ` +
            `${storedObject.objectName}`,
          cleanupMessage,
        );
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // 并发上传可能同时通过前面的重复检查；冲突后再查询一次，
        // 尽量返回已有文档 ID，供前端直接查看其切片。
        const duplicateDocument =
          await this.prisma.knowledgeDocument.findUnique({
            where: {
              tenantId_sha256: {
                tenantId: normalizedTenantId,
                sha256,
              },
            },
          });

        throw new ConflictException({
          code: 'KNOWLEDGE_DOCUMENT_ALREADY_EXISTS',
          message: 'The same document content already exists',
          documentId: duplicateDocument?.id,
        });
      }

      throw error;
    }

    let chunkCount: number | undefined;

    if (file.fileType === 'MARKDOWN') {
      try {
        // 元数据已保存；从这里开始的失败不能触发上面的 MinIO 补偿删除。
        document = await this.prisma.knowledgeDocument.update({
          where: { id: document.id },
          data: { status: 'PARSING', errorCode: null },
        });

        const saved = await this.saveMarkdownChunks(
          normalizedTenantId,
          document.id,
        );
        // saveMarkdownChunks 已拒绝空结果，并在事务内设置 CHUNKED。
        // 重新读取文档，确保上传响应返回提交后的状态和更新时间。
        document = await this.prisma.knowledgeDocument.findUniqueOrThrow({
          where: { id: document.id },
        });

        chunkCount = saved.chunkCount;
      } catch (error) {
        this.logger.error(
          `Failed to chunk knowledge document ${document.id}`,
          error instanceof Error ? error.stack : String(error),
        );

        // 保留原文件与元数据，后续可以按文档 ID 重试处理。
        document = await this.prisma.knowledgeDocument.update({
          where: { id: document.id },
          data: {
            status: 'FAILED',
            errorCode: 'KNOWLEDGE_CHUNKING_FAILED',
          },
        });
      }
    }

    // 切片已成功提交到 PostgreSQL，才开始生成 Embedding 并写入 Milvus。
    if (document.status === 'CHUNKED') {
      try {
        await this.indexDocumentDraft(normalizedTenantId, document.id);

        // indexDocumentDraft 已将全部写入成功的文档标记为 READY。
        // 重新读取，确保上传响应返回最新状态。
        document = await this.prisma.knowledgeDocument.findUniqueOrThrow({
          where: { id: document.id },
        });
      } catch (error) {
        this.logger.error(
          `Failed to index knowledge document ${document.id}`,
          error instanceof Error ? error.stack : String(error),
        );

        // 原文件和切片都保留；不能误报为“切片失败”。
        // 保持 CHUNKED，检索端不会使用未完成索引的文档。
        await this.prisma.knowledgeDocument.updateMany({
          where: {
            id: document.id,
            tenantId: normalizedTenantId,
            status: 'CHUNKED',
          },
          data: { errorCode: 'KNOWLEDGE_INDEXING_FAILED' },
        });
        document = await this.prisma.knowledgeDocument.findUniqueOrThrow({
          where: { id: document.id },
        });
      }
    }

    return {
      id: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      status: document.status,
      errorCode: document.errorCode,
      chunkCount,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  /**
   * 根据租户和文档 ID 查询文档。
   *
   * 为什么同时使用 tenantId 和 documentId：
   * 即使其他租户知道了文档 UUID，也不能读取该文档的信息。
   * 租户隔离必须在数据库查询条件中落实，不能只依赖前端隐藏。
   */
  async findDocumentById(tenantId: string, documentId: string) {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
      },
    });

    /**
     * 不区分“文档不存在”和“属于其他租户”。
     * 这样不会向调用者泄露其他租户的文档是否存在。
     */
    if (!document) {
      throw new NotFoundException({
        code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND',
        message: 'Knowledge document was not found',
      });
    }

    return {
      id: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      status: document.status,
      errorCode: document.errorCode,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  /**
   * 按租户读取并解析 Markdown 文档。
   *
   * objectKey 只取自数据库记录，不接受客户端直接指定，
   * 避免读取其他租户或任意 MinIO 对象。
   */
  async parseMarkdownDocumentById(tenantId: string, documentId: string) {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
      },
    });
    if (!document) {
      /**
       * 不区分文档不存在与属于其他租户。
       */
      throw new NotFoundException({
        code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND',
        message: 'Knowledge document was not found',
      });
    }

    /**
     * 目前仅有 Markdown 解析器；
     * PDF、DOCX 不能按文本直接解码。
     */
    if (!document.objectKey.toLowerCase().endsWith('.md')) {
      throw new UnsupportedMediaTypeException({
        code: 'KNOWLEDGE_DOCUMENT_PARSER_NOT_SUPPORTED',
        message: 'Only Markdown parsing is currently supported',
      });
    }

    const buffer = await this.objectStorage.downloadDocument(
      document.objectKey,
    );

    const parsed = parseMarkdownDocument(buffer);

    return {
      documentId: document.id,
      fileName: document.fileName,
      content: parsed.content,
      characterCount: parsed.characterCount,
    };
  }

  /**
   * 按租户读取已持久化的切片，用于前端预览。
   * 此处不重新解析原文件，也不将文档标记为 READY。
   */
  async previewMarkdownChunks(tenantId: string, documentId: string) {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, tenantId },
      select: {
        id: true,
        fileName: true,
        chunks: {
          where: { tenantId },
          orderBy: { chunkIndex: 'asc' },
          select: {
            chunkIndex: true,
            content: true,
            characterCount: true,
            headingPath: true,
          },
        },
      },
    });

    if (!document) {
      // 不暴露其他租户是否拥有这个文档。
      throw new NotFoundException('Knowledge document was not found');
    }

    return {
      documentId: document.id,
      fileName: document.fileName,
      chunkCount: document.chunks.length,
      chunks: document.chunks.map((chunk) => ({
        // 保持前端现有 ChunkPreview 数据格式不变。
        index: chunk.chunkIndex,
        content: chunk.content,
        characterCount: chunk.characterCount,
        headingPath: Array.isArray(chunk.headingPath)
          ? chunk.headingPath.filter(
              (heading: unknown): heading is string =>
                typeof heading === 'string',
            )
          : [],
      })),
    };
  }

  async listDocuments(tenantId: string) {
    const documents = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fileName: true,
        sizeBytes: true,
        status: true,
        errorCode: true, // 区分索引失败与单纯已切片
        knowledgeBaseId: true, // 仅用于计算是否允许重试
        createdAt: true,
      },
    });

    return documents.map(({ knowledgeBaseId, ...document }) => ({
      ...document,
      canRetryIndex: document.status === 'CHUNKED' && knowledgeBaseId !== null,
    }));
  }

  async saveMarkdownChunks(tenantId: string, documentId: string) {
    const parsed = await this.parseMarkdownDocumentById(tenantId, documentId);
    const chunks = await splitKnowledgeText(parsed.content);

    // 没有新切片时不要进入“删除旧切片”的事务。
    if (chunks.length === 0) {
      throw new Error('Markdown document produced no chunks');
    }

    return this.prisma.$transaction(async (tx) => {
      // 写入前再次确认文档仍存在且属于当前租户。
      const document = await tx.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId },
        select: { id: true },
      });

      if (!document) {
        throw new NotFoundException('Knowledge document was not found');
      }

      // 同一事务内替换旧切片；失败时不会只保存一部分。
      await tx.knowledgeChunk.deleteMany({ where: { documentId, tenantId } });

      await tx.knowledgeChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId,
          tenantId,
          chunkIndex: chunk.index,
          content: chunk.content,
          characterCount: chunk.characterCount,
          headingPath: chunk.headingPath,
        })),
      });

      // 切片与状态在同一事务提交，避免手动重新切片后状态仍停留在 PARSING。
      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'CHUNKED', errorCode: null },
      });

      return { documentId, chunkCount: chunks.length };
    });
  }

  /** 向后兼容现有控制器接口；RAG 逻辑由独立服务负责。 */
  retrieveDraftKnowledge(
    tenantId: string,
    knowledgeBaseId: string,
    question: string,
  ) {
    return this.ragService.retrieveDraftKnowledge(
      tenantId,
      knowledgeBaseId,
      question,
    );
  }

  indexDocumentDraft(tenantId: string, documentId: string) {
    return this.ragService.indexDocumentDraft(tenantId, documentId);
  }
}
