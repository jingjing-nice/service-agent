import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { getKnowledgeEmbeddingConfig } from './knowledge-embedding.config.js';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service.js';
import { createKnowledgeVectorId } from './knowledge-vector.schema.js';
import { KnowledgeVectorStoreService } from './knowledge-vector-store.service.js';
import type { KnowledgeVectorRecord } from './knowledge-vector.types.js';

/** 草稿索引的版本不随文档状态变更；切片 ID 和正文哈希校验旧数据。 */
function indexVersionFor(documentId: string): string {
  return `v1-${documentId}`;
}

function textSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** 只处理真实切片的向量化、Milvus 检索和 PostgreSQL 正文回查。 */
@Injectable()
export class KnowledgeRagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: KnowledgeEmbeddingService,
    private readonly vectorStore: KnowledgeVectorStoreService,
  ) {}

  async retrieveDraftKnowledge(
    tenantId: string,
    knowledgeBaseId: string,
    question: string,
  ) {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || normalizedQuestion.length > 4000) {
      throw new BadRequestException('Question must be 1–4000 characters');
    }

    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, tenantId },
      select: { id: true },
    });
    if (!knowledgeBase) {
      throw new NotFoundException('Knowledge base was not found');
    }

    const [questionVector] = await this.embeddingService.embedTexts([
      normalizedQuestion,
    ]);
    const hits = await this.vectorStore.searchDraftVectors(
      tenantId,
      knowledgeBase.id,
      questionVector,
    );
    if (hits.length === 0) return [];

    // Milvus 只负责检索；正文以 PostgreSQL 为准，且只返回已就绪文档。
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        id: { in: hits.map((hit) => hit.chunkId) },
        tenantId,
        document: {
          is: {
            tenantId,
            knowledgeBaseId: knowledgeBase.id,
            status: 'READY',
          },
        },
      },
      select: {
        id: true,
        documentId: true,
        chunkIndex: true,
        content: true,
        document: { select: { fileName: true } },
      },
    });
    const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    return hits.flatMap((hit) => {
      const chunk = chunksById.get(hit.chunkId);
      if (
        !chunk ||
        hit.documentId !== chunk.documentId ||
        hit.chunkIndex !== chunk.chunkIndex ||
        hit.indexVersion !== indexVersionFor(chunk.documentId) ||
        hit.textSha256 !== textSha256(chunk.content)
      ) {
        return [];
      }

      return [
        {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          title: chunk.document.fileName,
          content: chunk.content,
          score: hit.score,
        },
      ];
    });
  }

  /** 从 PostgreSQL 的真实切片建草稿索引；全部写入后才开放检索。 */
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
    const indexVersion = indexVersionFor(document.id);
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
        textSha256: textSha256(chunk.content),
        indexVersion,
        publishStatus: 'DRAFT',
      }));
      indexedCount += await this.vectorStore.upsertDraftVectors(records);
    }

    if (indexedCount !== document.chunks.length) {
      throw new Error('Not all knowledge chunks were indexed');
    }

    // 如果向量化期间文档被重新切片，则旧结果不能把新文档标记为 READY。
    const updated = await this.prisma.knowledgeDocument.updateMany({
      where: {
        id: document.id,
        tenantId,
        status: 'CHUNKED',
        updatedAt: document.updatedAt,
      },
      data: { status: 'READY', errorCode: null },
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
