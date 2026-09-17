import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { conversationApi } from '../api/conversations';
import { ChatPanel } from '../components/ChatPanel';
import { ConversationInbox } from '../components/ConversationInbox';
import { CustomerDetails } from '../components/CustomerDetails';
import { KnowledgePreviewModal } from '../components/KnowledgePreviewModal';
import { WorkbenchRail } from '../components/WorkbenchRail';
import { useWorkbenchStore } from '../stores';

export function WorkbenchPage() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const activeId = useWorkbenchStore((state) => state.activeId);
  const detailOpen = useWorkbenchStore((state) => state.detailOpen);
  const localMessages = useWorkbenchStore((state) => state.localMessages);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: conversationApi.list,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', activeId],
    queryFn: () => conversationApi.messages(activeId),
  });

  // 后端历史消息与当前页面尚未同步的消息一起展示。
  const displayedMessages = [...messages, ...localMessages];
  const active =
    conversations.find((item) => item.id === activeId) ?? conversations[0];

  return (
    <div className={`workbench ${detailOpen ? '' : 'detail-hidden'}`}>
      <WorkbenchRail onOpenKnowledge={() => setPreviewOpen(true)} />
      <ConversationInbox conversations={conversations} />
      <ChatPanel active={active} messages={displayedMessages} />
      <CustomerDetails />
      <KnowledgePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
