import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { conversationApi } from '../api/conversations';
import { ChatPanel } from '../components/ChatPanel';
import { ConversationInbox } from '../components/ConversationInbox';
import { KnowledgePreviewModal } from '../components/KnowledgePreviewModal';
import { WorkbenchRail } from '../components/WorkbenchRail';
import { RefundApprovalModal } from '../components/RefundApprovalModal';
import { useWorkbenchStore } from '../stores';

export function WorkbenchPage() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [refundApprovalOpen, setRefundApprovalOpen] = useState(false);
  const activeId = useWorkbenchStore((state) => state.activeId);
  const selectConversation = useWorkbenchStore((state) => state.select);
  const localMessages = useWorkbenchStore((state) => state.localMessages);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: conversationApi.list,
  });

  /**
   * 首次加载真实会话后自动选中第一条。
   *
   * 同时处理当前会话被服务端删除或不再出现在列表中的情况，
   * 避免继续使用无效 conversationId 请求消息和 SSE 接口。
   */
  useEffect(() => {
    if (conversations.length === 0) return;

    const activeConversation = conversations.find(
      (conversation) => conversation.id === activeId,
    );

    if (!activeConversation) {
      const firstConversation = conversations[0];
      selectConversation(firstConversation.id, firstConversation.state);
    }
  }, [activeId, conversations, selectConversation]);

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', activeId],
    queryFn: () => conversationApi.messages(activeId),

    /**
     * 会话列表返回真实 UUID 前不发送消息请求，
     * 防止页面首次渲染时请求空 ID 或历史模拟 ID。
     */
    enabled: Boolean(activeId),
  });

  // 后端历史消息与当前页面尚未同步的消息一起展示。
  const displayedMessages = [...messages, ...localMessages];
  /**
   * 只使用与 activeId 对应的真实会话。
   * 自动选择生效前暂时返回 undefined，由 ChatPanel 展示空状态。
   */
  const active = conversations.find((item) => item.id === activeId);

  return (
    <div className="workbench">
      <WorkbenchRail
        onOpenKnowledge={() => setPreviewOpen(true)}
        onOpenRefunds={() => setRefundApprovalOpen(true)}
      />
      <ConversationInbox conversations={conversations} />
      <ChatPanel active={active} messages={displayedMessages} />
      <KnowledgePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
      <RefundApprovalModal
        open={refundApprovalOpen}
        onClose={() => setRefundApprovalOpen(false)}
      />
    </div>
  );
}
