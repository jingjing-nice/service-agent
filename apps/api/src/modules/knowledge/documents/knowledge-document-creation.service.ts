import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  Prisma,
  type KnowledgeDocument,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { mapCreatedKnowledgeDocument } from './knowledge-document.mapper.js';
import type { ValidatedKnowledgeFile } from '../knowledge-file.validator.js';
import { KnowledgeObjectStorageService } from '../knowledge-object-storage.service.js';
import { KnowledgeProcessingQueueService } from '../jobs/knowledge-processing-queue.service.js';

@Injectable()
export class KnowledgeDocumentCreationService {
  private readonly logger = new Logger(KnowledgeDocumentCreationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: KnowledgeObjectStorageService,
    private readonly processingQueue: KnowledgeProcessingQueueService,
  ) {}

  async createDocument(tenantId: string, file: ValidatedKnowledgeFile) {
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) throw new Error('tenantId must not be empty');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existingDocument = await this.prisma.knowledgeDocument.findUnique({
      where: { tenantId_sha256: { tenantId: normalizedTenantId, sha256 } },
    });
    if (existingDocument) this.throwDuplicateDocument(existingDocument.id);

    const knowledgeBaseId = process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim();
    if (!knowledgeBaseId)
      throw new Error('DEFAULT_KNOWLEDGE_BASE_ID is required');

    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, tenantId: normalizedTenantId },
      select: { id: true },
    });
    if (!knowledgeBase) {
      throw new Error('Default knowledge base was not found for this tenant');
    }

    const documentId = randomUUID();
    const storedObject = await this.objectStorage.uploadDocument(
      normalizedTenantId,
      documentId,
      file,
    );
    let document: KnowledgeDocument;

    try {
      document = await this.prisma.knowledgeDocument.create({
        data: {
          id: documentId,
          tenantId: normalizedTenantId,
          fileName: file.fileName,
          objectKey: storedObject.objectName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          sha256,
          status: 'UPLOADED',
          knowledgeBaseId: knowledgeBase.id,
        },
      });
    } catch (error) {
      await this.deleteOrphanObject(storedObject.objectName);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.knowledgeDocument.findUnique({
          where: { tenantId_sha256: { tenantId: normalizedTenantId, sha256 } },
          select: { id: true },
        });
        this.throwDuplicateDocument(duplicate?.id);
      }
      throw error;
    }

    try {
      await this.processingQueue.enqueue(normalizedTenantId, document.id);
    } catch (error) {
      this.logProcessingError('enqueue', document.id, error);
      await this.prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { status: 'FAILED', errorCode: 'KNOWLEDGE_QUEUE_FAILED' },
      });
    }
    document = await this.prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    return mapCreatedKnowledgeDocument(document);
  }

  private async deleteOrphanObject(objectName: string) {
    try {
      await this.objectStorage.deleteDocument(objectName);
    } catch (error) {
      this.logger.error(
        `Failed to delete orphan knowledge object: ${objectName}`,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  }

  private throwDuplicateDocument(documentId?: string): never {
    throw new ConflictException({
      code: 'KNOWLEDGE_DOCUMENT_ALREADY_EXISTS',
      message: 'The same document content already exists',
      documentId,
    });
  }

  private logProcessingError(
    operation: 'enqueue',
    documentId: string,
    error: unknown,
  ) {
    this.logger.error(
      `Failed to ${operation} knowledge document ${documentId}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
