import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  /**
   * Milvus gRPC 客户端。
   */
  MilvusClient,

  /**
   * Milvus 查询一致性级别枚举。
   *
   * SDK 的 consistency_level 参数不接受普通字符串，
   * 必须使用该枚举。
   */
  ConsistencyLevelEnum,
} from '@zilliz/milvus2-sdk-node';
import { KNOWLEDGE_COLLECTION_NAME } from './knowledge-vector.schema.js';
import { toMilvusRow } from './knowledge-vector.mapper.js';
import {
  KNOWLEDGE_VECTOR_DIMENSION,
  type KnowledgeVectorRecord,
} from './knowledge-vector.types.js';
import {
  assertValidKnowledgeQueryVector,
  createKnowledgeDocumentVectorFilter,
  createKnowledgeVectorSearchFilter,
  KNOWLEDGE_VECTOR_SEARCH_OUTPUT_FIELDS,
  mapKnowledgeVectorHits,
} from './knowledge-vector-query.utils.js';
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
   * 将指定文档版本的草稿向量更新为已发布状态。
   *
   * Milvus 当前 SDK 没有直接修改单个标量字段的方法，
   * 因此发布流程分为两步：
   *
   * 1. 查询指定文档和版本的完整向量记录；
   * 2. 使用相同主键重新 upsert，并将 publish_status 改为 PUBLISHED。
   *
   * 因为主键保持不变，所以不会产生重复向量。
   *
   * @param tenantId 当前租户 ID
   * @param knowledgeBaseId 知识库 ID
   * @param documentId 需要发布的文档 ID
   * @param indexVersion 需要发布的索引版本
   * @returns 实际更新为 PUBLISHED 的向量数量
   */
  async publishDraftVectors(
    tenantId: string,
    knowledgeBaseId: string,
    documentId: string,
    indexVersion: string,
  ): Promise<number> {
    /**
     * 所有过滤条件都来自 PostgreSQL 中经过校验的数据。
     *
     * JSON.stringify 会：
     * 1. 为字符串添加双引号；
     * 2. 转义字符串中的特殊字符；
     * 3. 避免直接拼接未转义字符串破坏 Milvus 表达式。
     */
    const filter = createKnowledgeDocumentVectorFilter(
      tenantId,
      knowledgeBaseId,
      documentId,
      indexVersion,
    );

    /**
     * 查询发布所需的完整记录。
     *
     * Milvus upsert 不是局部字段更新，
     * 因此必须取回向量及所有必需的标量字段。
     */
    const queryResult = await this.client.query({
      collection_name: KNOWLEDGE_COLLECTION_NAME,
      filter,

      /**
       * 返回重新 upsert 所需的全部字段。
       *
       * 主键 id 和向量 embedding 都必须返回，
       * 否则不能覆盖原记录。
       */
      output_fields: [
        'id',
        'chunk_id',
        'knowledge_base_id',
        'tenant_id',
        'document_id',
        'chunk_index',
        'embedding',
        'embedding_model',
        'text_sha256',
        'index_version',
        'publish_status',
      ],

      /**
       * 单个演示文档最多读取 16384 个切片。
       *
       * 个人项目的文档切片数量远低于该值。
       * 生产版本应改为 QueryIterator 分批处理。
       */
      limit: 16_384,

      /**
       * 发布属于管理操作，需要读取刚刚写入的最新草稿向量。
       */
      consistency_level: ConsistencyLevelEnum.Strong,
    });

    /**
     * Milvus 请求失败时终止发布。
     *
     * 此时 PostgreSQL 仍保持 DRAFT，
     * 不会出现数据库显示已发布但向量没有发布的状态。
     */
    if (queryResult.status.error_code !== 'Success') {
      throw new Error(
        `Failed to query draft vectors: ${
          queryResult.status.reason || queryResult.status.error_code
        }`,
      );
    }

    const draftRows = queryResult.data;

    /**
     * 没有查到草稿向量时不能把发布当作成功。
     *
     * 可能原因：
     * 1. indexVersion 错误；
     * 2. 文档尚未建立索引；
     * 3. 向量已经发布；
     * 4. Milvus 数据与 PostgreSQL 不一致。
     */
    if (draftRows.length === 0) {
      throw new Error('No draft vectors were found for the document version');
    }

    /**
     * 验证查询结果包含有效向量。
     *
     * 如果 embedding 缺失，继续 upsert 可能覆盖或损坏原记录。
     */
    for (const row of draftRows) {
      if (
        !Array.isArray(row.embedding) ||
        row.embedding.length !== KNOWLEDGE_VECTOR_DIMENSION ||
        row.embedding.some(
          (value: unknown) =>
            typeof value !== 'number' || !Number.isFinite(value),
        )
      ) {
        throw new Error('Milvus returned an invalid knowledge vector');
      }
    }

    /**
     * 使用原主键和原向量覆盖记录，
     * 只把 publish_status 改为 PUBLISHED。
     */
    const publishedRows = draftRows.map((row) => ({
      id: row.id,
      chunk_id: row.chunk_id,
      knowledge_base_id: row.knowledge_base_id,
      tenant_id: row.tenant_id,
      document_id: row.document_id,
      chunk_index: row.chunk_index,
      embedding: row.embedding,
      embedding_model: row.embedding_model,
      text_sha256: row.text_sha256,
      index_version: row.index_version,
      publish_status: 'PUBLISHED',
    }));

    const upsertResult = await this.client.upsert({
      collection_name: KNOWLEDGE_COLLECTION_NAME,
      data: publishedRows,
    });

    /**
     * 同时检查：
     * 1. Milvus 是否报告成功；
     * 2. 是否存在失败的记录下标；
     * 3. 实际 upsert 数量是否与查询数量一致。
     */
    if (
      upsertResult.status.error_code !== 'Success' ||
      upsertResult.err_index.length > 0 ||
      Number(upsertResult.upsert_cnt) !== publishedRows.length
    ) {
      throw new Error('Failed to publish all knowledge vectors');
    }

    return publishedRows.length;
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
      filter: createKnowledgeVectorSearchFilter(
        tenantId,
        knowledgeBaseId,
        'DRAFT',
      ),
      output_fields: KNOWLEDGE_VECTOR_SEARCH_OUTPUT_FIELDS,
    });

    if (result.status.error_code !== 'Success') {
      throw new Error('Milvus draft search failed');
    }

    return mapKnowledgeVectorHits(
      result.results as Array<Record<string, unknown>>,
    );
  }

  /**
   * 检索已经发布的知识向量。
   *
   * 与 searchDraftVectors 的区别：
   *
   * searchDraftVectors：
   * 仅供知识运营人员在发布前测试召回结果。
   *
   * searchPublishedVectors：
   * 供正式聊天流程使用，只允许返回
   * publish_status = PUBLISHED 的向量。
   *
   * @param tenantId 当前请求所属租户
   * @param knowledgeBaseId 当前允许访问的知识库
   * @param embedding 用户问题生成的向量
   */
  async searchPublishedVectors(
    tenantId: string,
    knowledgeBaseId: string,
    embedding: number[],
  ) {
    /**
     * 在调用 Milvus 前验证问题向量。
     *
     * 维度必须与 Collection Schema 中的维度一致；
     * 每个元素必须是有限数字。
     */
    assertValidKnowledgeQueryVector(embedding);

    /**
     * tenantId 和 knowledgeBaseId 都必须在检索前过滤。
     *
     * 不能先检索整个 Collection，
     * 再在应用层隐藏其他租户的结果。
     */
    const filter = createKnowledgeVectorSearchFilter(
      tenantId,
      knowledgeBaseId,
      'PUBLISHED',
    );

    const result = await this.client.search({
      collection_name: KNOWLEDGE_COLLECTION_NAME,

      /// Collection 中保存向量的字段名称。
      anns_field: 'embedding',

      /// Milvus 支持一次搜索多个问题向量，这里只有一个。
      data: [embedding],

      /**
       * 当前个人项目取相似度最高的 5 条切片。
       *
       * 后续增加 reranker 时可以先扩大召回数量，
       * 再由 reranker 选出最终上下文。
       */
      limit: 5,

      /**
       * 建立索引时使用余弦距离，
       * 查询时必须使用相同的距离计算方式。
       */
      metric_type: 'COSINE',

      /// 强制租户、知识库和发布状态过滤。
      filter,

      /**
       * 返回 PostgreSQL 回查和版本验证所需的字段。
       *
       * Milvus 不作为正文事实数据源，
       * 正文仍然从 PostgreSQL 获取。
       */
      output_fields: KNOWLEDGE_VECTOR_SEARCH_OUTPUT_FIELDS,

      /**
       * 正式问答使用强一致性读取。
       *
       * 文档发布完成后立即提问时，
       * 应能够读取刚刚发布的向量。
       */
      consistency_level: ConsistencyLevelEnum.Strong,
    });

    /**
     * Milvus 搜索失败时不能返回空数组伪装成“没有知识”。
     *
     * 基础设施故障与正常零召回需要明确区分。
     */
    if (result.status.error_code !== 'Success') {
      throw new Error(
        `Milvus published search failed: ${
          result.status.reason || result.status.error_code
        }`,
      );
    }

    /**
     * 将 Milvus 原始结果转换成稳定的内部结构。
     *
     * 这里不返回 embedding，避免大向量继续进入
     * Agent State 或模型上下文。
     */
    return mapKnowledgeVectorHits(
      result.results as Array<Record<string, unknown>>,
    );
  }
}
