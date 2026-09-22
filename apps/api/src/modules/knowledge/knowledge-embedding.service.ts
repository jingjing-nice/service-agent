import { Injectable } from '@nestjs/common';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { OpenAIEmbeddings } from '@langchain/openai';
import { getKnowledgeEmbeddingConfig } from './knowledge-embedding.config.js';
import { withRetry } from '../../common/retry.js';

@Injectable()
export class KnowledgeEmbeddingService implements EmbeddingsInterface {
  private readonly config = getKnowledgeEmbeddingConfig();

  private readonly embeddings = new OpenAIEmbeddings({
    model: this.config.model,
    apiKey: this.config.apiKey,
    dimensions: this.config.dimensions,
    batchSize: 20, // 该模型的单次文本条数上限。
    maxRetries: 0,
    configuration: { baseURL: this.config.baseURL },
    encodingFormat: 'float',
  });

  /** 返回当前向量对应的模型名称，供向量记录保存可追溯信息。 */
  getModelName(): string {
    return this.config.model;
  }

  /** 实现 LangChain EmbeddingsInterface 的批量文档向量接口。 */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) return [];
    const vectors = await withRetry(
      () => this.embeddings.embedDocuments(documents),
      { attempts: 3 },
    );
    if (
      vectors.length !== documents.length ||
      vectors.some(
        (vector) =>
          vector.length !== this.config.dimensions ||
          vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new Error('Embedding result count, dimension or value is invalid');
    }

    return vectors;
  }

  /**
   * 实现 LangChain EmbeddingsInterface 的单条查询向量接口。
   * 查询和文档使用同一个模型配置，确保两类向量位于同一向量空间。
   */
  async embedQuery(document: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([document]);
    return vector;
  }
}
