import type { Conversation, Message, MessageCitation } from '../types/conversation';

const conversations: Conversation[] = [
  { id: 'c1', name: '陈悦', channel: '微信', topic: '退款咨询', preview: 'AI 正在查询退款进度，请稍候…', time: '10:42', unread: 2, state: 'streaming' },
  { id: 'c2', name: '张先生', channel: '网页', topic: '物流异常', preview: '好的，我帮您确认配送情况', time: '10:36', state: 'human_takeover' },
  { id: 'c3', name: '李沐阳', channel: 'App', topic: '产品使用', preview: '如何修改企业账号的管理员？', time: '10:28', unread: 1, state: 'idle' },
  { id: 'c4', name: '周可', channel: '网页', topic: '发票申请', preview: '电子发票已发送至您的邮箱', time: '09:55', state: 'completed' },
];

const delay = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 180));


/**
 * 后端消息接口返回的数据结构。
 *
 * 后端返回 createdAt，前端页面使用的是格式化后的 time。
 */
type BackendMessage = {
  id: string;
  conversationId: string;
  role: 'customer' | 'agent';
  content: string;
  createdAt: string;
  citations?: MessageCitation[];
};


/**
 * 从后端查询指定会话的消息。
 */


async function getMessages(conversationId: string): Promise<Message[]> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`)

  // fetch 遇到 400 或 500 时不会自动抛出错误，
  // 因此需要手动检查 HTTP 状态。
  if (!response.ok) {
    throw new Error(`获取会话消息失败：${response.status}`);
  }
  const data = (await response.json()) as BackendMessage[];
  // 将后端格式转换为页面需要的 Message 格式。
  return data.map((item) => ({
    id: item.id,
    role: item.role,
    content: item.content,
    citations: item.citations,

    // 后端保存的是 ISO 时间，这里转换为页面显示的小时和分钟。
    time: new Date(item.createdAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  }));
}


export const conversationApi = {
  list: () => delay(conversations),
  messages: getMessages
};
