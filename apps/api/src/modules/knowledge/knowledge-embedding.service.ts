import { Injectable } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import { getKnowledgeEmbeddingConfig } from './knowledge-embedding.config.js';

@Injectable()
export class KnowledgeEmbeddingService {
  private readonly config = getKnowledgeEmbeddingConfig();

  private readonly embeddings = new OpenAIEmbeddings({
    model: this.config.model,
    apiKey: this.config.apiKey,
    dimensions: this.config.dimensions,
    batchSize: 20, // 该模型的单次文本条数上限。
    configuration: { baseURL: this.config.baseURL },
    encodingFormat: 'float',
  });

  /** 按输入顺序生成向量，并在交给向量库前验证结果。 */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const vectors = await this.embeddings.embedDocuments(texts);
    if (
      vectors.length !== texts.length ||
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
}
