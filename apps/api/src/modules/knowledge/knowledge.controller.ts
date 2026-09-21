import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Req,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import {
  MAX_KNOWLEDGE_FILE_SIZE,
  validateKnowledgeFile,
} from './knowledge-file.validator.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * 知识文档接口。
 *
 * 路由前缀：
 * /api/knowledge/documents
 *
 * 提供文档上传、状态查询，以及本地开发用的文档列表和切片接口。
 */
@Controller('api/knowledge/documents')
export class KnowledgeController {
  private readonly localAddresses = new Set([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ]);

  constructor(
    /**
     * 负责知识文档数据库查询等业务逻辑。
     */
    private readonly knowledgeService: KnowledgeService,

    /**
     * 负责读取服务端环境变量。
     *
     * 当前通过 DEFAULT_TENANT_ID 确定本地开发租户，
     * 不接受客户端自行传入 tenantId。
     */
    private readonly configService: ConfigService,
  ) {}

  /**
   * 接收并校验一份知识文档。
   *
   * 校验 multipart 文件后交给服务层保存原文件、元数据和 Markdown 切片。
   * 向量化尚未接入。
   */
  @Post()
  async uploadDocument(@Req() request: FastifyRequest) {
    /**
     * request.file() 读取请求中的第一个文件。
     *
     * main.ts 中的 Multipart 配置已经设置 files: 1，
     * 因此一个请求最多只能上传一个文件。
     */
    const multipartFile = await request.file();

    /**
     * multipart/form-data 请求中没有文件时，
     * 返回稳定的业务错误码。
     */
    if (!multipartFile) {
      throw new BadRequestException({
        code: 'KNOWLEDGE_FILE_REQUIRED',
        message: 'A knowledge document file is required',
      });
    }

    let buffer: Buffer;

    try {
      /**
       * 把上传文件读取到内存。
       *
       * 当前文件最大为 10 MiB，可以暂时使用 Buffer。
       * 后续如果支持更大的 PDF 或 DOCX，应考虑直接把文件流
       * 写入 MinIO，避免长时间占用应用内存。
       */
      buffer = await multipartFile.toBuffer();
    } catch (error) {
      /**
       * @fastify/multipart 在文件超过 fileSize 限制时，
       * 会抛出错误码 FST_REQ_FILE_TOO_LARGE。
       *
       * 这里将框架内部错误转换为项目自己的稳定错误码，
       * 防止前端依赖 Fastify 的内部实现。
       */
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FST_REQ_FILE_TOO_LARGE'
      ) {
        /**
         * PayloadTooLargeException 对应 HTTP 413。
         *
         * 413 比 HTTP 400 更准确地表示：
         * 请求本身格式正确，但上传内容超过服务器限制。
         */
        throw new PayloadTooLargeException({
          code: 'KNOWLEDGE_FILE_TOO_LARGE',
          message:
            `The file must not exceed ` + `${MAX_KNOWLEDGE_FILE_SIZE} bytes`,
        });
      }

      /**
       * 不是文件大小限制导致的异常时，不隐藏原始错误。
       * 交给 NestJS 全局异常处理机制继续处理。
       */
      throw error;
    }

    /**
     * 执行扩展名、MIME、空文件和 Markdown UTF-8 校验。
     */
    const validatedFile = validateKnowledgeFile({
      fileName: multipartFile.filename,
      mimeType: multipartFile.mimetype,
      buffer,
    });

