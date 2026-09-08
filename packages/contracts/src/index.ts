/** Public conversation state. Internal model reasoning is deliberately excluded. */

import { z } from 'zod'

export type ConversationStatus =
  | 'idle'
  | 'sending'
  | 'streaming'
  | 'waiting_approval'
  | 'human_takeover'
  | 'failed'
  | 'cancelled' // 取消对话
  | 'completed';


export const answerDeltaEventSchema = z.object({
  type: z.literal('answer.delta'), //事件类型，answer.delta表示回答的增量数据
  event_id: z.string(),//事件ID，唯一标识一个事件
  request_id: z.string(),//用户本次提问的编号
  trace_id: z.string(),//当前AI消息编号
  text: z.string()//AI本次新生成的文字
})

export type AnswerDeltaEvent = z.infer<typeof answerDeltaEventSchema>