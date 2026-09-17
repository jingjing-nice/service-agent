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
  } = useQuery<KnowledgeSourcePreview>({
    queryKey: ['knowledge-source', selectedSource?.source],
    enabled: Boolean(selectedSource),
    queryFn: async ({ signal }) => {
      const documentId = selectedSource?.source;
      if (!documentId) throw new Error('缺少来源文档 ID');
      const response = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(documentId)}/chunks`,
        { signal },
      );
      if (!response.ok) throw new Error(`读取来源失败：HTTP ${response.status}`);
      return (await response.json()) as KnowledgeSourcePreview;
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
            <p>来源文档：{sourcePreview.fileName}</p>
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
