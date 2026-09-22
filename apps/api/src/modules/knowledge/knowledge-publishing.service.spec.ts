import { ConflictException } from '@nestjs/common';
import { KnowledgePublishingService } from './knowledge-publishing.service.js';

const draft = {
  id: 'document-id',
  tenantId: 'tenant-id',
  knowledgeBaseId: 'knowledge-base-id',
  indexVersion: 'v2-version',
  publishStatus: 'DRAFT',
  publishedAt: null,
  updatedAt: new Date('2026-01-01'),
  _count: { chunks: 2 },
} as const;

describe('KnowledgePublishingService', () => {
  it('publishes vectors and commits PostgreSQL on the first attempt', async () => {
    const prisma = {
      knowledgeDocument: {
        findFirst: vi.fn().mockResolvedValue(draft),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const vectors = { publishDraftVectors: vi.fn().mockResolvedValue(2) };
    const service = new KnowledgePublishingService(prisma as never, vectors as never);

    await expect(service.publishDocument('tenant-id', 'document-id')).resolves.toMatchObject({
      publishStatus: 'PUBLISHED',
      indexVersion: 'v2-version',
      chunkCount: 2,
      publishedVectorCount: 2,
      idempotent: false,
    });
    expect(vectors.publishDraftVectors).toHaveBeenCalledWith(
      'tenant-id', 'knowledge-base-id', 'document-id', 'v2-version',
    );
    expect(prisma.knowledgeDocument.updateMany).toHaveBeenCalledOnce();
  });

  it('recovers when another publisher commits PostgreSQL after vectors are published', async () => {
    const prisma = {
      knowledgeDocument: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(draft)
          .mockResolvedValueOnce({ publishedAt: new Date('2026-01-02') }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const vectors = { publishDraftVectors: vi.fn().mockResolvedValue(2) };
    const service = new KnowledgePublishingService(prisma as never, vectors as never);

    await expect(service.publishDocument('tenant-id', 'document-id')).resolves.toMatchObject({
      publishStatus: 'PUBLISHED',
      idempotent: true,
    });
    expect(vectors.publishDraftVectors).toHaveBeenCalledOnce();
  });

  it('returns an already published document without publishing vectors twice', async () => {
    const prisma = {
      knowledgeDocument: {
        findFirst: vi.fn().mockResolvedValue({
          ...draft,
          publishStatus: 'PUBLISHED',
          publishedAt: new Date('2026-01-02'),
        }),
      },
    };
    const vectors = { publishDraftVectors: vi.fn() };
    const service = new KnowledgePublishingService(prisma as never, vectors as never);

    await expect(service.publishDocument('tenant-id', 'document-id')).resolves.toMatchObject({
      idempotent: true,
    });
    expect(vectors.publishDraftVectors).not.toHaveBeenCalled();
  });

  it('does not report success when vector count is incomplete', async () => {
    const prisma = { knowledgeDocument: { findFirst: vi.fn().mockResolvedValue(draft) } };
    const vectors = { publishDraftVectors: vi.fn().mockResolvedValue(1) };
    const service = new KnowledgePublishingService(prisma as never, vectors as never);

    await expect(service.publishDocument('tenant-id', 'document-id')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
