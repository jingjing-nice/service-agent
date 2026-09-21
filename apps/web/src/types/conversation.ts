export type {
    ConversationStatus
} from '@service-agent/contracts';
import type { ConversationStatus, CitationEvent } from '@service-agent/contracts';

/**
 * 页面真正需要保存的引用信息。
 *
 * 不保存 request_id、trace_id、message_id 等传输字段，
 * 因为这些字段用于校验 SSE，不属于消息展示内容。
 */
/**
 * 页面展示引用时需要的数据。
 *
 * chunkId 暂时声明为可选：
 * - 新回答接入精确引用协议后会携带该字段；
 * - 已经保存的历史回答只有 documentId，需要继续兼容。
 */
export type MessageCitation = Pick<
    CitationEvent,
    'index' | 'title' | 'source' | 'page'
> & {
    chunkId?: string;
}

export type Conversation = { id: string; name: string; channel: string; topic: string; preview: string; time: string; unread?: number; state: ConversationStatus };
export type Message = { id: string; role: 'customer' | 'agent'; content: string; time: string; citations?: MessageCitation[] };


/**
 * 用户在当前页面中新发送或新生成的消息。
 *
 * 这些消息目前只保存在 Zustand 内存中，刷新页面后会消失；
 * 后续接入消息保存接口时，可以把它们持久化到后端数据库。
 */
export type LocalMessage = {
    /** 消息的唯一编号，用作 React 列表的 key。 */
    id: string;

    /** customer 表示用户消息，agent 表示 AI 回复。 */
    role: 'agent' | 'customer';

    /** 消息正文。 */
    content: string;

    /** 页面上显示的发送时间，例如 10:35。 */
    time: string;

    /** AI 回答引用的知识来源；普通用户消息通常没有该字段。 */
    citations?: MessageCitation[];
}
