/**
 * IPC Bridge — 替换 chrome.runtime.sendMessage / chrome.runtime.connect
 *
 * 提供与 Chrome 版兼容的 sendMessage 接口，
 * 底层使用 Electron IPC (invoke / on)
 *
 * @module shared/ipc-bridge
 */

import type { ChromeMessage, ChromeResponse, StreamEvent } from '../../utils/types';

/**
 * 发送 IPC 消息，获取响应（替换 chrome.runtime.sendMessage）
 *
 * @param message - 消息对象 (type + payload)
 * @returns ChromeResponse
 */
export async function sendMessage(message: ChromeMessage): Promise<ChromeResponse> {
  const { type, payload, requestId } = message;

  try {
    const data = await window.electronAPI.invoke(type, payload);
    return {
      success: true,
      data,
      requestId,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errMsg,
      requestId,
    };
  }
}

/**
 * 监听流式事件（替换 chrome.runtime.onMessage / port.onMessage）
 *
 * @param callback - 事件到来时的回调
 * @returns 取消监听的函数
 */
export function onStreamEvent(callback: (event: StreamEvent) => void): () => void {
  return window.electronAPI.onStreamEvent((raw: unknown) => {
    callback(raw as StreamEvent);
  });
}

/**
 * 启动流式分析（替换 chrome.runtime.connect + port.postMessage）
 *
 * @param type - 消息类型 (ANALYZE_POOL_STREAM / ANALYZE_SINGLE_STREAM)
 * @param payload - 请求参数
 */
export function startStream(type: string, payload: unknown): void {
  window.electronAPI.startStream(type, payload);
}
