import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { PrismaService } from '../../../database/prisma.service.js';
import { createKnowledgeIndexVersion } from './knowledge-index.utils.js';
import { KnowledgeVectorStoreService } from '../vector/knowledge-vector-store.service.js';
import type { KnowledgeVectorDocumentMetadata } from '../vector/knowledge-vector.types.js';

/** Offline write path that turns persisted chunks into a complete draft vector index. */
@Injectable()
export class KnowledgeIndexingService {
  private readonly logger = new Logger(KnowledgeIndexingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vectorStore: KnowledgeVectorStoreService,
  ) {}

  async indexDocumentDraft(tenantId: string, documentId: string) {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        status: 'CHUNKED',
        knowledgeBaseId: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        knowledgeBaseId: true,
        updatedAt: true,
        chunks: {
          where: { tenantId },
          orderBy: { chunkIndex: 'asc' },
          select: { id: true, chunkIndex: true, content: true },
        },
      },
    });
    if (!document?.knowledgeBaseId) {
      throw new NotFoundException('CHUNKED knowledge document was not found');
    }
    if (document.chunks.length === 0) {
      throw new ConflictException('Document has no saved chunks');
    }

    const knowledgeBaseId = document.knowledgeBaseId;
    const indexVersion = createKnowledgeIndexVersion(document.id);
    let indexedCount = 0;

    for (let offset = 0; offset < document.chunks.length; offset += 20) {
      const batch = document.chunks.slice(offset, offset + 20);
      const documents = batch.map(
        (chunk) =>
          new Document<KnowledgeVectorDocumentMetadata>({
            id: chunk.id,
            pageContent: chunk.content,
            metadata: {
              chunkId: chunk.id,
              tenantId: document.tenantId,
              knowledgeBaseId,
              documentId: document.id,
              chunkIndex: chunk.chunkIndex,
              indexVersion,
              publishStatus: 'DRAFT',
            },
          }),
      );
      indexedCount += await this.vectorStore.addDocuments(documents);
    }

    if (indexedCount !== document.chunks.length) {
      throw new Error('Not all knowledge chunks were indexed');
    }

    const updated = await this.prisma.knowledgeDocument.updateMany({
      where: {
        id: document.id,
        tenantId,
        status: 'CHUNKED',
        updatedAt: document.updatedAt,
      },
      data: {
        status: 'READY',
        publishStatus: 'DRAFT',
        indexVersion,
        publishedAt: null,
        errorCode: null,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        'Document changed during indexing; please retry indexing',
      );
    }

    /**
     * Clean up superseded versions only after PostgreSQL commits the new one.
     *
     * Retrieval verifies every hit against the committed indexVersion, so the
     * old vectors are already unreachable before they are deleted. Deleting
     * first would instead leave a window where no version can serve answers.
     */
    try {
      await this.vectorStore.deleteObsoleteDocumentVectors(
        tenantId,
        knowledgeBaseId,
        document.id,
        indexVersion,
      );
    } catch (error) {
      // The database already points at the verified new version. Old rows are
      // excluded by version checks, so cleanup failure must not roll it back.
      this.logger.warn(
        `New index ${indexVersion} is active but obsolete-vector cleanup failed`,
        error instanceof Error ? error.message : String(error),
      );
    }

    return {
      documentId: document.id,
      knowledgeBaseId,
      indexVersion,
      publishStatus: 'DRAFT' as const,
      chunkCount: document.chunks.length,
      indexedCount,
    };
  }
}
