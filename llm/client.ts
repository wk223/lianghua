/**
 * DeepSeek API 客户端
 * API Key 管理、非流式/流式 chat completion、超时控制、错误重试
 *
 * 兼容 OpenAI SDK 请求格式，endpoint: https://api.deepseek.com/v1/chat/completions
 *
 * @module llm/client
 */

import {
  APIError,
  AuthError,
  DEFAULT_CONFIG,
  DeepSeekConfig,
  LLMError,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  RateLimitError,
  RequestOptions,
  StreamCallbacks,
  StreamResult,
  TimeoutError,
} from './types';
import { readStream } from './stream';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

// ─── Chrome Storage Key ───────────────────────────────

/** Storage 中保存 API Key 的键名 */
const STORAGE_KEY_API_KEY = 'deepseek_api_key';

// ─── Storage API Key 管理器 ───────────────────────────

/**
 * API Key 管理器
 * 从 Chrome Storage 读取 Key（带缓存），也支持显式设置/清除
 *
 * Storage 路径: chrome.storage.local['deepseek_api_key']
 */
export class StorageKeyManager {
  private cachedKey: string | null = null;

  /**
   * 获取 API Key
   * 优先级: 1) 构造函数传入 2) Chrome Storage 3) 环境变量 fallback
   */
  async getKey(): Promise<string> {
    // 内存缓存
    if (this.cachedKey) return this.cachedKey;

    // Chrome Extension 环境 — 从 chrome.storage.local 读取
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY_API_KEY);
        const key = result[STORAGE_KEY_API_KEY] as string | undefined;
        if (key && key.trim()) {
          this.cachedKey = key.trim();
          return this.cachedKey;
        }
      } catch (err) {
        logger.warn('[KeyManager] 读取 Chrome Storage 失败:', err);
      }
    }

    // 开发环境 fallback — 通过 globalThis 获取环境变量（兼容 Node/无 Node）
    try {
      const env = (globalThis as any)?.process?.env;
      const envKey: string | undefined = env?.DEEPSEEK_API_KEY;
      if (envKey && envKey.trim()) {
        this.cachedKey = envKey.trim();
        return this.cachedKey;
      }
    } catch {
      // 非 Node 环境忽略
    }

    throw new AuthError('API Key 未配置。请在扩展设置中填入 DeepSeek API Key。');
  }

  /** 设置 API Key（写入 Chrome Storage + 内存缓存） */
  async setKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
      throw new AuthError('API Key 不能为空');
    }

    this.cachedKey = trimmed;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_API_KEY]: trimmed });
    }

    logger.info('[KeyManager] API Key 已更新');
  }

  /** 清除 API Key（从 Storage + 缓存） */
  async clearKey(): Promise<void> {
    this.cachedKey = null;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove(STORAGE_KEY_API_KEY);
    }

    logger.info('[KeyManager] API Key 已清除');
  }

  /** 检查是否已配置 Key */
  async hasKey(): Promise<boolean> {
    try {
      const key = await this.getKey();
      return key.length > 0;
    } catch {
      return false;
    }
  }
}

// ─── DeepSeek API 客户端 ──────────────────────────────

export class DeepSeekClient {
  private keyManager: StorageKeyManager;
  private config: DeepSeekConfig;

  constructor(config?: Partial<DeepSeekConfig>) {
    this.keyManager = new StorageKeyManager();
    this.config = {
      baseUrl: DEFAULT_CONFIG.BASE_URL,
      model: DEFAULT_CONFIG.MODEL,
      maxTokens: DEFAULT_CONFIG.MAX_TOKENS,
      temperature: DEFAULT_CONFIG.TEMPERATURE,
      timeout: DEFAULT_CONFIG.TIMEOUT,
      ...config,
    };
  }

  // ─── 配置 ──────────────────────────────────────────

