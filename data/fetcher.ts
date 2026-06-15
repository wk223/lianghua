/**
 * 数据获取入口
 * 统一 HTTP 请求层：速率限制 + 缓存 + 超时 + 重试
 *
 * @module data/fetcher
 *
 * 设计说明:
 * - 使用 AbortController 实现请求超时
 * - 队列式速率限制（默认 5 请求/秒），请求排队等待
 * - 基于 Map 的 TTL 缓存
 * - 复用 utils/retry.ts 的指数退避重试
 * - 内部统计追踪（命中率、失败率）
 */

import { withRetry } from '../utils/retry';
import type {
  CacheEntry,
  FetchOptions,
  RateLimitConfig,
  FetcherStats,
} from './types';
import { DEFAULT_RATE_LIMIT } from './types';

// ═══════════════════════════════════════════════════════════════
// 默认常量
// ═══════════════════════════════════════════════════════════════

const DEFAULT_TIMEOUT = 8_000;
const DEFAULT_TTL = 30_000;
const DEFAULT_RETRY = 3;
const CACHE_CLEANUP_INTERVAL = 60_000; // 每分钟清理过期缓存

// ═══════════════════════════════════════════════════════════════
// DataFetcher
// ═══════════════════════════════════════════════════════════════

export class DataFetcher {
  private cache = new Map<string, CacheEntry<unknown>>();
  private rateLimitQueue: Array<() => void> = [];
  private lastRequestTime = 0;
  private processingQueue = false;

