/**
 * LLM 类型定义
 * DeepSeek API 请求/响应/错误/流事件类型
 *
 * @module llm/types
 */

// ─── API 配置 ──────────────────────────────────────────

/** DeepSeek API 配置 */
export interface DeepSeekConfig {
  /** API Key（可选 — 可从 Chrome Storage 读取） */
  apiKey?: string;
  /** API 基础地址 */
  baseUrl?: string;
  /** 模型名 */
  model?: string;
  /** 最大 Token 数 */
  maxTokens?: number;
  /** 温度参数 */
  temperature?: number;
  /** 超时时间 ms */
  timeout?: number;
}

/** 默认配置常量 */
export const DEFAULT_CONFIG = {
  BASE_URL: 'https://api.deepseek.com/v1',
  MODEL: 'deepseek-chat',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
  TIMEOUT: 60_000,       // 非流式 60s
  STREAM_TIMEOUT: 120_000, // 流式 120s
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY: 1000,
  RETRY_MAX_DELAY: 10_000,
} as const;

// ─── 消息 ──────────────────────────────────────────────

/** API 请求消息 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── 请求 ──────────────────────────────────────────────

/** API 请求体（非流式） */
export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
}

/** API 请求体（流式） */
export type LLMStreamRequest = Omit<LLMRequest, 'stream'> & { stream: true };

// ─── 响应（非流式） ──────────────────────────────────

/** API 响应（非流式） */
export interface LLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── 流式响应片段 ────────────────────────────────────

/** SSE 流式响应片段（DeepSeek 兼容 OpenAI 格式） */
export interface LLMStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      content?: string;
      role?: string;
    };
    finish_reason: string | null;
  }[];
}

// ─── 流最终汇总 ──────────────────────────────────────

/** 流式调用完成后汇总的结果 */
export interface StreamResult {
  fullContent: string;
  id: string;
  model: string;
  created: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finishReason: string;
}

// ─── 错误类型 ──────────────────────────────────────────

/** LLM 基础错误 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** API 返回错误（HTTP 4xx/5xx） */
export class APIError extends LLMError {
  constructor(
    message: string,
    statusCode: number,
    public readonly body?: string,
  ) {
    super(message, 'API_ERROR', statusCode, statusCode >= 500);
    this.name = 'APIError';
  }
}

/** 超时错误 */
export class TimeoutError extends LLMError {
  constructor(timeoutMs: number) {
    super(
      `请求超时 (${timeoutMs}ms)`,
      'TIMEOUT',
      undefined,
      true, // 超时可重试
    );
    this.name = 'TimeoutError';
  }
}

/** 流解析错误 */
export class StreamError extends LLMError {
  constructor(
    message: string,
    public readonly rawLine?: string,
  ) {
    super(message, 'STREAM_ERROR', undefined, false);
    this.name = 'StreamError';
  }
}

/** API Key 错误 */
export class AuthError extends LLMError {
  constructor(message: string = 'API Key 无效或未配置') {
    super(message, 'AUTH_ERROR', 401, false);
    this.name = 'AuthError';
  }
}

/** 速率限制错误 */
export class RateLimitError extends LLMError {
  constructor(
    public readonly retryAfterMs: number = 60_000,
  ) {
    super(
      `API 速率限制，建议等待 ${retryAfterMs}ms`,
      'RATE_LIMIT',
      429,
      true,
    );
    this.name = 'RateLimitError';
  }
}

// ─── 流回调 ──────────────────────────────────────────

/** 流式回调接口 */
export interface StreamCallbacks {
  /** 收到新的内容片段 */
  onChunk?: (chunk: LLMStreamChunk, accumulated: string) => void;
  /** 流结束（正常完成或中断） */
  onDone?: (result: StreamResult) => void;
  /** 发生错误 */
  onError?: (error: LLMError) => void;
}

// ─── 请求选项 ──────────────────────────────────────────

/** 单次请求选项 */
export interface RequestOptions {
  /** 超时时间 ms */
  timeout?: number;
  /** AbortSignal */
  signal?: AbortSignal;
  /** 重试次数（默认 3） */
  retries?: number;
  /** 重试基础延迟 ms（默认 1000） */
  retryBaseDelay?: number;
  /** 重试最大延迟 ms（默认 10000） */
  retryMaxDelay?: number;
}
