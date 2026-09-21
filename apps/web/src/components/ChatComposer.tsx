import { useState } from 'react';
import { Button, Input } from 'antd';
import { PaperClipOutlined, SendOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useLlmStream } from '../hooks';
import { useWorkbenchStore } from '../stores';

export function ChatComposer() {
  const [input, setInput] = useState('');
  const activeId = useWorkbenchStore((state) => state.activeId);
  const status = useWorkbenchStore((state) => state.status);
  const addUserMessage = useWorkbenchStore((state) => state.addUserMessage);
  const { startNewStream, stopStream } = useLlmStream();
  const requestInProgress = status === 'streaming' || status === 'sending';
  /** 没有真实会话 ID 时不能调用消息或 SSE 接口。 */
  const hasActiveConversation = Boolean(activeId);

  /**
   * 人工接管目前还没有“客服人工消息”后端接口。
   * 在接口实现前禁止复用 AI SSE，避免界面显示人工回复但实际由模型回答。
   */
  const aiSendingDisabled =
    !hasActiveConversation || status === 'human_takeover';

  const send = () => {
    const question = input.trim();
    if (!question || requestInProgress || aiSendingDisabled) return;

    // 先展示用户消息，再启动 SSE 请求。
    addUserMessage(question);
    setInput('');
    startNewStream(activeId, question);
  };

  return (
    <footer>
      {status === 'human_takeover' && (
        <div className="takeover"><i />你正在人工接管此会话</div>
      )}
      <div className="composer">
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder={
            !hasActiveConversation
              ? '请先新建或选择一个会话'
              : status === 'human_takeover'
                ? '人工回复接口尚未接入，请先交还 AI'
                : '输入问题，检索知识库后生成回答；按 Enter 发送…'
          }
          value={input}
          disabled={aiSendingDisabled}
          onChange={(event) => setInput(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div>
          <span>
            <Button type="text" icon={<PaperClipOutlined />} />
            <Button type="text" icon={<ThunderboltOutlined />} />
          </span>
          <span className="mode">
            <i />
            {status === 'human_takeover' ? '人工接管中' : 'AI 自动回复'}
          </span>
          {requestInProgress ? (
            <Button
              danger
              type="primary"
              shape="circle"
              icon={<StopOutlined />}
              onClick={stopStream}
              aria-label={status === 'sending' ? '停止发送' : '停止生成'}
            />
          ) : (
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              onClick={send}
              disabled={aiSendingDisabled || !input.trim()}
              aria-label="发送消息"
            />
          )}
        </div>
      </div>
      <small>AI 生成内容可能存在误差，请结合业务信息判断</small>
    </footer>
  );
}
