import { KNOWLEDGE_VECTOR_DIMENSION } from './knowledge-vector.types.js';

/** 在发起模型请求前校验配置，避免生成与 Milvus 字段维度不匹配的向量。 */
export function getKnowledgeEmbeddingConfig() {
  const model = process.env.EMBEDDING_MODEL?.trim();
  const apiKey = process.env.EMBEDDING_API_KEY?.trim();
  const baseURL = process.env.EMBEDDING_BASE_URL?.trim();
  const dimensions = Number(process.env.EMBEDDING_DIMENSION);

  if (!model || !apiKey || !baseURL) {
    throw new Error('Embedding model, API key and base URL are required');
  }
  if (
    model !== 'qwen3.7-text-embedding' ||
    dimensions !== KNOWLEDGE_VECTOR_DIMENSION
  ) {
    throw new Error(
      'Embedding configuration must use qwen3.7-text-embedding at 1024 dimensions',
    );
  }

  return { model, apiKey, baseURL, dimensions };
}
