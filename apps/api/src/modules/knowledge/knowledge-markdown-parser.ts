/**
 * Markdown 解析成功后的标准结果。
 */
export interface ParsedMarkdownDocument {
  /**
   * 标准化后的 Markdown 正文。
   *
   * 保留标题、列表、代码块等 Markdown 标记。
   */
  content: string;

  /**
   * 标准化正文的字符数。
   *
   * 当前只是字符统计，不代表模型 token 数量。
   */
  characterCount: number;
}

/**
 * Markdown 解析阶段使用的稳定错误码。
 *
 * 后续可以把错误码写入知识文档的 errorCode 字段。
 */
export type MarkdownParseErrorCode =
  | 'KNOWLEDGE_MARKDOWN_INVALID_UTF8'
  | 'KNOWLEDGE_MARKDOWN_EMPTY_CONTENT'
  | 'KNOWLEDGE_MARKDOWN_NULL_CHARACTER';

export class MarkdownParseError extends Error {
  readonly code: MarkdownParseErrorCode;

  constructor(code: MarkdownParseErrorCode, message: string) {
    super(message);
    this.name = 'MarkdownParseError';
    this.code = code;
  }
}

/**
 * 将 Markdown 文件 Buffer 解析为标准文本。
 *
 * 当前负责：
 * 1. 严格按照 UTF-8 解码；
 * 2. 删除文件开头的 BOM；
 * 3. 统一 Windows、Unix 和旧式 Mac 换行符；
 * 4. 拒绝空字符；
 * 5. 拒绝没有有效正文的文档；
 * 6. 返回标准化正文和字符数。
 *
 * 当前不负责：
 * 1. 下载 MinIO 文件；
 * 2. 文本切片；
 * 3. 生成 Embedding；
 * 4. 写入向量数据库。
 */
export function parseMarkdownDocument(buffer: Buffer): ParsedMarkdownDocument {
  let decodedContent: string;

  try {
    decodedContent = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new MarkdownParseError(
      'KNOWLEDGE_MARKDOWN_INVALID_UTF8',
      'The Markdown document must use UTF-8 encoding',
    );
  }
  /**
   * 删除文件开头可能存在的 UTF-8 BOM。
   *
   * BOM 在 JavaScript 字符串中表示为 \uFEFF，
   * 它不是正文内容，并可能影响第一个 Markdown 标题。
   */
  const contentWithoutBom = decodedContent.replace(/^\uFeFF/, '');
  const normalizedLineEndings = contentWithoutBom.replace(/\r\n?/g, '\n');

  if (normalizedLineEndings.includes('\0')) {
    throw new MarkdownParseError(
      'KNOWLEDGE_MARKDOWN_NULL_CHARACTER',
      'The Markdown document contains null characters',
    );
  }

  /**
   * 只清理整份文档首尾空白。
   *
   * 正文内部的换行和缩进必须保留，
   * 否则可能破坏列表和代码块结构。
   */
  const content = normalizedLineEndings.trim();
  if (content.length === 0) {
    throw new MarkdownParseError(
      'KNOWLEDGE_MARKDOWN_EMPTY_CONTENT',
      'The Markdown document contains no text',
    );
  }

  return {
    content,
    characterCount: content.length,
  };
}
