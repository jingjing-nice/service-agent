import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';

/**
 * 单个知识文档允许上传的最大大小：10 MiB。
 *
 * 这里使用字节计算：
 * 10 × 1024 × 1024 = 10,485,760 bytes。
 *
 * Markdown 文件通常较小，但 PDF 和 DOCX 可能包含图片等资源，
 * 因此暂时为所有知识文档统一设置为 10 MiB。
 */
export const MAX_KNOWLEDGE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * 知识文档的业务类型。
 *
 * 不直接使用 MIME 类型作为业务类型，是因为：
 * 1. MIME 字符串较长，不适合业务逻辑频繁比较；
 * 2. 同一种文件可能存在多个合法 MIME 类型；
 * 3. 后续可以根据 fileType 选择对应的文档解析器。
 */
export type KnowledgeFileType = 'MARKDOWN' | 'PDF' | 'DOCX';

/**
 * 单个文件扩展名对应的校验规则。
 */
interface KnowledgeFileRule {
  /**
   * 文件通过校验后使用的标准业务类型。
   */
  type: KnowledgeFileType;

  /**
   * 该扩展名允许使用的 MIME 类型集合。
   *
   * 使用 ReadonlySet 表示校验过程中不应该修改该集合。
   */
  mimeTypes: ReadonlySet<string>;
}

/**
 * 当前允许上传的知识文档格式。
 *
 * MIME 类型由客户端提供，不能单独作为可信依据，
 * 因此需要同时校验扩展名和 MIME 类型。
 *
 * 注意：
 * 此处只能完成基础格式校验，不能证明文件内容一定安全。
 * 后续解析 PDF 和 DOCX 时还需要检查文件签名及解析异常。
 */
const FILE_RULES: Record<string, KnowledgeFileRule> = {
  '.md': {
    type: 'MARKDOWN',

    /**
     * 不同浏览器和操作系统可能为 Markdown 提供不同 MIME：
     *
     * text/markdown：标准 Markdown MIME；
     * text/x-markdown：部分旧工具使用；
     * text/plain：部分浏览器上传 .md 文件时使用。
     */
    mimeTypes: new Set(['text/markdown', 'text/x-markdown', 'text/plain']),
  },

  '.pdf': {
    type: 'PDF',
    mimeTypes: new Set(['application/pdf']),
  },

  '.docx': {
    type: 'DOCX',
    mimeTypes: new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]),
  },
};

/**
 * 文件校验器接收的最小输入结构。
 *
 * 这里没有直接依赖 Fastify 的 MultipartFile，
 * 这样校验逻辑可以独立测试，也方便以后更换上传组件。
 */
export interface KnowledgeFileInput {
  /**
   * 用户上传时的原始文件名，例如 refund-policy.md。
   */
  fileName: string;

  /**
   * 上传请求中声明的 MIME 类型。
   */
  mimeType: string;

  /**
   * 文件的原始二进制内容。
   */
  buffer: Buffer;
}

/**
 * 文件校验成功后返回的标准结构。
 */
export interface ValidatedKnowledgeFile {
  /**
   * 去掉文件名前后空格后的原始文件名。
   */
  fileName: string;

  /**
   * 转换为小写并清理空格后的 MIME 类型。
   */
  mimeType: string;

  /**
   * 标准化后的文档业务类型。
   */
  fileType: KnowledgeFileType;

  /**
   * 文件实际占用的字节数。
   */
  sizeBytes: number;

  /**
   * 文件原始内容。
   *
   * 后续需要将该 Buffer 上传到 MinIO。
   */
  buffer: Buffer;

  /**
   * 只有 Markdown 可以在校验阶段直接解析为文本。
   *
   * PDF 和 DOCX 是二进制格式，需要由各自的解析器处理，
   * 所以它们不会返回 content。
   */
  content?: string;
}

/**
 * 创建统一的文件校验异常。
 *
 * 为什么需要稳定错误码：
 * 前端可以根据 code 展示对应提示，
 * 而不需要依赖可能发生变化的英文 message。
 */
function invalidFile(code: string, message: string): BadRequestException {
  return new BadRequestException({
    code,
    message,
  });
}

