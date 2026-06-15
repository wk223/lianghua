/**
 * SSE 流式处理
 * 解析 DeepSeek API 的 SSE 流式响应，支持逐片回调、中止、汇总
 *
 * @module llm/stream
 */

import {
  LLMStreamChunk,
  StreamCallbacks,
  StreamError,
  StreamResult,
} from './types';
import { logger } from '../utils/logger';

/** SSE 行解析结果 */
type ParseResult =
  | { type: 'data'; value: string }
  | { type: 'done' }
  | { type: 'event'; value: string }
  | { type: 'skip' }
  | { type: 'error'; message: string; raw: string };

/**
 * 解析一行 SSE 文本
 *
 * SSE 格式（DeepSeek / OpenAI）：
 *   data: {"id":"...", ...}
 *   data: [DONE]
 *   event: ...
 *   空行表示一条消息结束
 */
function parseLine(line: string): ParseResult {
  const trimmed = line.trim();

  // 空行 / 注释
  if (!trimmed || trimmed.startsWith(':')) {
    return { type: 'skip' };
  }

  // data: 开头
  if (trimmed.startsWith('data: ')) {
    const value = trimmed.slice(6);
    if (value === '[DONE]') {
      return { type: 'done' };
    }
    return { type: 'data', value };
  }

  // data: 开头（无空格）
  if (trimmed.startsWith('data:')) {
    const value = trimmed.slice(5);
    if (value === '[DONE]') {
      return { type: 'done' };
    }
    return { type: 'data', value };
  }

  // event: 开头
  if (trimmed.startsWith('event: ')) {
    return { type: 'event', value: trimmed.slice(7) };
  }

  // 未知行 — 跳过
  return { type: 'skip' };
}

/**
 * 解析 JSON 字符串为 StreamChunk
 */
function parseChunkJson(raw: string): LLMStreamChunk | null {
  try {
    const parsed = JSON.parse(raw);
    // 校验收到的结构
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.choices)
    ) {
      return parsed as LLMStreamChunk;
    }
    logger.warn('[Stream] 收到非标准 chunk 结构:', raw.slice(0, 200));
    return null;
  } catch {
    logger.warn('[Stream] JSON 解析失败:', raw.slice(0, 200));
    return null;
  }
}

/**
 * 读取 Response body 的 ReadableStream，解析 SSE 并触发回调
 *
 * @param response - fetch 返回的 Response
 * @param callbacks - onChunk / onDone / onError
 * @param signal - 外部中止信号
 * @returns 汇总结果 StreamResult
 */
export async function readStream(
  response: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const { onChunk, onDone, onError } = callbacks;

  // 最终汇总
  let fullContent = '';
  let id = '';
  let model = '';
  let created = 0;
  let finishReason = 'stop';

  // 挂在外部 signal 上
  if (signal?.aborted) {
    const err = new StreamError('流已被外部中止');
    onError?.(err);
    throw err;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const err = new StreamError('响应体不可读（body 为 null）');
    onError?.(err);
    throw err;
  }

  // 内部缓冲区：处理分片 boundary
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      // 检查外部中止
      if (signal?.aborted) {
        const err = new StreamError('流已被外部中止');
        onError?.(err);
        throw err;
      }

      const { done, value } = await reader.read();
      if (done) break;

      // 解码并追加到缓冲区
      const text = decoder.decode(value, { stream: true });
      buffer += text;

      // 按行处理（SSE 以 \n 分隔）
      const lines = buffer.split('\n');
      // 最后一个元素可能是不完整的行，保留到下一次
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const result = parseLine(line);

        switch (result.type) {
          case 'skip':
            break;

          case 'done':
            // 流结束标记
            finishReason = 'stop';
            break;

          case 'data': {
            const chunk = parseChunkJson(result.value);
            if (!chunk) break;

            // 记录元数据（仅在第一条时设置）
            if (!id && chunk.id) id = chunk.id;
            if (!model && chunk.model) model = chunk.model;
            if (!created && chunk.created) created = chunk.created;

            // 提取内容增量
            const choice = chunk.choices?.[0];
            if (choice) {
              const delta = choice.delta?.content ?? '';
              if (delta) {
                fullContent += delta;
              }
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
            }

            // 回调通知
            onChunk?.(chunk, fullContent);
            break;
          }

          case 'event':
            // DeepSeek 不常用 event 字段，记日志备用
            logger.debug('[Stream] SSE event:', result.value);
            break;

          case 'error':
            logger.warn('[Stream] 行解析警告:', result.message);
            break;
        }
      }
    }

    // 处理缓冲区剩余内容（最后一行不带 \n）
    if (buffer.trim()) {
      const result = parseLine(buffer);
      if (result.type === 'data') {
        const chunk = parseChunkJson(result.value);
        if (chunk) {
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) fullContent += delta;
          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
          if (!id && chunk.id) id = chunk.id;
          if (!model && chunk.model) model = chunk.model;
          if (!created && chunk.created) created = chunk.created;
          onChunk?.(chunk, fullContent);
        }
      } else if (result.type === 'done') {
        finishReason = 'stop';
      }
    }

    // 构建最终结果
    const streamResult: StreamResult = {
      fullContent,
      id,
      model,
      created,
      finishReason,
    };

    onDone?.(streamResult);
    return streamResult;
  } catch (error) {
    // 区分中止和其他错误
    if (error instanceof StreamError) {
      onError?.(error);
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      const err = new StreamError('流读取被中止');
      onError?.(err);
      throw err;
    }

    const err = new StreamError(
      error instanceof Error ? error.message : '流读取未知错误',
    );
    onError?.(err);
    throw err;
  } finally {
    reader.releaseLock();
  }
}

/**
 * 从可读流中收集完整响应（不回调，直接返回结果）
 * 用于需要逐片处理但最终只要完整内容的场景
 */
export async function collectStream(
  response: Response,
  signal?: AbortSignal,
): Promise<StreamResult> {
  let fullContent = '';
  let id = '';
  let model = '';
  let created = 0;
  let finishReason = 'stop';

  const reader = response.body?.getReader();
  if (!reader) {
    throw new StreamError('响应体不可读（body 为 null）');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        throw new StreamError('流收集被中止');
      }

      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      buffer += text;

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const result = parseLine(line);
        if (result.type !== 'data') continue;

        const chunk = parseChunkJson(result.value);
        if (!chunk) continue;

        if (!id && chunk.id) id = chunk.id;
        if (!model && chunk.model) model = chunk.model;
        if (!created && chunk.created) created = chunk.created;

        const delta = chunk.choices?.[0]?.delta?.content ?? '';
        if (delta) fullContent += delta;
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }
    }

    return { fullContent, id, model, created, finishReason };
  } finally {
    reader.releaseLock();
  }
}
