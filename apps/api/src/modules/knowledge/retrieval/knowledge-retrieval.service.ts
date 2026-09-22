import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { KnowledgeEmbeddingService } from '../knowledge-embedding.service.js';
import { getKnowledgeRetrievalConfig } from './knowledge-retrieval.config.js';
import { mapVerifiedKnowledgeHits } from './knowledge-retrieval.mapper.js';
import { KnowledgeVectorStoreService } from '../vector/knowledge-vector-store.service.js';
import {
  lexicalScore,
  rerankHybridKnowledge,
} from './knowledge-hybrid-ranker.js';

/**
 * RAG 在线检索入口。
 *
 * Milvus 负责快速召回候选，但不是真实正文的数据源。所有向量命中都要
 * 回到 PostgreSQL 校验租户、知识库、发布状态、索引版本和正文哈希，
 * 通过校验的正文才允许进入模型上下文。
 */
@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: KnowledgeEmbeddingService,
    private readonly vectorStore: KnowledgeVectorStoreService,
  ) { }

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
    const questionVector =
      await this.embeddingService.embedQuery(normalizedQuestion);
    const hits = await this.vectorStore.searchDraftVectors(
      tenantId,
      knowledgeBase.id,
      questionVector,
    );
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
        document: { select: { fileName: true, indexVersion: true } },
      },
    });
    return mapVerifiedKnowledgeHits(
      hits,
      chunks,
      (chunk) => chunk.document.indexVersion ?? null,
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

    const { minScore, vectorCandidateLimit, contextLimit } = getKnowledgeRetrievalConfig();

    const knowledgeBase = await this.findKnowledgeBase(
      normalizedTenantId,
      normalizedKnowledgeBaseId,
    );
    const questionVector =
      await this.embeddingService.embedQuery(normalizedQuestion);
    const candidateHits = await this.vectorStore.searchPublishedVectors(
      normalizedTenantId,
      knowledgeBase.id,
      questionVector,
      vectorCandidateLimit
    );

    const hits = candidateHits.filter(
      (hit) => Number.isFinite(hit.score) && hit.score >= minScore,
    );
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
    const vectorResults = mapVerifiedKnowledgeHits(
      hits,
      chunks,
      (chunk) => chunk.document.indexVersion ?? null,
    );

    /**
     * 关键词候选用于弥补产品型号、错误码等精确文本可能无法稳定通过
     * 向量阈值的问题。当前最多扫描 200 条，是有意设置的开发期上限；
     * 数据规模扩大后应替换为 PostgreSQL 全文索引或独立搜索引擎。
     */
    const lexicalRows = await this.prisma.knowledgeChunk.findMany({
      where: {
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
      take: 200,
      select: {
        id: true,
        documentId: true,
        chunkIndex: true,
        content: true,
        document: { select: { fileName: true, indexVersion: true } },
      },
    });
    const lexicalCandidates = lexicalRows
      .map((chunk) => ({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        title: chunk.document.fileName,
        content: chunk.content,
        score: lexicalScore(normalizedQuestion, chunk.content),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return rerankHybridKnowledge(
      normalizedQuestion,
      vectorResults,
      lexicalCandidates,
      contextLimit
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