/**
 * 校验准备上传到知识库的文件。
 *
 * 当前执行以下检查：
 * 1. 文件扩展名是否支持；
 * 2. 扩展名和 MIME 类型是否匹配；
 * 3. 文件是否为空；
 * 4. 文件是否超过大小限制；
 * 5. Markdown 是否为合法 UTF-8；
 * 6. Markdown 是否只包含空白字符。
 *
 * 当前只判断文件是否允许进入对象存储。
 * PDF 和 DOCX 的内容提取、文件签名检查以及安全解析，
 * 会在对应的文档解析器中完成。
 */
export function validateKnowledgeFile(
  input: KnowledgeFileInput,
): ValidatedKnowledgeFile {
  /**
   * 清理文件名前后可能存在的空格，
   * 并统一把扩展名转换为小写。
   *
   * 因此 policy.MD 和 policy.md 会按照同一种格式处理。
   */
  const fileName = input.fileName.trim();
  const extension = extname(fileName).toLowerCase();
  const rule = FILE_RULES[extension];

  if (!rule) {
    throw invalidFile(
      'KNOWLEDGE_FILE_EXTENSION_NOT_ALLOWED',
      'Only .md, .pdf and .docx files are supported',
    );
  }

  /**
   * MIME 类型本身不区分大小写。
   * 标准化后再与允许列表进行比较。
   */
  const mimeType = input.mimeType.toLowerCase().trim();

  if (!rule.mimeTypes.has(mimeType)) {
    throw invalidFile(
      'KNOWLEDGE_FILE_MIME_NOT_ALLOWED',
      `The MIME type does not match the ${extension} extension`,
    );
  }

  /**
   * 空 Buffer 表示客户端没有上传任何文件内容。
   */
  if (input.buffer.length === 0) {
    throw invalidFile('KNOWLEDGE_FILE_EMPTY', 'The uploaded file is empty');
  }

  /**
   * 限制文件大小，避免应用一次性读取过大的文件，
   * 造成内存占用过高。
   *
   * 后续还需要在 Fastify Multipart 层增加相同限制，
   * 避免超大文件完整进入应用内存后才被拒绝。
   */
  if (input.buffer.length > MAX_KNOWLEDGE_FILE_SIZE) {
    throw invalidFile(
      'KNOWLEDGE_FILE_TOO_LARGE',
      `The file must not exceed ${MAX_KNOWLEDGE_FILE_SIZE} bytes`,
    );
  }

  /**
   * Markdown 是纯文本格式，因此可以在上传阶段检查：
   * 1. 是否为合法 UTF-8；
   * 2. 是否包含有效文本。
   */
  if (rule.type === 'MARKDOWN') {
    let content: string;

    try {
      /**
       * fatal: true 表示遇到非法 UTF-8 字节时直接抛出异常。
       *
       * 如果使用 Buffer.toString('utf8')，Node.js 会使用替换字符
       * 处理非法字节，无法严格判断文件编码是否合法。
       */
      content = new TextDecoder('utf-8', {
        fatal: true,
      }).decode(input.buffer);
    } catch {
      throw invalidFile(
        'KNOWLEDGE_FILE_INVALID_UTF8',
        'The Markdown file must use UTF-8 encoding',
      );
    }

    /**
     * 文件可能包含空格、换行和制表符，但没有实际内容。
     * 这种文件不应该进入后续切片与向量化流程。
     */
    if (content.trim().length === 0) {
      throw invalidFile(
        'KNOWLEDGE_FILE_EMPTY',
        'The Markdown file contains no text',
      );
    }

    return {
      fileName,
      mimeType,
      fileType: rule.type,
      sizeBytes: input.buffer.length,
      buffer: input.buffer,
      content,
    };
  }

  /**
   * PDF 和 DOCX 是二进制格式：
   *
   * 不能使用 TextDecoder 解码；
   * 不能通过 trim() 判断是否具有有效内容；
   * 后续必须交给对应的解析器处理。
   */
  return {
    fileName,
    mimeType,
    fileType: rule.type,
    sizeBytes: input.buffer.length,
    buffer: input.buffer,
  };
}
