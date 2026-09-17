import type { Conversation, LocalMessage } from '../types/conversation';
import { ChatComposer } from './ChatComposer';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';

type ChatPanelProps = {
  active?: Conversation;
  messages: LocalMessage[];
};

export function ChatPanel({ active, messages }: ChatPanelProps) {
  return (
    <main className="chat">
      <ChatHeader active={active} />
      <ChatMessages messages={messages} />
      <ChatComposer />
    </main>
  );
}
