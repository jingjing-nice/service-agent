import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { KnowledgeObjectStorageService } from './knowledge-object-storage.service.js';
import { KnowledgeVectorStoreService } from './vector/knowledge-vector-store.service.js';

@Injectable()
export class KnowledgeLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vectors: KnowledgeVectorStoreService,
    private readonly objects: KnowledgeObjectStorageService,
  ) {}

  async unpublish(tenantId: string, documentId: string) {
    const updated = await this.prisma.knowledgeDocument.updateMany({
      where: { id: documentId, tenantId, publishStatus: 'PUBLISHED' },
      data: { publishStatus: 'DRAFT', publishedAt: null },
    });
    if (updated.count !== 1) throw new NotFoundException('Published document was not found');
    return { documentId, publishStatus: 'DRAFT' as const };
  }

  async archive(tenantId: string, documentId: string) {
    const updated = await this.prisma.knowledgeDocument.updateMany({
      where: { id: documentId, tenantId, publishStatus: { not: 'ARCHIVED' } },
      data: { publishStatus: 'ARCHIVED', publishedAt: null },
    });
    if (updated.count !== 1) throw new NotFoundException('Active document was not found');
    return { documentId, publishStatus: 'ARCHIVED' as const };
  }

  async delete(tenantId: string, documentId: string) {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true, objectKey: true, knowledgeBaseId: true },
    });
    if (!document) throw new NotFoundException('Knowledge document was not found');
    await this.prisma.knowledgeDocument.update({
      where: { id: document.id }, data: { publishStatus: 'ARCHIVED', publishedAt: null },
    });
    if (document.knowledgeBaseId) {
      await this.vectors.deleteDocumentVectors(tenantId, document.knowledgeBaseId, document.id);
    }
    await this.objects.deleteDocument(document.objectKey);
    await this.prisma.knowledgeDocument.delete({ where: { id: document.id } });
    return { documentId, deleted: true as const };
  }
}
