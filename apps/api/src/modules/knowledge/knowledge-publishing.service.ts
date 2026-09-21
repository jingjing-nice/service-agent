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
        publishStatus: 'DRAFT',
        knowledgeBaseId: { not: null },
        indexVersion: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        knowledgeBaseId: true,
        indexVersion: true,
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
    };
  }
}
