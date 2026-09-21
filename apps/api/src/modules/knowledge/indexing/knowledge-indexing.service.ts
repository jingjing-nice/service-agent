import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { getKnowledgeEmbeddingConfig } from '../knowledge-embedding.config.js';
import { KnowledgeEmbeddingService } from '../knowledge-embedding.service.js';
import {
  createKnowledgeIndexVersion,
  hashKnowledgeText,
} from './knowledge-index.utils.js';
import { createKnowledgeVectorId } from '../vector/knowledge-vector.schema.js';
import { KnowledgeVectorStoreService } from '../vector/knowledge-vector-store.service.js';
import type { KnowledgeVectorRecord } from '../vector/knowledge-vector.types.js';

/** Offline write path that turns persisted chunks into a complete draft vector index. */
@Injectable()
export class KnowledgeIndexingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: KnowledgeEmbeddingService,
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
    const embeddingModel = getKnowledgeEmbeddingConfig().model;
    let indexedCount = 0;

    for (let offset = 0; offset < document.chunks.length; offset += 20) {
      const batch = document.chunks.slice(offset, offset + 20);
      const embeddings = await this.embeddingService.embedTexts(
        batch.map((chunk) => chunk.content),
      );
      const records: KnowledgeVectorRecord[] = batch.map((chunk, index) => ({
        id: createKnowledgeVectorId(indexVersion, chunk.id),
        chunkId: chunk.id,
        tenantId: document.tenantId,
        knowledgeBaseId,
        documentId: document.id,
        chunkIndex: chunk.chunkIndex,
        embedding: embeddings[index],
        embeddingModel,
        textSha256: hashKnowledgeText(chunk.content),
        indexVersion,
        publishStatus: 'DRAFT',
      }));
      indexedCount += await this.vectorStore.upsertDraftVectors(records);
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
