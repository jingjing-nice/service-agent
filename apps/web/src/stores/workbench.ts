// create 是 Zustand 提供的 Store 创建函数。
// Store 可以理解为多个 React 组件共同使用的“公共数据仓库”。
import { create } from 'zustand';
import type { ConversationStatus, LocalMessage, MessageCitation } from '../types/conversation';


/**
 * 客服工作台的全局状态结构。
 *
 * 这里既声明页面需要保存的数据，也声明修改这些数据的方法。
 * 它只是 TypeScript 类型，不会在浏览器中生成实际数据。
 */
type WorkbenchState = {
  /** 当前选中的会话 ID，例如 c1、c2。 */
  activeId: string;

  /** 当前会话的处理状态，例如 idle、streaming、completed 或 failed。 */
  status: ConversationStatus;

  /** 是否显示工作台右侧的客户详情面板。 */
  detailOpen: boolean;

  /**
   * 当前 AI 回复已经生成的文字。
   * SSE 每返回一个文字片段，都会将它追加到这个字符串后面。
   */
  streamingText: string;
  /**
   * 当前正在生成的回答已经收到的知识引用。
   *
   * 它和 streamingText 一样属于临时状态，
   * 只有收到 message.completed 后才写入正式消息。
   */
  streamingCitations: MessageCitation[]

  /** 流式请求失败时的错误信息；null 表示当前没有错误。 */
  streamError: string | null;

  /**
   * 切换当前会话，并同步该会话的状态。
   * @param id 新选中的会话 ID
   * @param status 新会话当前所处的状态
   */
  select: (id: string, status: ConversationStatus) => void;

  /** 只修改当前会话状态，不切换会话。 */
  setStatus: (status: ConversationStatus) => void;

  /** 在显示和隐藏之间切换右侧客户详情面板。 */
  toggleDetail: () => void;

  /** 开始新的 AI 回复，并清空上一次生成的文字和错误。 */
  startStreaming: () => void;

  /**
 * 开始向后端发送用户请求。
 *
 * 此时请求已经由前端发出，
 * 但后端还没有发送 message.started 事件。
 */
  startSending: () => void;

  /**
   * 将模型新返回的一小段文字追加到当前 AI 回复。
   * @param text 本次 answer.delta 事件携带的文字
   */
  appendStreamingText: (text: string) => void;

  appendStreamingCitation: (citation: MessageCitation) => void


  /**
   * 将会话标记为生成失败，并保存错误原因。
   * @param message 展示给用户或开发者的错误信息
   */
  failStreaming: (message: string) => void;

  /**
   * 将会话标记为取消状态。
  */
  cancelStreaming: () => void;

  /**
   * 当前页面产生的本地消息，包括用户消息和已经完成的 AI 回复。
   * 它与接口加载的历史消息分开保存，方便后续逐步接入后端持久化。
   */
  localMessages: LocalMessage[];

  /** 将当前刚发送的问题作为 customer 消息加入列表。 */
  addUserMessage: (content: string) => void;

  /** 将已经生成完毕的 AI 回答加入本地消息历史。 */
  saveAssistantMessage: () => void;


  /**
   * 清空已经同步到后端的临时消息。
   */
  clearLocalMessages: () => void

};



/** 生成消息列表使用的 24 小时时间文本，例如 10:35。 */
function createMessageTime() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}


/**
 * 客服工作台 Store。
 *
 * React 组件通过 useWorkbenchStore 读取状态或调用方法。
 * 状态变化后，使用了对应状态的组件会自动重新渲染。
 */
