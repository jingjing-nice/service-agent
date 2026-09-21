import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { KnowledgeEmbeddingService } from '../knowledge-embedding.service.js';
import { createKnowledgeIndexVersion } from '../indexing/knowledge-index.utils.js';
import { getKnowledgeRetrievalConfig } from './knowledge-retrieval.config.js';
import { mapVerifiedKnowledgeHits } from './knowledge-retrieval.mapper.js';
import { KnowledgeVectorStoreService } from '../vector/knowledge-vector-store.service.js';

/** Online read path: embed a question, retrieve candidates, then verify PostgreSQL facts. */
@Injectable()
export class KnowledgeRetrievalService {
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
    const normalizedQuestion = this.validateQuestion(question);
    const knowledgeBase = await this.findKnowledgeBase(
      tenantId,
      knowledgeBaseId,
    );
    const [questionVector] = await this.embeddingService.embedTexts([
      normalizedQuestion,
    ]);
    const hits = await this.vectorStore.searchDraftVectors(
      tenantId,
      knowledgeBase.id,
      questionVector,
    );
    if (hits.length === 0) return [];

    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        id: { in: hits.map((hit) => hit.chunkId) },
        tenantId,
        document: {
          is: { tenantId, knowledgeBaseId: knowledgeBase.id, status: 'READY' },
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
    return mapVerifiedKnowledgeHits(hits, chunks, (chunk) =>
      createKnowledgeIndexVersion(chunk.documentId),
    );
  }

  async retrievePublishedKnowledge(
    tenantId: string,
    knowledgeBaseId: string,
    question: string,
  ) {
    const normalizedTenantId = tenantId.trim();
    const normalizedKnowledgeBaseId = knowledgeBaseId.trim();
    if (!normalizedTenantId)
      throw new BadRequestException('Tenant ID is required');
    if (!normalizedKnowledgeBaseId) {
      throw new BadRequestException('Knowledge base ID is required');
    }

    const normalizedQuestion = this.validateQuestion(question);
    const knowledgeBase = await this.findKnowledgeBase(
      normalizedTenantId,
      normalizedKnowledgeBaseId,
    );
    const [questionVector] = await this.embeddingService.embedTexts([
      normalizedQuestion,
    ]);
    const candidateHits = await this.vectorStore.searchPublishedVectors(
      normalizedTenantId,
      knowledgeBase.id,
      questionVector,
    );
    const { minScore } = getKnowledgeRetrievalConfig();
    const hits = candidateHits.filter(
      (hit) => Number.isFinite(hit.score) && hit.score >= minScore,
    );
    if (hits.length === 0) return [];

    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        id: { in: hits.map((hit) => hit.chunkId) },
        tenantId: normalizedTenantId,
        document: {
          is: {
            tenantId: normalizedTenantId,
            knowledgeBaseId: knowledgeBase.id,
            status: 'READY',
            publishStatus: 'PUBLISHED',
          },
        },
      },
      select: {
        id: true,
        documentId: true,
        chunkIndex: true,
        content: true,
        document: { select: { fileName: true, indexVersion: true } },
      },
    });
    return mapVerifiedKnowledgeHits(
      hits,
      chunks,
      (chunk) => chunk.document.indexVersion ?? null,
    );
  }

  private validateQuestion(question: string): string {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || normalizedQuestion.length > 4000) {
      throw new BadRequestException('Question must be 1–4000 characters');
    }
    return normalizedQuestion;
  }

  private async findKnowledgeBase(tenantId: string, knowledgeBaseId: string) {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, tenantId },
      select: { id: true },
    });
    if (!knowledgeBase)
      throw new NotFoundException('Knowledge base was not found');
    return knowledgeBase;
  }
}
