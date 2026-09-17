import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';
import { KnowledgeObjectStorageService } from './knowledge-object-storage.service.js';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service.js';
import { KnowledgeVectorStoreService } from './knowledge-vector-store.service.js';
import { KnowledgeRagService } from './knowledge-rag.service.js';

@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeObjectStorageService,
    KnowledgeEmbeddingService,
    KnowledgeVectorStoreService,
    KnowledgeRagService,
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
