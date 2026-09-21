import { useEffect, useRef, useState } from 'react';
import { Alert, Empty, Modal, Spin, Tag } from 'antd';
import { BookOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { LocalMessage, MessageCitation } from '../types/conversation';
import { useWorkbenchStore } from '../stores';

type KnowledgeSourcePreview = {
  documentId: string;
  fileName: string;
  chunks: Array<{
    index: number;
    content: string;
    headingPath: string[];
  }>; 
};

/** 精确引用接口返回的一条知识切片。 */
type KnowledgeCitationChunk = {
  documentId: string;
  chunkId: string;
  fileName: string;
  index: number;
  content: string;
  characterCount: number;
  headingPath: string[];
};

/**
 * 引用弹窗使用的统一数据结构。
 * precise 用于区分新引用和没有 chunkId 的历史引用。
 */
type KnowledgeSourceResult = {
  documentId: string;
  fileName: string;
  precise: boolean;
  chunks: Array<{
    index: number;
    content: string;
    characterCount?: number;
    headingPath: string[];
  }>;
};

export function ChatMessages({ messages }: { messages: LocalMessage[] }) {
  const messagesRef = useRef<HTMLElement>(null);
  const [selectedSource, setSelectedSource] = useState<MessageCitation | null>(null);
  const status = useWorkbenchStore((state) => state.status);
  const streamingText = useWorkbenchStore((state) => state.streamingText);
  const streamError = useWorkbenchStore((state) => state.streamError);
  const {
    data: sourcePreview,
    isLoading: sourceLoading,
    error: sourceError,
  } = useQuery<KnowledgeSourceResult>({
    /**
     * 同一文档可能命中多个切片，因此缓存键必须包含 chunkId。
     * 否则 React Query 可能复用该文档中另一条引用的缓存。
     */
    queryKey: [
      'knowledge-source',
      selectedSource?.source,
      selectedSource?.chunkId,
    ],
    enabled: Boolean(selectedSource),
    queryFn: async ({ signal }) => {
      const documentId = selectedSource?.source;
      const chunkId = selectedSource?.chunkId;

      if (!documentId) {
        throw new Error('缺少来源文档 ID');
      }

      /**
       * 新生成的引用包含 chunkId，只读取模型实际使用的一条切片。
       */
      if (chunkId) {
        const response = await fetch(
          `/api/knowledge/documents/` +
            `${encodeURIComponent(documentId)}/chunks/` +
            `${encodeURIComponent(chunkId)}`,
          { signal },
        );

        if (!response.ok) {
          throw new Error(`读取精确引用失败：HTTP ${response.status}`);
        }

        const chunk = (await response.json()) as KnowledgeCitationChunk;

        /**
         * 转换为弹窗统一结构。chunks 只有一项，
         * 因而不会继续展示整篇文档的所有切片。
         */
        return {
          documentId: chunk.documentId,
          fileName: chunk.fileName,
          precise: true,
          chunks: [
            {
              index: chunk.index,
              content: chunk.content,
              characterCount: chunk.characterCount,
              headingPath: chunk.headingPath,
            },
          ],
        };
      }

      /**
       * 兼容历史消息：旧引用没有 chunkId，只能读取整篇文档切片。
       */
      const response = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(documentId)}/chunks`,
        { signal },
      );

      if (!response.ok) {
        throw new Error(`读取历史来源失败：HTTP ${response.status}`);
      }

      const document = (await response.json()) as KnowledgeSourcePreview;

      return {
        documentId: document.documentId,
        fileName: document.fileName,
        precise: false,
        chunks: document.chunks,
      };
    },
  });

  // 历史消息或流式文本变化时，只滚动中间消息区域。
  useEffect(() => {
    const messagesElement = messagesRef.current;
    if (!messagesElement) return;

    messagesElement.scrollTo({
      top: messagesElement.scrollHeight,
      behavior: status === 'streaming' ? 'auto' : 'smooth',
    });
  }, [messages.length, status, streamingText]);

  return (
    <>
      <section className="messages" ref={messagesRef}>
        {messages.map((item) => (
          <MessageArticle
            key={item.id}
            item={item}
            onOpenSource={setSelectedSource}
          />
        ))}
        {streamingText && (
          <article className="agent">
            <div className="sender">
              <span className="agent-icon">✦</span>
              <b>智能客服 Agent</b>
              <Tag>AI</Tag>
            </div>
            <div className="bubble">
              {streamingText}
              {status === 'streaming' && <span className="stream-cursor" />}
            </div>
            {status === 'cancelled' && <time>刚刚 · 生成已停止</time>}
          </article>
        )}
        {status === 'streaming' && !streamingText && (
          <div className="streaming">
            <span /><span /><span /> Agent 正在生成回复
          </div>
        )}
        {status === 'failed' && streamError && (
          <div className="stream-error">AI 回复失败：{streamError}</div>
        )}
      </section>
      <Modal
        title={selectedSource?.title ?? '知识来源'}
        open={Boolean(selectedSource)}
        footer={null}
        width={760}
        onCancel={() => setSelectedSource(null)}
      >
        {sourceLoading ? (
          <Spin />
        ) : sourceError ? (
          <Alert type="error" showIcon message="读取知识来源失败" />
        ) : sourcePreview?.chunks.length ? (
          <div className="knowledge-source-content">
            <p>
              来源文档：{sourcePreview.fileName}
              {' '}
              {sourcePreview.precise ? (
                /**
                 * 新回答带有 chunkId，只展示模型实际使用的知识片段。
                 */
                <Tag color="green">精确引用片段</Tag>
              ) : (
                /**
                 * 历史回答没有 chunkId，只能兼容展示整篇文档切片。
                 */
                <Tag>历史引用 · 全文切片</Tag>
              )}
            </p>
            {sourcePreview.chunks.map((chunk) => (
              <section className="knowledge-preview-chunk" key={chunk.index}>
                <strong>切片 {chunk.index + 1}</strong>
                <p>{chunk.headingPath.join(' → ') || '无标题'}</p>
                <pre>{chunk.content}</pre>
              </section>
            ))}
          </div>
        ) : (
          <Empty description="该文档暂无可查看的切片" />
        )}
      </Modal>
    </>
  );
}

function MessageArticle({
  item,
  onOpenSource,
}: {
  item: LocalMessage;
  onOpenSource: (citation: MessageCitation) => void;
}) {
  return (
    <article className={item.role}>
      <div className="sender">
        {item.role === 'agent' && (
          <>
            <span className="agent-icon">✦</span>
            <b>智能客服 Agent</b>
            <Tag>AI</Tag>
          </>
        )}
      </div>
      <div className="bubble">
        {item.content}
        {item.citations?.map((citation) => (
          <button
            className="citation"
            key={`${citation.source}-${citation.index}`}
            onClick={() => onOpenSource(citation)}
          >
            <BookOutlined />
            <span>
              <b>{citation.title}</b>
              <small>{citation.source}</small>
            </span>
            <em>查看</em>
          </button>
        ))}
      </div>
      <time>{item.time} · 已送达</time>
    </article>
  );
}
