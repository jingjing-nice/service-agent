import { DataType, type CreateCollectionReq } from '@zilliz/milvus2-sdk-node';
import { KNOWLEDGE_VECTOR_DIMENSION } from './knowledge-vector.types.js';

export const KNOWLEDGE_COLLECTION_NAME = 'knowledge_chunks_v1';

export const knowledgeCollectionSchema = {
  collection_name: KNOWLEDGE_COLLECTION_NAME,
  enable_dynamic_field: false, // 不接受未声明的元数据字段。
  fields: [
    {
      name: 'id',
      data_type: DataType.VarChar,
      is_primary_key: true,
      autoID: false,
      type_params: { max_length: '100' },
    },
    {
      name: 'chunk_id',
      data_type: DataType.VarChar,
      type_params: { max_length: '36' },
    },
    {
      name: 'knowledge_base_id',
      data_type: DataType.VarChar,
      type_params: { max_length: '100' },
    },
    {
      name: 'tenant_id',
      data_type: DataType.VarChar,
      type_params: { max_length: '100' },
    },
    {
      name: 'document_id',
      data_type: DataType.VarChar,
      type_params: { max_length: '36' },
    },
    {
      name: 'chunk_index',
      data_type: DataType.Int64,
    },
    {
      name: 'embedding',
      data_type: DataType.FloatVector,
      type_params: { dim: String(KNOWLEDGE_VECTOR_DIMENSION) },
    },
    {
      name: 'embedding_model',
      data_type: DataType.VarChar,
      type_params: { max_length: '100' },
    },
    {
      name: 'text_sha256',
      data_type: DataType.VarChar,
      type_params: { max_length: '64' },
    },
    {
      name: 'index_version',
      data_type: DataType.VarChar,
      type_params: { max_length: '50' },
    },
    {
      name: 'publish_status',
      data_type: DataType.VarChar,
      type_params: { max_length: '16' },
    },
  ],
} satisfies CreateCollectionReq;

/** 同一切片在不同索引版本中必须有不同的 Milvus 主键。 */
export function createKnowledgeVectorId(
  indexVersion: string,
  chunkId: string,
): string {
  if (!indexVersion || !chunkId) {
    throw new Error('Index version and chunk ID are required');
  }

  const id = `${indexVersion}:${chunkId}`;
  if (id.length > 100) {
    throw new Error('Knowledge vector ID exceeds Milvus field length');
  }
  return id;
}
