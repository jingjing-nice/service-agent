import { Injectable } from '@nestjs/common';
import { KnowledgeChunkService } from './documents/knowledge-chunk.service.js';
import { KnowledgeDocumentCreationService } from './documents/knowledge-document-creation.service.js';
import { KnowledgeDocumentQueryService } from './documents/knowledge-document-query.service.js';
import type { ValidatedKnowledgeFile } from './knowledge-file.validator.js';
import { KnowledgeRagService } from './knowledge-rag.service.js';
import { KnowledgeLifecycleService } from './knowledge-lifecycle.service.js';
import { KnowledgeProcessingQueueService } from './jobs/knowledge-processing-queue.service.js';

/** Stable application facade for knowledge controllers and other modules. */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly creationService: KnowledgeDocumentCreationService,
    private readonly queryService: KnowledgeDocumentQueryService,
    private readonly chunkService: KnowledgeChunkService,
    private readonly ragService: KnowledgeRagService,
    private readonly lifecycleService: KnowledgeLifecycleService,
    private readonly processingQueue: KnowledgeProcessingQueueService,
  ) {}

  createDocument(tenantId: string, file: ValidatedKnowledgeFile) {
    return this.creationService.createDocument(tenantId, file);
  }

  findDocumentById(tenantId: string, documentId: string) {
    return this.queryService.findDocumentById(tenantId, documentId);
  }

  listDocuments(tenantId: string) {
    return this.queryService.listDocuments(tenantId);
  }

  parseMarkdownDocumentById(tenantId: string, documentId: string) {
    return this.chunkService.parseMarkdownDocumentById(tenantId, documentId);
  }

  previewMarkdownChunks(tenantId: string, documentId: string) {
    return this.chunkService.previewMarkdownChunks(tenantId, documentId);
  }

  findCitationChunk(tenantId: string, documentId: string, chunkId: string) {
    return this.chunkService.findCitationChunk(tenantId, documentId, chunkId);
  }

  saveMarkdownChunks(tenantId: string, documentId: string) {
    return this.chunkService.saveMarkdownChunks(tenantId, documentId);
  }

  retrieveDraftKnowledge(
    tenantId: string,
    knowledgeBaseId: string,
    question: string,
  ) {
    return this.ragService.retrieveDraftKnowledge(
      tenantId,
      knowledgeBaseId,
      question,
    );
  }

  retrievePublishedKnowledge(
    tenantId: string,
    knowledgeBaseId: string,
    question: string,
  ) {
    return this.ragService.retrievePublishedKnowledge(
      tenantId,
      knowledgeBaseId,
      question,
    );
  }

  indexDocumentDraft(tenantId: string, documentId: string) {
    return this.ragService.indexDocumentDraft(tenantId, documentId);
  }

  publishDocument(tenantId: string, documentId: string) {
    return this.ragService.publishDocument(tenantId, documentId);
  }

  unpublishDocument(tenantId: string, documentId: string) {
    return this.lifecycleService.unpublish(tenantId, documentId);
  }

  archiveDocument(tenantId: string, documentId: string) {
    return this.lifecycleService.archive(tenantId, documentId);
  }

  deleteDocument(tenantId: string, documentId: string) {
    return this.lifecycleService.delete(tenantId, documentId);
  }

  getProcessingStatus(documentId: string) {
    return this.processingQueue.getStatus(documentId);
  }
}
