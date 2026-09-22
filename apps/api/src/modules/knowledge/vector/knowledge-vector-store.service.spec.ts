import { createKnowledgeVectorId } from './knowledge-vector.schema.js';
import { Document } from '@langchain/core/documents';
import { KnowledgeVectorStoreService } from './knowledge-vector-store.service.js';
import type { KnowledgeVectorRecord } from './knowledge-vector.types.js';

/**
 * 单元测试不连接真实 Milvus。
 *
 * knowledge-vector.schema.ts 在模块加载时就会读取 DataType，
 * 因此 mock 必须同时提供 DataType 和 ConsistencyLevelEnum。
 */
vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: class MilvusClient {},
  ConsistencyLevelEnum: { Strong: 'Strong' },
  DataType: { VarChar: 21, Int64: 5, FloatVector: 101 },
}));

const indexVersion = 'v2-version';
const embedding = Array(1024).fill(0.1);
const success = { status: { error_code: 'Success' } };
const transientFailure = {
  status: { error_code: 'UnexpectedError', reason: 'server is initializing' },
};

function makeStore(client: Record<string, unknown>) {
  process.env.MILVUS_HOST = '127.0.0.1';
  process.env.MILVUS_PORT = '19530';
  const embeddingService = {
    embedDocuments: vi.fn().mockResolvedValue([embedding]),
    getModelName: vi.fn().mockReturnValue('qwen3.7-text-embedding'),
  };
  const store = new KnowledgeVectorStoreService(embeddingService as never);
  Reflect.set(store, 'client', client);
  return store;
}

describe('KnowledgeVectorStoreService', () => {
  it('rejects a generic Document without knowledge isolation metadata', async () => {
    const document = new Document({ pageContent: 'Hello world' });

    await expect(
      makeStore({ upsert: vi.fn() }).addDocuments([document as never]),
    ).rejects.toThrow('Knowledge document metadata is invalid');
  });

  it('embeds LangChain documents and maps metadata to Milvus rows', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ ...success, err_index: [], upsert_cnt: 1 });
    const document = new Document({
      id: 'chunk',
      pageContent: 'Hello world',
      metadata: {
        chunkId: 'chunk',
        tenantId: 'tenant-id',
        knowledgeBaseId: 'knowledge-base-id',
        documentId: 'document-id',
        chunkIndex: 0,
        indexVersion,
        publishStatus: 'DRAFT' as const,
      },
    });

    const indexed = await makeStore({ upsert }).addDocuments([document]);

    expect(indexed).toBe(1);
    expect(upsert.mock.calls[0][0].data[0]).toMatchObject({
      id: createKnowledgeVectorId(indexVersion, 'chunk'),
      chunk_id: 'chunk',
      tenant_id: 'tenant-id',
      knowledge_base_id: 'knowledge-base-id',
      document_id: 'document-id',
      chunk_index: 0,
      embedding,
      embedding_model: 'qwen3.7-text-embedding',
      publish_status: 'DRAFT',
    });
    expect(upsert.mock.calls[0][0].data[0].text_sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('retries a server-side search failure reported through status', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce(transientFailure)
      .mockResolvedValueOnce({
        ...success,
        results: [
          {
            chunk_id: 'chunk',
            document_id: 'document',
            chunk_index: 0,
            text_sha256: 'hash',
            index_version: indexVersion,
            score: 0.9,
          },
        ],
      });

    const hits = await makeStore({ search }).searchPublishedVectors(
      'tenant-id',
      'knowledge-base-id',
      embedding,
    );

    expect(search).toHaveBeenCalledTimes(2);
    expect(hits).toEqual([
      expect.objectContaining({ chunkId: 'chunk', indexVersion, score: 0.9 }),
    ]);
  });

  it('reports infrastructure failure instead of an empty answer once retries run out', async () => {
    const search = vi.fn().mockResolvedValue(transientFailure);

    await expect(
      makeStore({ search }).searchPublishedVectors(
        'tenant-id',
        'knowledge-base-id',
        embedding,
      ),
    ).rejects.toThrow('Milvus published search failed');
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('retries draft vector writes without creating a second primary key', async () => {
    const record: KnowledgeVectorRecord = {
      id: createKnowledgeVectorId(indexVersion, 'chunk'),
      chunkId: 'chunk',
      tenantId: 'tenant-id',
      knowledgeBaseId: 'knowledge-base-id',
      documentId: 'document-id',
      chunkIndex: 0,
      embedding,
      embeddingModel: 'embedding-model',
      textSha256: 'hash',
      indexVersion,
      publishStatus: 'DRAFT',
    };
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({
        ...transientFailure,
        err_index: [],
        upsert_cnt: 0,
      })
      .mockResolvedValueOnce({ ...success, err_index: [], upsert_cnt: 1 });

    const indexed = await makeStore({ upsert }).upsertDraftVectors([record]);

    expect(indexed).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(2);
    // 重试必须复用稳定主键，否则会在 Milvus 中留下重复向量。
    expect(upsert.mock.calls[1][0].data[0].id).toBe(
      upsert.mock.calls[0][0].data[0].id,
    );
  });

  it('scopes obsolete vector deletion to other versions of the same document', async () => {
    const remove = vi.fn().mockResolvedValue(success);

    await makeStore({ delete: remove }).deleteObsoleteDocumentVectors(
      'tenant-id',
      'knowledge-base-id',
      'document-id',
      indexVersion,
    );

    expect(remove.mock.calls[0][0].filter).toBe(
      'tenant_id == "tenant-id" && knowledge_base_id == "knowledge-base-id" && document_id == "document-id" && index_version != "v2-version"',
    );
  });

  it('republishes vectors that a crashed attempt already marked as published', async () => {
    const publishedRow = {
      id: createKnowledgeVectorId(indexVersion, 'chunk'),
      chunk_id: 'chunk',
      knowledge_base_id: 'knowledge-base-id',
      tenant_id: 'tenant-id',
      document_id: 'document-id',
      chunk_index: 0,
      embedding,
      embedding_model: 'embedding-model',
      text_sha256: 'hash',
      index_version: indexVersion,
      publish_status: 'PUBLISHED',
    };
    const query = vi
      .fn()
      .mockResolvedValue({ ...success, data: [publishedRow] });
    const upsert = vi
      .fn()
      .mockResolvedValue({ ...success, err_index: [], upsert_cnt: 1 });

    const published = await makeStore({ query, upsert }).publishDraftVectors(
      'tenant-id',
      'knowledge-base-id',
      'document-id',
      indexVersion,
    );

    expect(published).toBe(1);
    // 按 publish_status 过滤会让崩溃后的重试查不到记录，文档将永远无法发布。
    expect(query.mock.calls[0][0].filter).not.toContain('publish_status');
    expect(upsert.mock.calls[0][0].data[0]).toMatchObject({
      id: publishedRow.id,
      publish_status: 'PUBLISHED',
    });
  });

  it('does not report success when the version has no vectors at all', async () => {
    const query = vi.fn().mockResolvedValue({ ...success, data: [] });
    const upsert = vi.fn();

    await expect(
      makeStore({ query, upsert }).publishDraftVectors(
        'tenant-id',
        'knowledge-base-id',
        'document-id',
        indexVersion,
      ),
    ).rejects.toThrow('No vectors were found for the document version');
    expect(upsert).not.toHaveBeenCalled();
  });
});