    return this.knowledgeService.createDocument(
      this.getTenantId(),
      validatedFile,
    );
  }

  @Get('search-draft')
  async searchDraft(
    @Query('question') question: string,
    @Req() request: FastifyRequest,
  ) {
    this.assertLocalDevelopmentRequest(request);

    // 知识库和租户均由服务端确定，不能由请求自行指定。
    const knowledgeBaseId = process.env.DEFAULT_KNOWLEDGE_BASE_ID?.trim();
    if (!knowledgeBaseId) {
      throw new Error('DEFAULT_KNOWLEDGE_BASE_ID is required');
    }

    return this.knowledgeService.retrieveDraftKnowledge(
      this.getTenantId(),
      knowledgeBaseId,
      question,
    );
  }

  /**
   * 查询单个知识文档的处理状态。
   *
   * 使用 UUID v4 校验文档 ID，可以在访问数据库之前
   * 拒绝明显不合法的路径参数。
   */
  @Get(':id')
  async findDocumentById(
    @Param('id', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
  ) {
    /**
     * 当前项目还没有接入登录鉴权，
     * 因此暂时从服务端环境变量读取租户。
     *
     * tenantId 不能从请求参数或请求正文直接获取，
     * 否则调用者可能伪造其他租户的编号。
     */
    return this.knowledgeService.findDocumentById(
      this.getTenantId(),
      documentId,
    );
  }

  @Get()
  async listDocuments(@Req() request: FastifyRequest) {
    this.assertLocalDevelopmentRequest(request);
    return this.knowledgeService.listDocuments(this.getTenantId());
  }

  /**
   * 本机开发用切片预览。
   *
   * 返回原文切片，因此在接入正式鉴权前，
   * 不允许生产环境或非本机请求访问。
   */
  @Get(':id/chunks')
  async previewChunks(
    @Param('id', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
  ) {
    this.assertLocalDevelopmentRequest(request);
    return this.knowledgeService.previewMarkdownChunks(
      this.getTenantId(),
      documentId,
    );
  }

  /**
   * 查询回答实际引用的单个知识切片。
   *
   * 请求示例：
   *
   * GET /api/knowledge/documents/{documentId}/chunks/{chunkId}
   *
   * 与 GET /:id/chunks 的区别：
   * - /:id/chunks 返回整篇文档的全部切片；
   * - 当前接口只返回回答真正引用的一条切片。
   *
   * 当前接口会返回知识正文，因此在正式鉴权完成前，
   * 与完整切片预览接口保持相同限制：只允许本地开发环境访问。
   */
  @Get(':id/chunks/:chunkId')
  async findCitationChunk(
    /**
     * 引用所属的文档 ID。
     *
     * ParseUUIDPipe 会在调用 Service 前拒绝非法 UUID，
     * 避免无效参数进入数据库查询。
     */
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    documentId: string,

    /**
     * 回答实际引用的知识切片 ID。
     *
     * 同样要求是 UUID v4。
     */
    @Param(
      'chunkId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    chunkId: string,

    /**
     * 用于验证当前请求是否来自允许的本地开发环境。
     */
    @Req()
    request: FastifyRequest,
  ) {
    /**
     * 单个切片仍然属于企业知识正文，
     * 不能因为返回内容较少就跳过访问限制。
     */
    this.assertLocalDevelopmentRequest(request);

    /**
     * tenantId 由服务端上下文提供。
     *
     * Service 会进一步验证：
     * 1. 切片属于该文档；
     * 2. 切片属于当前租户；
     * 3. 文档也属于当前租户。
     */
    return this.knowledgeService.findCitationChunk(
      this.getTenantId(),
      documentId,
      chunkId,
    );
  }
  @Post(':id/chunks')
  async saveChunks(
    @Param('id', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
  ) {
    this.assertLocalDevelopmentRequest(request);
    return this.knowledgeService.saveMarkdownChunks(
      this.getTenantId(),
      documentId,
    );
  }
  /**
   * 显式为一份真实文档建立草稿向量索引。
   * 切片正文会发送到已配置的 Embedding 服务；
   * 未接入正式鉴权前，仅允许本机开发请求。
   */
  @Post(':id/index-draft')
  async indexDocumentDraft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
  ) {
    this.assertLocalDevelopmentRequest(request);

    // 租户由服务端确定，不能接受客户端提交的 tenantId。
    return this.knowledgeService.indexDocumentDraft(
      this.getTenantId(),
      documentId,
    );
  }

  /**
   * 发布指定文档的当前草稿索引。
   *
   * 请求：
   * POST /api/knowledge/documents/:id/publish
   *
   * 当前项目尚未接入正式管理员鉴权，
   * 所以该管理接口只允许本机开发请求访问。
   *
   * 发布成功后：
   * 1. Milvus 中当前版本的向量变为 PUBLISHED；
   * 2. PostgreSQL 文档变为 PUBLISHED；
   * 3. 文档可以参与正式 RAG 检索。
   */
  @Post(':id/publish')
  async publishDocument(
    /**
     * 文档 ID 必须是 UUID v4。
     *
     * 非法 ID 会在进入业务服务前返回 HTTP 400，
     * 避免把无效参数传入 Prisma 和 Milvus。
     */
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    documentId: string,

    /**
     * FastifyRequest 用于检查请求来源 IP。
     */
    @Req() request: FastifyRequest,
  ) {
    /**
     * 在尚未实现 JWT 和管理员权限前，
     * 发布操作只允许本机开发环境调用。
     *
     * 非本机请求和生产环境统一返回 404，
     * 不公开该管理接口是否存在。
     */
    this.assertLocalDevelopmentRequest(request);

    /**
     * tenantId 由服务端配置确定。
     *
     * 不接受浏览器在请求体中传入 tenantId，
     * 避免伪造租户发布其他企业的知识文档。
     */
    return this.knowledgeService.publishDocument(
      this.getTenantId(),
      documentId,
    );
  }

  private getTenantId(): string {
    // 租户只能由服务端确定，不能信任客户端传来的 tenantId。
    return (
      this.configService.get<string>('DEFAULT_TENANT_ID') ?? 'tenant-local-dev'
    );
  }

  private assertLocalDevelopmentRequest(request: FastifyRequest): void {
    // 未接入正式鉴权前，含原文内容的管理接口只允许本机开发访问。
    if (
      process.env.NODE_ENV === 'production' ||
      !this.localAddresses.has(request.ip)
    ) {
      throw new NotFoundException();
    }
  }
}
