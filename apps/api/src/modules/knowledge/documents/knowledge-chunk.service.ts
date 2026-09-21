import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { normalizeHeadingPath } from './knowledge-document.mapper.js';
import { parseMarkdownDocument } from '../knowledge-markdown-parser.js';
import { KnowledgeObjectStorageService } from '../knowledge-object-storage.service.js';
import { splitKnowledgeText } from '../knowledge-text-chunker.js';

@Injectable()
export class KnowledgeChunkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: KnowledgeObjectStorageService,
  ) {}

  async parseMarkdownDocumentById(tenantId: string, documentId: string) {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!document) {
      throw new NotFoundException({
        code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND',
        message: 'Knowledge document was not found',
      });
    }
    if (!document.objectKey.toLowerCase().endsWith('.md')) {
      throw new UnsupportedMediaTypeException({
        code: 'KNOWLEDGE_DOCUMENT_PARSER_NOT_SUPPORTED',
        message: 'Only Markdown parsing is currently supported',
      });
    }

    const parsed = parseMarkdownDocument(
      await this.objectStorage.downloadDocument(document.objectKey),
    );
    return {
      documentId: document.id,
      fileName: document.fileName,
      content: parsed.content,
      characterCount: parsed.characterCount,
    };
  }

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
    if (!document)
      throw new NotFoundException('Knowledge document was not found');

    return {
      documentId: document.id,
      fileName: document.fileName,
      chunkCount: document.chunks.length,
      chunks: document.chunks.map((chunk) => ({
        index: chunk.chunkIndex,
        content: chunk.content,
        characterCount: chunk.characterCount,
        headingPath: normalizeHeadingPath(chunk.headingPath),
      })),
    };
  }

  async findCitationChunk(
    tenantId: string,
    documentId: string,
    chunkId: string,
  ) {
    const normalizedTenantId = tenantId.trim();
    const normalizedDocumentId = documentId.trim();
    const normalizedChunkId = chunkId.trim();
    if (!normalizedTenantId)
      throw new BadRequestException('Tenant ID is required');
    if (!normalizedDocumentId || !normalizedChunkId) {
      throw new BadRequestException('Document ID and chunk ID are required');
    }

    const chunk = await this.prisma.knowledgeChunk.findFirst({
      where: {
        id: normalizedChunkId,
        documentId: normalizedDocumentId,
        tenantId: normalizedTenantId,
        document: {
          is: { id: normalizedDocumentId, tenantId: normalizedTenantId },
        },
      },
      select: {
        id: true,
        documentId: true,
        chunkIndex: true,
        content: true,
        characterCount: true,
        headingPath: true,
        document: { select: { fileName: true } },
      },
    });
    if (!chunk) {
      throw new NotFoundException({
        code: 'KNOWLEDGE_CITATION_NOT_FOUND',
        message: 'Knowledge citation was not found',
      });
    }

    return {
      documentId: chunk.documentId,
      chunkId: chunk.id,
      fileName: chunk.document.fileName,
      index: chunk.chunkIndex,
      content: chunk.content,
      characterCount: chunk.characterCount,
      headingPath: normalizeHeadingPath(chunk.headingPath),
    };
  }

  async saveMarkdownChunks(tenantId: string, documentId: string) {
    const parsed = await this.parseMarkdownDocumentById(tenantId, documentId);
    const chunks = await splitKnowledgeText(parsed.content);
    if (chunks.length === 0)
      throw new Error('Markdown document produced no chunks');

    return this.prisma.$transaction(async (tx) => {
      const document = await tx.knowledgeDocument.findFirst({
        where: { id: documentId, tenantId },
        select: { id: true },
      });
      if (!document)
        throw new NotFoundException('Knowledge document was not found');

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
      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'CHUNKED', errorCode: null },
      });
      return { documentId, chunkCount: chunks.length };
    });
  }
}
