import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { streamAnswer } from '../api/llm';
import { useWorkbenchStore } from '../stores';


/**
 * 管理一次 AI 流式请求。
 *
 * 负责连接 SSE，并将返回的数据保存到 Zustand。
 */
export function useLlmStream() {

    /**
  * 保存“关闭 SSE 连接”的函数。
  *
  * useRef 保存的数据发生变化时，
  * 不会导致 React 组件重新渲染。
  */
    const closeStreamRef = useRef<(() => void) | null>(null);

    /**
 * React Query 的缓存管理对象。
 *
 * 它可以通知页面某一份接口数据已经过期，
 * 需要重新向后端发起请求。
 */
    const queryClient = useQueryClient();



    // 从 Zustand 中取得流式状态操作方法。
    const startStreaming = useWorkbenchStore(
        (state) => state.startStreaming,
    );

    const startSending = useWorkbenchStore(state => state.startSending)

    const appendStreamingText =
        useWorkbenchStore(
            (state) => state.appendStreamingText,
        );

    const appendStreamingCitation = useWorkbenchStore(state => state.appendStreamingCitation);

    const saveAssistantMessage = useWorkbenchStore(
        (state) => state.saveAssistantMessage,
    );

    const failStreaming = useWorkbenchStore(
        (state) => state.failStreaming,
    );

    const cancelStreaming = useWorkbenchStore(
        (state) => state.cancelStreaming,
    );

    const clearLocalMessages = useWorkbenchStore(state => state.clearLocalMessages)

    /**
     * 开始一次新的 AI 流式请求。
     */
    function startNewStream(conversationId: string, question: string) {
        // 清空上一次的流式数据和错误。
        closeStreamRef.current?.();
        // // 空上一次回答，并将状态设置为 streaming。
        // startStreaming();
        /**
         * 用户已经发起请求，
         * 但后端还没有发送 message.started。
         */
        startSending()
        // 创建新的 SSE 连接。
        closeStreamRef.current = streamAnswer(conversationId, question, {
            /**
 * 后端发送 message.started 后，
 * 表示请求已经被接受并开始处理。
 */

            onStart: () => {
                startStreaming()
            },
            //  // 每收到一小段文字，就追加到 Zustand。
            onText: (text) => {
                appendStreamingText(text);
            },
            onCitation: ({ index,
                title,
                source,
                chunkId,
                page }) => {
                /**
 * SSE 身份字段已经由 API 层完成校验，
 * Store 只保存页面展示所需的信息。
 *
 * chunkId 用于点击来源时只读取模型实际使用的切片；
 * 旧消息没有该字段时，来源弹窗仍会降级展示整篇文档切片。
 */
                appendStreamingCitation({
                    index,
                    title,
                    source,
                    chunkId,
                    page
                })

            },
            // 收到完成事件后，将 streamingText 保存为一条正式的 AI 消息。
            /**
        * SSE 收到 message.completed 后执行。
        *
        * 此时后端已经完成：
        * 1. 保存客户消息；
        * 2. 保存 AI 回答；
        * 3. 保存引用；
        * 4. 更新会话最近消息和最近消息时间。
        */
            onCompleted: () => {
                /**
                 * 先把完整流式回答转换成一条本地正式消息。
                 *
                 * 在 React Query 重新请求数据库期间，
                 * 页面仍然可以立即显示完整回答，不会短暂消失。
                 */
                saveAssistantMessage();

                /**
                 * SSE 已经正常结束，
                 * 不再需要保留关闭连接的函数。
                 */
                closeStreamRef.current = null;

                /**
                 * 同时刷新消息详情和会话列表。
                 *
                 * 消息接口刷新后，中间聊天区域会使用数据库数据；
                 * 会话列表刷新后，左侧 preview 和 time 会立即更新。
                 */
                void Promise.all([
                    /**
                     * 重新请求：
                     * GET /api/conversations/:conversationId/messages
                     */
                    queryClient.invalidateQueries({
                        queryKey: ['messages', conversationId],
                    }),

                    /**
                     * 重新请求：
                     * GET /api/conversations
                     *
                     * WorkbenchPage 当前使用的会话列表 queryKey
                     * 必须与这里保持一致。
                     */
                    queryClient.invalidateQueries({
                        queryKey: ['conversations'],
                    }),
                ]).then(() => {
                    /**
                     * 等数据库中的会话和消息都加载完成后，
                     * 再清除 Zustand 中的临时消息。
                     *
                     * 这样可以避免清除过早导致聊天区域闪烁。
                     */
                    clearLocalMessages();
                });
            },
            onError: (error) => {
                failStreaming(error.message);
                closeStreamRef.current = null;
            },
            onFailed: (event) => {
                failStreaming(event.message);
                // message.failed 是终止事件，连接已经不会再产生新消息。
                closeStreamRef.current = null;
            }
        });
    }

    /**
 * 主动停止当前流式请求。
 */
    function stopStream() {
        // 关闭浏览器与后端之间的 SSE 连接。
        closeStreamRef.current?.();
        // 清除引用，避免之后重复关闭同一条连接。
        closeStreamRef.current = null;
        // 通知页面本次生成是用户主动停止，而不是请求失败。
        cancelStreaming();
    }

    /**
    * 使用该 Hook 的组件被销毁时，
    * 自动关闭 SSE，避免后台连接一直存在。
    */
    useEffect(() => {
        return () => {
            closeStreamRef.current?.();
        };
    }, []);
    return {
        startNewStream,
        stopStream,
    };
}
