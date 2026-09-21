import { Injectable } from '@nestjs/common';
import { KnowledgeIndexingService } from './indexing/knowledge-indexing.service.js';
import { KnowledgePublishingService } from './knowledge-publishing.service.js';
import { KnowledgeRetrievalService } from './retrieval/knowledge-retrieval.service.js';

/** Compatibility facade retained while controllers migrate to focused services. */
@Injectable()
export class KnowledgeRagService {
  constructor(
    private readonly retrievalService: KnowledgeRetrievalService,
    private readonly indexingService: KnowledgeIndexingService,
    private readonly publishingService: KnowledgePublishingService,
  ) {}

  retrieveDraftKnowledge(
    tenantId: string,
    knowledgeBaseId: string,
    question: string,
  ) {
    return this.retrievalService.retrieveDraftKnowledge(
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
    return this.retrievalService.retrievePublishedKnowledge(
      tenantId,
      knowledgeBaseId,
      question,
    );
  }

  indexDocumentDraft(tenantId: string, documentId: string) {
    return this.indexingService.indexDocumentDraft(tenantId, documentId);
  }

  publishDocument(tenantId: string, documentId: string) {
    return this.publishingService.publishDocument(tenantId, documentId);
  }
}
