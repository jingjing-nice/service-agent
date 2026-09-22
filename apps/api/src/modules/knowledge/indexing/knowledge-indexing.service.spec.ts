import { KnowledgeIndexingService } from './knowledge-indexing.service.js';

describe('KnowledgeIndexingService', () => {
  it('creates a new version and removes obsolete vectors after the database switch', async () => {
    const document = {
      id: 'document-id',
      tenantId: 'tenant-id',
      knowledgeBaseId: 'knowledge-base-id',
      updatedAt: new Date('2026-01-01'),
      chunks: [{ id: 'chunk-1', chunkIndex: 0, content: 'current content' }],
    };
    const prisma = {
      knowledgeDocument: {
        findFirst: vi.fn().mockResolvedValue(document),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const vectors = {
      addDocuments: vi.fn().mockResolvedValue(1),
      deleteObsoleteDocumentVectors: vi.fn().mockResolvedValue(undefined),
    };
    const oldModel = process.env.EMBEDDING_MODEL;
    const oldKey = process.env.EMBEDDING_API_KEY;
    const oldBase = process.env.EMBEDDING_BASE_URL;
    const oldDimension = process.env.EMBEDDING_DIMENSION;
    Object.assign(process.env, {
      EMBEDDING_MODEL: 'qwen3.7-text-embedding',
      EMBEDDING_API_KEY: 'test',
      EMBEDDING_BASE_URL: 'https://example.test',
      EMBEDDING_DIMENSION: '1024',
    });
    try {
      const service = new KnowledgeIndexingService(
        prisma as never,
        vectors as never,
      );
      const result = await service.indexDocumentDraft(
        'tenant-id',
        'document-id',
      );
      expect(result.indexVersion).toMatch(/^v2-/);
      expect(vectors.addDocuments).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'chunk-1',
          pageContent: 'current content',
          metadata: expect.objectContaining({
            chunkId: 'chunk-1',
            tenantId: 'tenant-id',
            publishStatus: 'DRAFT',
          }),
        }),
      ]);
      expect(vectors.deleteObsoleteDocumentVectors).toHaveBeenCalledWith(
        'tenant-id',
        'knowledge-base-id',
        'document-id',
        result.indexVersion,
      );
    } finally {
      process.env.EMBEDDING_MODEL = oldModel;
      process.env.EMBEDDING_API_KEY = oldKey;
      process.env.EMBEDDING_BASE_URL = oldBase;
      process.env.EMBEDDING_DIMENSION = oldDimension;
    }
  });

  it('uses a different index version for every rebuild', async () => {
    const { createKnowledgeIndexVersion } =
      await import('./knowledge-index.utils.js');
    expect(createKnowledgeIndexVersion('same')).not.toBe(
      createKnowledgeIndexVersion('same'),
    );
  });

  it('keeps the new index active when obsolete-vector cleanup is temporarily unavailable', async () => {
    const prisma = {
      knowledgeDocument: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document-id',
          tenantId: 'tenant-id',
          knowledgeBaseId: 'knowledge-base-id',
          updatedAt: new Date('2026-01-01'),
          chunks: [{ id: 'chunk-1', chunkIndex: 0, content: 'new content' }],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const vectors = {
      addDocuments: vi.fn().mockResolvedValue(1),
      deleteObsoleteDocumentVectors: vi
        .fn()
        .mockRejectedValue(new Error('Milvus unavailable')),
    };
    Object.assign(process.env, {
      EMBEDDING_MODEL: 'qwen3.7-text-embedding',
      EMBEDDING_API_KEY: 'test',
      EMBEDDING_BASE_URL: 'https://example.test',
      EMBEDDING_DIMENSION: '1024',
    });
    const service = new KnowledgeIndexingService(
      prisma as never,
      vectors as never,
    );
    await expect(
      service.indexDocumentDraft('tenant-id', 'document-id'),
    ).resolves.toMatchObject({
      publishStatus: 'DRAFT',
      indexedCount: 1,
    });
  });
});
