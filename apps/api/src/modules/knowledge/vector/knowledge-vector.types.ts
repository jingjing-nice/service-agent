export const KNOWLEDGE_VECTOR_DIMENSION = 1024;

export type KnowledgeVectorRecord = {
  id: string;
  chunkId: string; // 对应 PostgreSQL 的 KnowledgeChunk.id
  tenantId: string; // 租户过滤
  documentId: string; // 来源文档
  chunkIndex: number; // 切片顺序
  embedding: number[]; // 写入前检查长度为 1024
  embeddingModel: string; // 生成该向量的模型名称
  textSha256: string; // 这条切片正文的 SHA-256，不是原文件哈希
  indexVersion: string; // 这批向量所属的索引版本
  publishStatus: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  knowledgeBaseId: string; // 所属知识库，检索时与 tenantId 一起过滤
};