  private stats: FetcherStats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    failedRequests: 0,
    rateLimited: 0,
  };

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly rateLimit: RateLimitConfig = DEFAULT_RATE_LIMIT,
  ) {
    // 启动定期缓存清理
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(
        () => this.evictExpired(),
        CACHE_CLEANUP_INTERVAL,
      );
    }
  }

  // ─── 公开 API ──────────────────────────────────────────

  /**
   * 发起 HTTP 请求，返回解析后的 JSON 数据
   * 集成：速率限制 → 缓存检查 → 超时 → 重试
   */
  async fetchJSON<T>(
    url: string,
    options: FetchOptions = {},
  ): Promise<T> {
    this.stats.totalRequests++;

    const {
      useCache = true,
      ttl = DEFAULT_TTL,
      timeout = DEFAULT_TIMEOUT,
      retry = DEFAULT_RETRY,
      headers = {},
    } = options;

    // —— 缓存检查 ——
    if (useCache) {
      const cached = this.getFromCache<T>(url);
      if (cached !== null) {
        this.stats.cacheHits++;
        return cached;
      }
    }
    this.stats.cacheMisses++;

    // —— 执行请求（带速率限制 + 超时 + 重试） ——
    try {
      const data = await this.executeWithRateLimit<T>(url, timeout, retry, headers);

      // —— 写入缓存 ——
      if (useCache) {
        this.setCache(url, data, ttl);
      }

      return data;
    } catch (err) {
      this.stats.failedRequests++;
      throw err;
    }
  }

  /**
   * 发起原始 HTTP 请求，返回 Response（不缓存、不限速）
   * 适用于流式或非 JSON 场景
   */
  async fetchRaw(
    url: string,
    timeout: number = DEFAULT_TIMEOUT,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 发起 HTTP 请求，返回文本内容（集成缓存 + 限速 + 重试）
   * 适用于 JSONP 或非标准 JSON 响应
   */
  async fetchRawText(
    url: string,
    options: FetchOptions = {},
  ): Promise<string> {
    this.stats.totalRequests++;

    const {
      useCache = true,
      ttl = DEFAULT_TTL,
      timeout = DEFAULT_TIMEOUT,
      retry = DEFAULT_RETRY,
      headers = {},
    } = options;

    // —— 缓存检查 ——
    if (useCache) {
      const cached = this.getFromCache<string>(url);
      if (cached !== null) {
        this.stats.cacheHits++;
        return cached;
      }
    }
    this.stats.cacheMisses++;

    // —— 执行请求 ——
    try {
      const data = await this.executeWithRawRetry(url, timeout, retry, headers);

      // —— 写入缓存 ——
      if (useCache) {
        this.setCache(url, data, ttl);
      }

      return data;
    } catch (err) {
      this.stats.failedRequests++;
      throw err;
    }
  }

  // ─── 缓存管理 ──────────────────────────────────────────

  /** 清空所有缓存 */
  clearCache(): void {
    this.cache.clear();
    this.stats.cacheHits = 0;
    this.stats.cacheMisses = 0;
  }

  /** 删除指定 URL 的缓存 */
  invalidateCache(url: string): void {
    this.cache.delete(url);
  }

  /** 获取当前缓存大小（条目数） */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** 获取统计信息 */
  getStats(): FetcherStats {
    return { ...this.stats };
  }

  /** 重置统计 */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedRequests: 0,
      rateLimited: 0,
    };
  }

  // ─── 生命周期 ──────────────────────────────────────────

  /** 释放资源 */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }

  // ─── 内部实现 ──────────────────────────────────────────

  /**
   * 执行带速率限制的请求
   * 使用队列确保不超过 rateLimit.maxRequests / rateLimit.windowMs
   */
  private async executeWithRateLimit<T>(
    url: string,
    timeout: number,
    retry: number,
    headers: Record<string, string>,
  ): Promise<T> {
    await this.enqueue();

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'zh-CN,zh;q=0.9',
              'Referer': 'https://q.10jqka.com.cn/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              ...headers,
            },
          });

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}: ${response.statusText} (${url})`,
            );
          }

          const text = await response.text();

          // 东方财富 API 可能返回空字符串或非 JSON
          if (!text || text.trim().length === 0) {
            throw new Error('东方财富 API 返回空数据');
          }

          return JSON.parse(text) as T;
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error(`请求超时 (${timeout}ms): ${url}`);
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        maxRetries: retry,
        baseDelay: 500,
        maxDelay: 5000,
        onRetry: (error, attempt) => {
          console.warn(
            `[DataFetcher] 重试 #${attempt + 1}/${retry}: ${url}`,
            error.message,
          );
        },
      },
    );
  }

  /**
   * 速率限制队列
   * 保证请求间隔不小于 windowMs / maxRequests
   */
  private enqueue(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.rateLimitQueue.push(resolve);
      if (!this.processingQueue) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    this.processingQueue = true;

    while (this.rateLimitQueue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      const minInterval = this.rateLimit.windowMs / this.rateLimit.maxRequests;

      // 如果距离上次请求时间不足最小间隔，等待
      if (elapsed < minInterval) {
        await sleep(minInterval - elapsed);
      }

      const next = this.rateLimitQueue.shift();
      if (next) {
        this.lastRequestTime = Date.now();
        next();
      }
    }

    this.processingQueue = false;
  }

  /**
   * 执行带速率限制的文本请求（不进行 JSON 解析）
   */
  private async executeWithRawRetry(
    url: string,
    timeout: number,
    retry: number,
    headers: Record<string, string>,
  ): Promise<string> {
    await this.enqueue();

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'zh-CN,zh;q=0.9',
              'Referer': 'https://q.10jqka.com.cn/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              ...headers,
            },
          });

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}: ${response.statusText} (${url})`,
            );
          }

          const text = await response.text();

          if (!text || text.trim().length === 0) {
            throw new Error('同花顺 API 返回空数据');
          }

          return text;
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error(`请求超时 (${timeout}ms): ${url}`);
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        maxRetries: retry,
        baseDelay: 500,
        maxDelay: 5000,
        onRetry: (error, attempt) => {
          console.warn(
            `[DataFetcher] 重试 #${attempt + 1}/${retry}: ${url}`,
            error.message,
          );
        },
      },
    );
  }

  // ─── 缓存操作 ──────────────────────────────────────────

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  private setCache<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  /** 清理过期缓存条目 */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

// ─── 工具函数 ──────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
