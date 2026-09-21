import type {
  Conversation,
  Message,
  MessageCitation,
} from '../types/conversation';

/**
 * 后端会话列表接口返回的数据结构。
 *
 * 后端返回的是领域数据；
 * 当前工作台使用的是适合页面展示的 Conversation 类型。
 */
type BackendConversation = {
  /// 会话唯一编号。
  id: string;

  /// 客户业务编号。
  customerId: string;

  /// 客服工作台展示的客户名称。
  customerName: string;

  /// 会话来源渠道，例如 WEB、APP、WECHAT。
  channel: string;

  /// 会话主题，新会话可能没有主题。
  topic?: string;

  /// 后端已经转换成前端可识别的小写状态。
  status: Conversation['state'];

  /// 最近一条消息的摘要。
  preview: string;

  /// 最近一条消息的时间；新会话可能没有该字段。
  lastMessageAt?: string;

  /// 会话创建时间。
  createdAt: string;
};

/**
 * 后端消息接口返回的数据结构。
 */
type BackendMessage = {
  /// 消息唯一编号。
  id: string;

  /// 消息所属会话。
  conversationId: string;

  /// 消息发送者。
  role: 'customer' | 'agent' | 'system';

  /// 消息正文。
  content: string;

  /// 消息创建时间。
  createdAt: string;

  /// AI 回答引用的知识来源。
  citations?: MessageCitation[];
};

/**
 * 后端统一错误响应的基础结构。
 *
 * 接口异常时优先显示后端提供的公开 message，
 * 无法解析时再使用前端默认错误信息。
 */
type BackendError = {
  code?: string;
  message?: string;
};

/** 创建会话时由页面提供的业务字段。 */
export type CreateConversationInput = {
  /** 客服工作台展示的客户名称。 */
  customerName: string;

  /** 会话来源渠道，例如 WEB、APP 或 WECHAT。 */
  channel: string;

  /** 本次咨询主题；允许不填写。 */
  topic?: string;
};

/**
 * 将 ISO 时间转换为客服工作台显示的小时和分钟。
 *
 * @param value ISO 8601 时间字符串
 * @returns 示例：12:08
 */
function formatTime(value: string): string {
  const date = new Date(value);

  /**
   * 无效时间不应该导致页面崩溃。
   *
   * 正常情况下后端总会返回合法 ISO 时间，
   * 这里保留降级结果便于发现异常数据。
   */
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * 将后端会话结构转换为工作台展示结构。
 *
 * 列表查询和新建接口共用同一转换函数，
 * 避免两个入口对空主题、时间等字段处理不一致。
 */
function toConversation(item: BackendConversation): Conversation {
  return {
    id: item.id,
    name: item.customerName,
    channel: item.channel,
    topic: item.topic ?? '新会话',
    preview: item.preview,
    time: formatTime(item.lastMessageAt ?? item.createdAt),
    state: item.status,
  };
}

/**
 * 从失败响应中读取公开错误信息。
 *
 * Response Body 只能读取一次，
 * 因此统一在该函数中完成解析。
 */
async function getErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as BackendError;

    if (
      typeof body.message === 'string' &&
      body.message.trim()
    ) {
      return body.message;
    }
  } catch {
    /**
     * 响应不一定是 JSON。
     *
     * 例如开发代理异常时，Vite 可能返回纯文本或 HTML。
     * 这种情况直接使用 fallback。
     */
  }

  return fallback;
}

/**
 * 查询当前租户的真实会话列表。
 *
 * 该方法替换原有的前端静态模拟数组。
 */
async function listConversations(): Promise<Conversation[]> {
  const response = await fetch('/api/conversations', {
    method: 'GET',

    /**
     * 当前接口没有请求体，
     * Accept 用于声明前端期望 JSON 响应。
     */
    headers: {
      Accept: 'application/json',
    },
  });

  /**
   * fetch 遇到 HTTP 400 或 500 不会自动抛出异常，
   * 必须主动检查 response.ok。
   */
  if (!response.ok) {
    const message = await getErrorMessage(
      response,
      `获取会话列表失败：${response.status}`,
    );

    throw new Error(message);
  }

  const data =
    (await response.json()) as BackendConversation[];

  /**
   * 将后端领域结构转换成当前页面的展示结构。
   *
   * 这样页面组件不需要了解数据库字段名称。
   */
  return data.map(toConversation);
}

/**
 * 创建一条真实会话。
 *
 * customerId 由浏览器生成，仅作为当前演示项目的客户业务编号；
 * tenantId 仍然由后端上下文决定，浏览器不能指定租户。
 */
async function createConversation(
  input: CreateConversationInput,
): Promise<Conversation> {
  const response = await fetch('/api/conversations', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customerId: `web-${crypto.randomUUID()}`,
      customerName: input.customerName.trim(),
      channel: input.channel,
      topic: input.topic?.trim() || undefined,
    }),
  });

  if (!response.ok) {
    const message = await getErrorMessage(
      response,
      `创建会话失败：${response.status}`,
    );
    throw new Error(message);
  }

  return toConversation(
    (await response.json()) as BackendConversation,
  );
}

/**
 * 查询指定会话的历史消息。
 *
 * @param conversationId 会话 UUID
 * @returns 按时间正序排列的页面消息
 */
async function getMessages(
  conversationId: string,
): Promise<Message[]> {
  /**
   * encodeURIComponent 防止特殊字符破坏 URL。
   *
   * 当前 conversationId 是 UUID，
   * 保留编码逻辑可以提高函数的健壮性。
   */
  const encodedConversationId =
    encodeURIComponent(conversationId);

  const response = await fetch(
    `/api/conversations/${encodedConversationId}/messages`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    const message = await getErrorMessage(
      response,
      `获取会话消息失败：${response.status}`,
    );

    throw new Error(message);
  }

  const data = (await response.json()) as BackendMessage[];

  return data
    /**
     * system 消息用于记录内部流程状态，
     * 暂时不作为普通聊天气泡展示。
     */
    .filter(
      (
        item,
      ): item is BackendMessage & {
        role: 'customer' | 'agent';
      } => item.role !== 'system',
    )

    /**
     * 将后端消息转换成聊天组件需要的结构。
     */
    .map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      citations: item.citations,
      time: formatTime(item.createdAt),
    }));
}

/**
 * 会话相关的前端 API。
 *
 * 页面通过该对象调用真实后端，
 * 不再依赖前端静态模拟数据。
 */
export const conversationApi = {
  /// 创建一条新会话。
  create: createConversation,

  /// 查询会话列表。
  list: listConversations,

  /// 查询指定会话的历史消息。
  messages: getMessages,
};
