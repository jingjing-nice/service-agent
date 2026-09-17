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
                page }) => {
                /**
 * SSE 身份字段已经由 API 层完成校验，
 * Store 只保存页面展示所需的信息。
 */
                appendStreamingCitation({
                    index,
                    title,
                    source,
                    page
                })

            },
            // 收到完成事件后，将 streamingText 保存为一条正式的 AI 消息。
            onCompleted: () => {
                // 先把完整回答放入本地消息，避免页面出现短暂空白。
                saveAssistantMessage();
                // 请求已经自然结束，不再需要保存关闭函数。
                closeStreamRef.current = null;

                /**
 * 后端已经保存了用户问题和 AI 回答。
 *
 * invalidateQueries 会重新请求：
 * GET /api/conversations/:conversationId/messages
 */
                void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] }).then(() => {
                    // 后端数据加载完成后，清除重复的前端临时消息。
                    clearLocalMessages()
                })
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