  /** 更新客户端配置 */
  setConfig(partial: Partial<DeepSeekConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** 获取 KeyManager 引用（用于外部调用 setKey/clearKey） */
  getKeyManager(): StorageKeyManager {
    return this.keyManager;
  }

  // ─── 内部工具 ──────────────────────────────────────

  /** 构建请求头 */
  private async buildHeaders(): Promise<Record<string, string>> {
    const apiKey = this.config.apiKey || (await this.keyManager.getKey());

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  /** 构建请求体 */
  private buildRequest(
    messages: LLMMessage[],
    options?: { stream?: boolean } & RequestOptions,
  ): LLMRequest {
    return {
      model: this.config.model ?? DEFAULT_CONFIG.MODEL,
      messages,
      stream: options?.stream ?? false,
      max_tokens: this.config.maxTokens ?? DEFAULT_CONFIG.MAX_TOKENS,
      temperature: this.config.temperature ?? DEFAULT_CONFIG.TEMPERATURE,
    };
  }

  /** 构建完整 messages（插入 system prompt） */
  private buildMessages(userMessages: LLMMessage[]): LLMMessage[] {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      ...userMessages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
    ];
  }

  /** 处理 HTTP 响应错误 → 抛出类型化错误 */
  private async handleResponseError(response: Response): Promise<never> {
    const status = response.status;
    let bodyText = '';

    try {
      bodyText = await response.text();
    } catch {
      bodyText = '(无法读取响应体)';
    }

    // 401 —— API Key 问题
    if (status === 401) {
      throw new AuthError(
        bodyText.includes('Incorrect API key')
          ? 'API Key 错误，请检查设置'
          : 'API 认证失败',
      );
    }

    // 429 —— 速率限制
    if (status === 429) {
      const retryAfter = response.headers.get('retry-after-ms')
        ? parseInt(response.headers.get('retry-after-ms')!, 10)
        : response.headers.get('Retry-After')
          ? parseInt(response.headers.get('Retry-After')!, 10) * 1000
          : undefined;

      throw new RateLimitError(retryAfter);
    }

    // 4xx —— 客户端错误（大部分不可重试）
    if (status >= 400 && status < 500) {
      throw new APIError(
        `请求被拒绝 (${status}): ${bodyText.slice(0, 300)}`,
        status,
        bodyText,
      );
    }

    // 5xx —— 服务端错误（可重试）
    if (status >= 500) {
      throw new APIError(
        `DeepSeek 服务端错误 (${status})`,
        status,
        bodyText,
      );
    }

    // 其他
    throw new APIError(`HTTP ${status}: ${bodyText.slice(0, 200)}`, status, bodyText);
  }

  // ─── 非流式调用 ────────────────────────────────────

  /**
   * 非流式 Chat Completion
   *
   * - 完整 system prompt + user messages
   * - 超时控制
   * - 自动重试（可重试错误用指数退避）
   * - 返回完整 LLMResponse
   *
   * @param messages - 用户消息列表
   * @param options  - 超时/重试/中止选项
   */
  async chat(
    messages: LLMMessage[],
    options?: RequestOptions,
  ): Promise<LLMResponse> {
    const timeoutMs = options?.timeout ?? this.config.timeout ?? DEFAULT_CONFIG.TIMEOUT;
    const allMessages = this.buildMessages(messages);
    const body = this.buildRequest(allMessages, { stream: false });

    logger.debug('[DeepSeek] 非流式请求:', {
      model: body.model,
      messages: body.messages.length,
      maxTokens: body.max_tokens,
    });

    const execute = async (): Promise<LLMResponse> => {
      const controller = new AbortController();

      // 合并外部 signal + 超时
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const combinedSignal = options?.signal
        ? combineSignals(options.signal, controller.signal)
        : controller.signal;

      try {
        const headers = await this.buildHeaders();

        const response = await fetch(
          `${this.config.baseUrl ?? DEFAULT_CONFIG.BASE_URL}/chat/completions`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: combinedSignal,
          },
        );

        if (!response.ok) {
          await this.handleResponseError(response);
        }

        const data: LLMResponse = await response.json();

        logger.debug('[DeepSeek] 非流式响应:', {
          id: data.id,
          model: data.model,
          usage: data.usage,
          contentLength: data.choices?.[0]?.message?.content?.length ?? 0,
        });

        return data;
      } catch (error) {
        if (error instanceof LLMError) throw error;

        // 超时
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new TimeoutError(timeoutMs);
        }

        throw new APIError(
          error instanceof Error ? error.message : '未知请求错误',
          0,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // 使用 withRetry 处理可重试错误
    return withRetry(execute, {
      maxRetries: options?.retries ?? DEFAULT_CONFIG.MAX_RETRIES,
      baseDelay: options?.retryBaseDelay ?? DEFAULT_CONFIG.RETRY_BASE_DELAY,
      maxDelay: options?.retryMaxDelay ?? DEFAULT_CONFIG.RETRY_MAX_DELAY,
      onRetry: (error, attempt) => {
        logger.warn(
          `[DeepSeek] 请求重试 #${attempt + 1} 原因: ${error.message}`,
        );
      },
    });
  }

  /**
   * 快速调用 — 只发一条 user 消息，返回 content 字符串
   * 是 chat() 的便捷包装
   */
  async ask(
    userMessage: string,
    options?: RequestOptions,
  ): Promise<string> {
    const response = await this.chat(
      [{ role: 'user', content: userMessage }],
      options,
    );
    return response.choices?.[0]?.message?.content ?? '';
  }

  // ─── 流式调用 ────────────────────────────────────

  /**
   * 流式 Chat Completion
   *
   * - 通过 SSE 实时接收内容片段
   * - 超时控制 + 外部中止
   * - 回调通知 onChunk / onDone / onError
   *
   * @param messages  - 用户消息列表
   * @param callbacks - 流回调
   * @param options   - 超时/重试/中止选项
   * @returns 汇总 StreamResult
   */
  async chatStream(
    messages: LLMMessage[],
    callbacks?: StreamCallbacks,
    options?: RequestOptions,
  ): Promise<StreamResult> {
    const timeoutMs =
      options?.timeout ??
      this.config.timeout ??
      DEFAULT_CONFIG.STREAM_TIMEOUT;

    const allMessages = this.buildMessages(messages);
    const body = this.buildRequest(allMessages, { stream: true });

    logger.debug('[DeepSeek] 流式请求:', {
      model: body.model,
      messages: body.messages.length,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // 合并外部 signal
    const combinedSignal = options?.signal
      ? combineSignals(options.signal, controller.signal)
      : controller.signal;

    try {
      const headers = await this.buildHeaders();

      const response = await fetch(
        `${this.config.baseUrl ?? DEFAULT_CONFIG.BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: combinedSignal,
        },
      );

      if (!response.ok) {
        clearTimeout(timeoutId);
        await this.handleResponseError(response);
      }

      // 解析 SSE 流
      return await readStream(
        response,
        {
          onChunk: (chunk, accumulated) => {
            callbacks?.onChunk?.(chunk, accumulated);
          },
          onDone: (result) => {
            logger.debug('[DeepSeek] 流完成:', {
              id: result.id,
              model: result.model,
              contentLength: result.fullContent.length,
              finishReason: result.finishReason,
            });
            callbacks?.onDone?.(result);
          },
          onError: (error) => {
            logger.error('[DeepSeek] 流错误:', error.message);
            callbacks?.onError?.(error);
          },
        },
        combinedSignal,
      );
    } catch (error) {
      if (error instanceof LLMError) throw error;

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new TimeoutError(timeoutMs);
      }

      throw new APIError(
        error instanceof Error ? error.message : '流式请求未知错误',
        0,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 流式快速调用 — 只发一条 user 消息，通过回调接收内容
   * 是 chatStream() 的便捷包装
   */
  async askStream(
    userMessage: string,
    callbacks?: StreamCallbacks,
    options?: RequestOptions,
  ): Promise<StreamResult> {
    return this.chatStream(
      [{ role: 'user', content: userMessage }],
      callbacks,
      options,
    );
  }
}

// ─── 工具函数 ──────────────────────────────────────────

/**
 * 合并两个 AbortSignal
 * 任意一个 abort 时，返回的 signal 也 abort
 */
function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      'abort',
      () => controller.abort(signal.reason),
      { once: true },
    );
  }

  return controller.signal;
}

// ─── 单例导出 ──────────────────────────────────────────

/** 全局单例客户端 */
export const deepseekClient = new DeepSeekClient();