export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  // 页面首次打开时，默认选中 c1 会话。
  activeId: 'c1',

  // 初始状态为空闲，表示 AI 尚未开始生成回复。
  status: 'idle',

  // 页面首次打开时显示右侧客户详情。
  detailOpen: true,

  // 尚未收到 AI 返回内容，所以初始值为空字符串。
  streamingText: '',

  streamingCitations: [],

  // 尚未发生错误，所以初始值为 null。
  streamError: null,

  // 页面首次打开时还没有本轮新消息。
  localMessages: [],

  // 参数名与状态字段名相同时，可以使用 { activeId, status } 简写。
  select: (activeId, status) =>
    set({
      activeId,
      status,
    }),

  // set() 会将传入字段合并到当前 Store，不会删除其他状态。
  setStatus: (status) =>
    set({
      status,
    }),

  // 这里需要读取修改前的值，因此向 set() 传入回调函数。
  toggleDetail: () =>
    set((state) => ({
      // ! 表示取反：true 变 false，false 变 true。
      detailOpen: !state.detailOpen,
    })),
  /**
 * 用户点击发送后，先进入 sending 状态。
 *
 * 新请求开始时，需要清空上一次请求留下的
 * 流式文本和错误信息。
 */
  startSending: () => set({
    // 表示请求正在从前端发送到后端。
    status: 'sending',
    // 清空上一轮尚未处理完的流式文字。
    streamingText: '',
    // 清空上一轮请求的错误信息。
    streamError: null
  }),

  // 新一轮生成必须清空旧答案，避免两次回答拼接到一起。
  startStreaming: () =>
    set({
      status: 'streaming',
      streamingText: '',
      streamError: null,
    }),


  // 使用之前的 streamingText 加上本次 text，形成逐步增长的回答。
  appendStreamingText: (text) =>
    set((state) => ({
      streamingText: state.streamingText + text,
    })),

  appendStreamingCitation: (citation) =>
    set((state) => {
      /**
       * index 是一条回答中的引用编号。
       * 如果后端意外重复发送相同引用，这里不再次添加。
       */
      const alreadyExists =
        state.streamingCitations.some(
          (item) => item.index === citation.index,
        );

      if (alreadyExists) {
        return state;
      }

      return {
        streamingCitations: [
          ...state.streamingCitations,
          citation,
        ],
      };
    }),


  // 用户点击停止按钮后，只改变生成状态，并保留已经收到的文字。
  cancelStreaming: () =>
    set({
      status: 'cancelled',
    }),

  // SSE 或模型调用失败后，将状态改为 failed，并记录错误原因。
  failStreaming: (message) =>
    set({
      status: 'failed',
      streamError: message,
    }),



  // 使用函数形式的 set 读取旧消息，再把新用户消息追加到数组末尾。
  addUserMessage: (content) =>
    set((state) => ({
      localMessages: [
        // 展开旧数组，避免发送新消息时覆盖之前的消息。
        ...state.localMessages,
        {
          // 浏览器原生 API 生成唯一 ID，不需要额外安装依赖。
          id: crypto.randomUUID(),
          role: 'customer',
          content,
          time: createMessageTime(),
        },
      ],
    })),

  // SSE 完成后，把临时的 streamingText 转成一条正式的本地消息。
  saveAssistantMessage: () =>
    set((state) => {
      // 去掉首尾空白，避免把只有空格的回答保存下来。
      const content = state.streamingText.trim();

      // 模型没有返回有效内容时，不创建空消息。
      if (!content) {
        return {
          status: 'completed',
          streamingCitations: []
        };
      }

      return {
        status: 'completed',
        localMessages: [
          // 保留用户消息以及之前已经完成的 AI 回复。
          ...state.localMessages,
          {
            id: crypto.randomUUID(),
            role: 'agent',
            content,
            time: createMessageTime(),
            /**
          * 没有引用时保持字段缺省，
          * 避免生成 citations: [] 这种无意义数据。
          */
            citations: state.streamingCitations.length > 0 ? state.streamingCitations : undefined,
          },
        ],
        // 回答已经进入 localMessages，清空临时文本可防止页面重复显示。
        streamingText: '',
        streamingCitations: []

      };
    }),

  // 后端消息重新加载成功后，删除前端重复的临时消息。

  clearLocalMessages: () =>
    set({
      localMessages: [],
    }),
}));
