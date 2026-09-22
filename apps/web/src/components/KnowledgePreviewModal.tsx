import { useEffect, useRef, useState } from 'react';
import {
  ArrowRightOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FileTextOutlined,
  InboxOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Modal,
  Popconfirm,
  Space,
  Spin,
} from 'antd';
import {
  knowledgeChunkPreviewSchema,
  knowledgeDocumentListSchema,
  knowledgeDocumentSchema,
  type KnowledgeChunkPreview as ChunkPreview,
  type KnowledgeDocument as UploadedDocument,
  type KnowledgeDocumentStatus,
  type KnowledgePublishStatus,
} from '@service-agent/contracts';
import { readApiError } from '../api/http';

const documentStatusLabel: Record<KnowledgeDocumentStatus, string> = {
  UPLOADED: '已上传',
  PARSING: '处理中',
  READY: '索引已就绪',
  FAILED: '处理失败',
  CHUNKED: '已切片',
};

/** 发布状态独立展示，避免把“索引就绪”误解成“可用于问答”。 */
const publishStatusLabel: Record<KnowledgePublishStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
};

type KnowledgePreviewModalProps = {
  open: boolean;
  onClose: () => void;
};

export function KnowledgePreviewModal({
  open,
  onClose,
}: KnowledgePreviewModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState('');
  const [preview, setPreview] = useState<ChunkPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [selectedDocumentStatus, setSelectedDocumentStatus] =
    useState<KnowledgeDocumentStatus | null>(null);
  const [selectedPublishStatus, setSelectedPublishStatus] =
    useState<KnowledgePublishStatus | null>(null);
  const [canRetrySelectedIndex, setCanRetrySelectedIndex] = useState(false);
  const [canPublishSelectedDocument, setCanPublishSelectedDocument] =
    useState(false);
  const [selectedErrorCode, setSelectedErrorCode] = useState<string | null>(
    null,
  );
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [lifecycleAction, setLifecycleAction] = useState<
    'unpublish' | 'archive' | 'delete' | null
  >(null);
  const [lifecycleError, setLifecycleError] = useState('');
  const [indexResult, setIndexResult] = useState<{
    documentId: string;
    chunkCount: number;
    indexedCount: number;
  } | null>(null);

  const {
    data: documents = [],
    isLoading: documentsLoading,
    error: documentsError,
    refetch: refreshDocuments,
  } = useQuery<UploadedDocument[]>({
    queryKey: ['knowledge-documents'],
    enabled: open, // 弹窗打开时才请求。
    refetchInterval: (query) => {
      const rows = query.state.data;
      return rows?.some((item) =>
        ['UPLOADED', 'PARSING', 'CHUNKED'].includes(item.status),
      )
        ? 2_000
        : false;
    },
    queryFn: async () => {
      const response = await fetch('/api/knowledge/documents');
      if (!response.ok) throw await readApiError(response, '获取文档列表失败');
      return knowledgeDocumentListSchema.parse(await response.json());
    },
  });

  useEffect(() => {
    if (!selectedDocumentId) return;
    const current = documents.find((item) => item.id === selectedDocumentId);
    if (!current) return;
    setSelectedDocumentStatus(current.status);
    setSelectedPublishStatus(current.publishStatus);
    setCanRetrySelectedIndex(current.canRetryIndex);
    setCanPublishSelectedDocument(current.canPublish);
    setSelectedErrorCode(current.errorCode);
    if (current.status === 'CHUNKED' || current.status === 'READY') {
      void loadChunkPreview(current.id);
    }
  }, [documents, selectedDocumentId]);

  async function loadChunkPreview(id: string) {
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);

    try {
      const response = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(id)}/chunks`,
      );

      if (!response.ok) {
        throw await readApiError(response, '预览失败');
      }
      setPreview(knowledgeChunkPreviewSchema.parse(await response.json()));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }

  function openChunkDrawer(
    id: string,
    fileName: string,
    status: KnowledgeDocumentStatus,
    publishStatus: KnowledgePublishStatus,
    canRetryIndex: boolean,
    canPublish: boolean,
    errorCode: string | null,
  ) {
    // 先打开抽屉，切片请求期间在抽屉内显示加载状态。
    setSelectedDocumentId(id);
    setSelectedDocumentStatus(status);
    setSelectedPublishStatus(publishStatus);
    setCanRetrySelectedIndex(canRetryIndex);
    setCanPublishSelectedDocument(canPublish);
    setSelectedErrorCode(errorCode);
    setIndexError('');
    setPublishError('');
    setLifecycleError('');
    setIndexResult(null);
    setDrawerTitle(fileName);
    setDrawerOpen(true);
    void loadChunkPreview(id);
  }

  async function indexSelectedDocument() {
    const documentId = selectedDocumentId;
    if (!documentId || indexing) return;

    setIndexing(true);
    setIndexError('');
    setIndexResult(null);

    try {
      // 后端从 PostgreSQL 读取真实切片；前端不提交租户或模拟向量。
      const response = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(documentId)}/index-draft`,
        { method: 'POST' },
      );
      if (!response.ok) {
        throw await readApiError(response, '建立索引失败');
      }

      const result = (await response.json()) as {
        documentId?: unknown;
        chunkCount?: unknown;
        indexedCount?: unknown;
      };
      if (
        result.documentId !== documentId ||
        typeof result.chunkCount !== 'number' ||
        typeof result.indexedCount !== 'number' ||
        result.indexedCount !== result.chunkCount
      ) {
        throw new Error('向量写入数量与切片数量不一致，请勿用于问答');
      }

      setIndexResult({
        documentId,
        chunkCount: result.chunkCount,
        indexedCount: result.indexedCount,
      });
      setSelectedDocumentStatus('READY');
      // 新建立的是草稿索引，需要用户显式发布后才能用于正式问答。
      setSelectedPublishStatus('DRAFT');
      setCanRetrySelectedIndex(false);
      setCanPublishSelectedDocument(true);
      setSelectedErrorCode(null);
      setUploadError('');
      void refreshDocuments();
    } catch (error) {
      setIndexError(error instanceof Error ? error.message : '建立索引失败');
    } finally {
      setIndexing(false);
    }
  }

  /**
   * 发布当前文档的草稿索引。
   *
   * 租户、知识库和索引版本都由后端根据文档记录确定，
   * 浏览器只提交文档 ID，不能伪造发布范围。
   */
  async function publishSelectedDocument() {
    const documentId = selectedDocumentId;
    if (!documentId || publishing || !canPublishSelectedDocument) return;

    setPublishing(true);
    setPublishError('');

    try {
      const response = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(documentId)}/publish`,
        { method: 'POST' },
      );

      if (!response.ok) {
        throw await readApiError(response, '发布文档失败');
      }

      const result = (await response.json()) as {
        documentId?: unknown;
        publishStatus?: unknown;
        publishedAt?: unknown;
      };

      // 验证关键响应字段，避免接口异常时前端错误显示为发布成功。
      if (
        result.documentId !== documentId ||
        result.publishStatus !== 'PUBLISHED' ||
        typeof result.publishedAt !== 'string'
      ) {
        throw new Error('发布响应缺少有效的文档状态');
      }

      setSelectedPublishStatus('PUBLISHED');
      setCanPublishSelectedDocument(false);
      setSelectedErrorCode(null);

      // 刷新文档列表，使列表中的发布状态与抽屉保持一致。
      await refreshDocuments();
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : '发布文档失败');
    } finally {
      setPublishing(false);
    }
  }

  async function changeDocumentLifecycle(
    action: 'unpublish' | 'archive' | 'delete',
  ) {
    const documentId = selectedDocumentId;
    if (!documentId || lifecycleAction) return;
    setLifecycleAction(action);
    setLifecycleError('');
    try {
      const response = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(documentId)}` +
          (action === 'delete' ? '' : `/${action}`),
        { method: action === 'delete' ? 'DELETE' : 'POST' },
      );
      if (!response.ok) {
        throw await readApiError(
          response,
          {
            unpublish: '撤回发布失败',
            archive: '归档文档失败',
            delete: '删除文档失败',
          }[action],
        );
      }
      if (action === 'delete') {
        setDrawerOpen(false);
        setSelectedDocumentId(null);
        setPreview(null);
      } else {
        setSelectedPublishStatus(action === 'archive' ? 'ARCHIVED' : 'DRAFT');
        setCanPublishSelectedDocument(action === 'unpublish');
      }
      await refreshDocuments();
    } catch (error) {
      setLifecycleError(
        error instanceof Error ? error.message : '文档操作失败',
      );
    } finally {
      setLifecycleAction(null);
    }
  }

  async function uploadAndPreview() {
    if (!selectedFile) return;

    setUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      // 后端一次只接收一个文件；浏览器会自动设置 multipart boundary。
      formData.append('file', selectedFile);

      const response = await fetch('/api/knowledge/documents', {
        method: 'POST',
        body: formData,
      });

      if (response.status === 409) {
        // 重复上传只报错；已有文档可从列表中单独打开。
        setUploadError('该文档已上传，请勿重复上传。');
        return;
      }

      if (!response.ok) {
        throw await readApiError(response, '上传失败');
      }

      const uploaded = knowledgeDocumentSchema.parse(await response.json());

      // 上传已写入文档元数据；无论切片成功与否都刷新列表状态。
      void refreshDocuments();

      if (uploaded.status === 'FAILED') {
        setUploadError(
          '文档已上传，但自动切片失败。原文件已保留，可在文档列表中查看状态。',
        );
        return;
      }

      if (uploaded.status === 'UPLOADED' || uploaded.status === 'PARSING') {
        setUploadError('');
      } else if (uploaded.status === 'CHUNKED') {
        setUploadError(
          '文档已切片，但索引尚未完成，暂不可用于问答。请在切片抽屉中重试建立索引。',
        );
      } else if (uploaded.status !== 'READY') {
        setUploadError(`文档当前状态为 ${uploaded.status}，暂不可用于问答。`);
      }

      // 无论索引是否成功，都允许查看已经保存的切片。
      openChunkDrawer(
        uploaded.id,
        selectedFile.name,
        uploaded.status,
        uploaded.publishStatus,
        uploaded.canRetryIndex,
        uploaded.canPublish,
        uploaded.errorCode,
      );
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <Modal
        title="知识文档"
        open={open}
        onCancel={() => {
          if (indexing || publishing || lifecycleAction) return;
          setDrawerOpen(false);
          onClose();
        }}
        footer={null}
        width={760}
        className="knowledge-preview-modal"
      >
        <p className="knowledge-preview-intro">
          上传 Markdown 文档，或从已上传文档中查看切片。
        </p>

        <div className="knowledge-preview-section">
          <div className="knowledge-preview-section-heading">
            <span className="knowledge-preview-step">1</span>
            <div>
              <h3>上传新文档</h3>
              <p>
                上传后自动切片并建立草稿索引；确认发布后才会参与知识库问答。
              </p>
            </div>
          </div>
          <div className="knowledge-preview-actions">
            <input
              ref={fileInputRef}
              className="knowledge-preview-file-input"
              type="file"
              accept=".md,text/markdown,text/plain"
              aria-label="选择 Markdown 文件"
              onChange={(event) =>
                setSelectedFile(event.target.files?.[0] ?? null)
              }
            />
            <Button
              icon={<FileTextOutlined />}
              onClick={() => fileInputRef.current?.click()}
            >
              选择文件
            </Button>
            <span
              className="knowledge-preview-filename"
              title={selectedFile?.name}
            >
              {selectedFile?.name ?? '尚未选择文件'}
            </span>
            <Popconfirm
              title="上传并建立知识索引？"
              description="上传后将自动切片，并把切片正文发送给已配置的 Embedding 服务。请确认文档允许外发。"
              okText="确认上传"
              cancelText="取消"
              onConfirm={() => void uploadAndPreview()}
            >
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                loading={uploading}
                disabled={!selectedFile || previewLoading}
              >
                上传并建立索引
              </Button>
            </Popconfirm>
          </div>
        </div>

        <div className="knowledge-preview-section">
          <div className="knowledge-preview-section-heading">
            <span className="knowledge-preview-step">2</span>
            <div>
              <h3>查看已有文档</h3>
              <p>点击文档，在右侧抽屉中查看完整切片。</p>
            </div>
          </div>
          <div className="knowledge-document-list">
            {documentsLoading ? (
              <div className="knowledge-document-list-state">
                <Spin />
              </div>
            ) : documentsError ? (
              <Alert type="error" showIcon message="文档列表加载失败" />
            ) : documents.length === 0 ? (
              <Empty description="暂无已上传文档" />
            ) : (
              documents.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="knowledge-document-row"
                  disabled={uploading || previewLoading}
                  onClick={() =>
                    openChunkDrawer(
                      item.id,
                      item.fileName,
                      item.status,
                      item.publishStatus,
                      item.canRetryIndex,
                      item.canPublish,
                      item.errorCode,
                    )
                  }
                >
                  <span className="knowledge-document-icon">
                    <FileTextOutlined />
                  </span>
                  <span className="knowledge-document-info">
                    <strong title={item.fileName}>{item.fileName}</strong>
                    <small>
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                      {' · '}
                      {(item.sizeBytes / 1024).toFixed(1)} KB
                    </small>
                  </span>
                  <span
                    className={`knowledge-document-status status-${item.status.toLowerCase()}`}
                  >
                    {documentStatusLabel[item.status]}
                    {' · '}
                    {publishStatusLabel[item.publishStatus]}
                  </span>
                  <ArrowRightOutlined className="knowledge-document-arrow" />
                </button>
              ))
            )}
          </div>
        </div>

        {uploadError && (
          <Alert
            className="knowledge-preview-error"
            type="error"
            showIcon
            message={uploadError}
          />
        )}
      </Modal>
      <Drawer
        title={drawerTitle || '切片预览'}
        open={open && drawerOpen}
        onClose={() => {
          if (!indexing && !publishing && !lifecycleAction)
            setDrawerOpen(false);
        }}
        closable={!indexing && !publishing && !lifecycleAction}
        maskClosable={!indexing && !publishing && !lifecycleAction}
        extra={
          <Space wrap>
            {canRetrySelectedIndex ? (
              <Popconfirm
                title="重试建立向量索引？"
                description="切片正文将发送给已配置的外部 Embedding 服务。请先确认文档允许外发。"
                okText="确认发送"
                cancelText="取消"
                zIndex={1200}
                onConfirm={() => void indexSelectedDocument()}
              >
                <Button
                  type="primary"
                  loading={indexing}
                  disabled={
                    !selectedDocumentId ||
                    preview?.documentId !== selectedDocumentId ||
                    !preview.chunkCount
                  }
                >
                  重试建立索引
                </Button>
              </Popconfirm>
            ) : canPublishSelectedDocument ? (
              <Popconfirm
                title="发布当前知识文档？"
                description="发布后，该文档将立即参与正式知识库问答。"
                okText="确认发布"
                cancelText="取消"
                zIndex={1200}
                onConfirm={() => void publishSelectedDocument()}
              >
                <Button
                  type="primary"
                  loading={publishing}
                  disabled={
                    !selectedDocumentId ||
                    selectedDocumentStatus !== 'READY' ||
                    selectedPublishStatus !== 'DRAFT'
                  }
                >
                  发布文档
                </Button>
              </Popconfirm>
            ) : null}
            {selectedPublishStatus === 'PUBLISHED' && (
              <Popconfirm
                title="撤回发布？"
                description="撤回后文档将立即停止参与问答。"
                onConfirm={() => void changeDocumentLifecycle('unpublish')}
              >
                <Button
                  icon={<RollbackOutlined />}
                  loading={lifecycleAction === 'unpublish'}
                >
                  撤回
                </Button>
              </Popconfirm>
            )}
            {selectedPublishStatus !== 'ARCHIVED' && (
              <Popconfirm
                title="归档文档？"
                description="归档后不再参与问答，但数据仍会保留。"
                onConfirm={() => void changeDocumentLifecycle('archive')}
              >
                <Button
                  icon={<InboxOutlined />}
                  loading={lifecycleAction === 'archive'}
                >
                  归档
                </Button>
              </Popconfirm>
            )}
            {selectedPublishStatus === 'ARCHIVED' && (
              <Popconfirm
                title="永久删除文档？"
                description="原文件、切片和全部向量都会删除，无法恢复。"
                okButtonProps={{ danger: true }}
                onConfirm={() => void changeDocumentLifecycle('delete')}
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  loading={lifecycleAction === 'delete'}
                >
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
        width="min(760px, 100vw)"
        zIndex={1100}
        className="knowledge-chunk-drawer"
      >
        {(selectedDocumentStatus === 'UPLOADED' ||
          selectedDocumentStatus === 'PARSING') && (
          <Alert
            className="knowledge-index-feedback"
            type="info"
            showIcon
            message="文档正在后台解析和建立索引，页面会自动刷新状态。"
          />
        )}
        {selectedDocumentStatus === 'CHUNKED' && (
          <Alert
            className="knowledge-index-feedback"
            type="warning"
            showIcon
            message={
              selectedErrorCode === 'KNOWLEDGE_INDEXING_FAILED'
                ? canRetrySelectedIndex
                  ? '切片已保存，但索引失败，当前文档不可用于问答；可重试建立索引。'
                  : '切片已保存，但索引失败；该文档未关联知识库，暂无法重试。'
                : '切片已保存，但尚未建立索引，当前文档不可用于知识库问答。'
            }
          />
        )}
        {selectedDocumentStatus === 'READY' && (
          <Alert
            className="knowledge-index-feedback"
            type={selectedPublishStatus === 'PUBLISHED' ? 'success' : 'warning'}
            showIcon
            message={
              selectedPublishStatus === 'PUBLISHED'
                ? '文档已发布，当前内容可以参与知识库问答。'
                : '草稿索引已就绪；发布文档后才能参与知识库问答。'
            }
          />
        )}
        {publishError && (
          <Alert
            className="knowledge-index-feedback"
            type="error"
            showIcon
            message={publishError}
          />
        )}
        {lifecycleError && (
          <Alert
            className="knowledge-index-feedback"
            type="error"
            showIcon
            message={lifecycleError}
          />
        )}
        {indexError && (
          <Alert
            className="knowledge-index-feedback"
            type="error"
            showIcon
            message={indexError}
          />
        )}
        {indexResult?.documentId === selectedDocumentId && (
          <Alert
            className="knowledge-index-feedback"
            type="success"
            showIcon
            message={`已写入 ${indexResult.indexedCount} / ${indexResult.chunkCount} 条草稿向量`}
          />
        )}
        {previewLoading ? (
          <div className="knowledge-preview-loading">
            <Spin tip="正在读取切片…">
              <div />
            </Spin>
          </div>
        ) : previewError ? (
          <Alert type="error" showIcon message={previewError} />
        ) : (
          <div className="knowledge-preview-results" aria-live="polite">
            {preview ? (
              <>
                <div className="knowledge-preview-results-heading">
                  <div>
                    <span>切片结果</span>
                    <strong>{preview.fileName}</strong>
                  </div>
                  <span className="knowledge-preview-count">
                    共 {preview.chunkCount} 块
                  </span>
                </div>
                <div className="knowledge-preview-chunks">
                  {preview.chunks.map((chunk) => (
                    <section
                      className="knowledge-preview-chunk"
                      key={chunk.index}
                    >
                      <div className="knowledge-preview-chunk-heading">
                        <strong>切片 {chunk.index + 1}</strong>
                        <span>{chunk.characterCount} 字符</span>
                      </div>
                      <p>{chunk.headingPath.join(' → ') || '无标题'}</p>
                      <pre>{chunk.content}</pre>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <div className="knowledge-preview-empty">
                <FileTextOutlined />
                <strong>暂无切片内容</strong>
                <span>该文档暂时没有可预览的切片</span>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
