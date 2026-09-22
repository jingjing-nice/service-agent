import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { KnowledgeVectorStoreService } from './vector/knowledge-vector-store.service.js';

/** Coordinates the explicit transition from a verified draft to published knowledge. */
@Injectable()
export class KnowledgePublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vectorStore: KnowledgeVectorStoreService,
  ) {}

  async publishDocument(tenantId: string, documentId: string) {
    const normalizedTenantId = tenantId.trim();
    const normalizedDocumentId = documentId.trim();
    if (!normalizedTenantId)
      throw new BadRequestException('Tenant ID is required');
    if (!normalizedDocumentId)
      throw new BadRequestException('Document ID is required');

    const document = await this.prisma.knowledgeDocument.findFirst({
      where: {
        id: normalizedDocumentId,
        tenantId: normalizedTenantId,
        status: 'READY',
        publishStatus: { in: ['DRAFT', 'PUBLISHED'] },
        knowledgeBaseId: { not: null },
        indexVersion: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        knowledgeBaseId: true,
        indexVersion: true,
        publishStatus: true,
        publishedAt: true,
        updatedAt: true,
        _count: { select: { chunks: true } },
      },
    });
    if (!document?.knowledgeBaseId || !document.indexVersion) {
      throw new NotFoundException('Publishable draft document was not found');
    }
    if (document._count.chunks === 0) {
      throw new ConflictException('Document has no knowledge chunks');
    }

    /**
     * 已经发布过的文档直接返回，不重复写向量。
     *
     * 重复提交发布请求（例如前端重试或用户重复点击）
     * 不应该报错，也不应该重新跑一次 Embedding 和 Milvus upsert。
     * 发布状态以 PostgreSQL 为事实源，indexVersion 已在查询条件中锁定，
     * 因此这里返回的版本就是当前生效的版本。
     */
    if (document.publishStatus === 'PUBLISHED') {
      return {
        documentId: document.id,
        knowledgeBaseId: document.knowledgeBaseId,
        indexVersion: document.indexVersion,
        publishStatus: 'PUBLISHED' as const,
        publishedAt: document.publishedAt?.toISOString(),
        chunkCount: document._count.chunks,
        publishedVectorCount: document._count.chunks,
        idempotent: true,
      };
    }

    const publishedVectorCount = await this.vectorStore.publishDraftVectors(
      document.tenantId,
      document.knowledgeBaseId,
      document.id,
      document.indexVersion,
    );
    if (publishedVectorCount !== document._count.chunks) {
      throw new ConflictException(
        'Published vector count does not match chunk count',
      );
    }

    const publishedAt = new Date();
    const updated = await this.prisma.knowledgeDocument.updateMany({
      where: {
        id: document.id,
        tenantId: document.tenantId,
        status: 'READY',
        publishStatus: 'DRAFT',
        indexVersion: document.indexVersion,
        updatedAt: document.updatedAt,
      },
      data: { publishStatus: 'PUBLISHED', publishedAt, errorCode: null },
    });
    if (updated.count !== 1) {
      const concurrentResult = await this.prisma.knowledgeDocument.findFirst({
        where: {
          id: document.id,
          tenantId: document.tenantId,
          status: 'READY',
          publishStatus: 'PUBLISHED',
          indexVersion: document.indexVersion,
        },
        select: { publishedAt: true },
      });
      if (concurrentResult) {
        return {
          documentId: document.id,
          knowledgeBaseId: document.knowledgeBaseId,
          indexVersion: document.indexVersion,
          publishStatus: 'PUBLISHED' as const,
          publishedAt: concurrentResult.publishedAt?.toISOString(),
          chunkCount: document._count.chunks,
          publishedVectorCount,
          idempotent: true,
        };
      }
      throw new ConflictException(
        'Document changed during publishing; please retry',
      );
    }

    return {
      documentId: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      indexVersion: document.indexVersion,
      publishStatus: 'PUBLISHED' as const,
      publishedAt: publishedAt.toISOString(),
      chunkCount: document._count.chunks,
      publishedVectorCount,
      /** 本次调用真正执行了发布，而不是命中已发布结果。 */
      idempotent: false,
    };
  }
}
