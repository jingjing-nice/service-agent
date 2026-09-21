import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  getKnowledgeDocumentActions,
  mapKnowledgeDocumentDetail,
} from './knowledge-document.mapper.js';

@Injectable()
export class KnowledgeDocumentQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findDocumentById(tenantId: string, documentId: string) {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!document) {
      throw new NotFoundException({
        code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND',
        message: 'Knowledge document was not found',
      });
    }

    return mapKnowledgeDocumentDetail(document);
  }

  async listDocuments(tenantId: string) {
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) throw new Error('tenantId must not be empty');

    const documents = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId: normalizedTenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fileName: true,
        sizeBytes: true,
        status: true,
        publishStatus: true,
        indexVersion: true,
        publishedAt: true,
        errorCode: true,
        knowledgeBaseId: true,
        createdAt: true,
      },
    });

    return documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      sizeBytes: document.sizeBytes,
      status: document.status,
      publishStatus: document.publishStatus,
      indexVersion: document.indexVersion,
      publishedAt: document.publishedAt?.toISOString() ?? undefined,
      errorCode: document.errorCode,
      ...getKnowledgeDocumentActions(document),
      createdAt: document.createdAt.toISOString(),
    }));
  }
}
