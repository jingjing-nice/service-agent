import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { KNOWLEDGE_COLLECTION_NAME } from './knowledge-vector.schema.js';
import { toMilvusRow } from './knowledge-vector.mapper.js';
import type { KnowledgeVectorRecord } from './knowledge-vector.types.js';

@Injectable()
export class KnowledgeVectorStoreService implements OnModuleDestroy {
  private readonly client: MilvusClient;

  constructor() {
    const host = process.env.MILVUS_HOST?.trim();
    const port = Number(process.env.MILVUS_PORT);

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('MILVUS_HOST and MILVUS_PORT must be configured');
    }

    this.client = new MilvusClient({ address: `${host}:${port}` });
  }

  /** 只读连接检查；此方法不会创建 collection 或写入向量。 */
  async getServerVersion(): Promise<string> {
    const result = await this.client.getVersion();
    return result.version;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.closeConnection();
  }

  async upsertDraftVectors(records: KnowledgeVectorRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    if (records.some((record) => record.publishStatus !== 'DRAFT')) {
      throw new Error('Only DRAFT vectors can be indexed');
    }

    // 稳定主键配合 upsert，重试不会产生另一个版本的主键。
    const result = await this.client.upsert({
      collection_name: KNOWLEDGE_COLLECTION_NAME,
      data: records.map(toMilvusRow),
    });

    if (
      result.status.error_code !== 'Success' ||
      result.err_index.length > 0 ||
      Number(result.upsert_cnt) !== records.length
    ) {
      throw new Error('Failed to upsert all knowledge vectors');
    }
    return records.length;
  }

  /**
   * 仅供本机验证草稿索引的检索方法。
   * 正式问答必须改为 PUBLISHED + 已发布版本过滤。
   */
  async searchDraftVectors(
    tenantId: string,
    knowledgeBaseId: string,
    embedding: number[],
  ) {
    const result = await this.client.search({
      collection_name: KNOWLEDGE_COLLECTION_NAME,
      anns_field: 'embedding',
      data: [embedding],
      limit: 5,
      metric_type: 'COSINE',
      // JSON.stringify 为 Milvus 字符串表达式添加引号并转义内容。
      filter:
        `tenant_id == ${JSON.stringify(tenantId)} && ` +
        `knowledge_base_id == ${JSON.stringify(knowledgeBaseId)} && ` +
        'publish_status == "DRAFT"',
      output_fields: [
        'chunk_id',
        'document_id',
        'chunk_index',
        'text_sha256',
        'index_version',
      ],
    });

    if (result.status.error_code !== 'Success') {
      throw new Error('Milvus draft search failed');
    }

    return (result.results as Array<Record<string, unknown>>).map((hit) => ({
      chunkId: String(hit.chunk_id),
      documentId: String(hit.document_id),
      chunkIndex: Number(hit.chunk_index),
      textSha256: String(hit.text_sha256),
      indexVersion: String(hit.index_version),
      score: Number(hit.score),
    }));
  }
}
