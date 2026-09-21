import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';
import { KnowledgeObjectStorageService } from './knowledge-object-storage.service.js';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service.js';
import { KnowledgeVectorStoreService } from './vector/knowledge-vector-store.service.js';
import { KnowledgeRagService } from './knowledge-rag.service.js';
import { KnowledgeIndexingService } from './indexing/knowledge-indexing.service.js';
import { KnowledgePublishingService } from './knowledge-publishing.service.js';
import { KnowledgeRetrievalService } from './retrieval/knowledge-retrieval.service.js';
import { KnowledgeChunkService } from './documents/knowledge-chunk.service.js';
import { KnowledgeDocumentCreationService } from './documents/knowledge-document-creation.service.js';
import { KnowledgeDocumentQueryService } from './documents/knowledge-document-query.service.js';

@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeChunkService,
    KnowledgeDocumentCreationService,
    KnowledgeDocumentQueryService,
    KnowledgeObjectStorageService,
    KnowledgeEmbeddingService,
    KnowledgeVectorStoreService,
    KnowledgeRetrievalService,
    KnowledgeIndexingService,
    KnowledgePublishingService,
    KnowledgeRagService,
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
