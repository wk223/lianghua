/**
 * 数据缓存层
 * 内存 (Tier-1) + Storage (Tier-2) 二级缓存
 *
 * ─── 缓存策略 ──────────────────────────────────────
 *
 * Tier-1 (内存 Map):
 *   - 极速读写 (纳秒级), 进程级别
 *   - 生命周期: Service Worker 生命周期内
 *   - 默认 TTL: 较短 (行情 10s, 板块 15s)
 *
 * Tier-2 (Chrome Storage):
 *   - 持久化, 跨 SW 重启保留
 *   - 生命周期: 写入后直到 TTL 过期
 *   - 默认 TTL: 较长 (行情 30s, 板块 60s)
 *
 * 读策略: 先查 T1 → 命中直接返回; 未命中查 T2 → 命中则回填 T1 并返回
 * 写策略: 同时写入 T1 + T2
 * 淘汰: 惰性过期 (读取时检查) + 定期清理 (每 60s)
 *
 * @module data/cache
 */

import { storageManager, type StorageManager } from '../storage/manager';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

/** 缓存条目（Tier-1 内存级） */
interface MemCacheEntry<T> {
  data: T;
  expiresAt: number; // 过期时间戳 (ms)
}

/** 缓存统计 */
export interface CacheStats {
  tier1Size: number;       // 内存缓存条目数
  tier1Hits: number;       // Tier-1 命中次数
  tier1Misses: number;     // Tier-1 未命中次数
  tier2Hits: number;       // Tier-2 (Storage) 命中次数
  tier2Misses: number;     // Tier-2 未命中次数
  sets: number;            // 写入次数
  evictions: number;       // 淘汰次数
}

/** 缓存配置 */
export interface CacheConfig {
  /** Tier-1 默认 TTL (ms) — 默认 10 秒 */
  t1DefaultTTL: number;
  /** Tier-2 默认 TTL (ms) — 默认 30 秒 */
  t2DefaultTTL: number;
  /** Tier-1 最大条目数 — 默认 500 */
  t1MaxSize: number;
  /** 是否启用缓存 */
  enabled: boolean;
}

/** 内置缓存类别与默认 TTL */
export const CACHE_KEYS = {
  /** 个股行情 */
  QUOTE: 'quote',
  /** 大盘指数 */
  MARKET_INDEX: 'market_index',
  /** 板块列表 */
  SECTORS: 'sectors',
  /** 板块明细 */
  SECTOR_DETAIL: 'sector_detail',
  /** 热门题材 */
  HOT_TOPICS: 'hot_topics',
  /** 分析结果 */
  ANALYSIS: 'analysis',
} as const;

/** 各类型缓存的默认 TTL (ms) */
export const CACHE_TTL = {
  [CACHE_KEYS.QUOTE]:          { t1: 10_000, t2: 30_000 },
  [CACHE_KEYS.MARKET_INDEX]:   { t1: 15_000, t2: 45_000 },
  [CACHE_KEYS.SECTORS]:        { t1: 15_000, t2: 60_000 },
  [CACHE_KEYS.SECTOR_DETAIL]:  { t1: 15_000, t2: 60_000 },
  [CACHE_KEYS.HOT_TOPICS]:     { t1: 15_000, t2: 60_000 },
  [CACHE_KEYS.ANALYSIS]:       { t1: 60_000, t2: 300_000 },
} as const;

// ═══════════════════════════════════════════════════════════════
// 默认配置
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: CacheConfig = {
  t1DefaultTTL: 10_000,
  t2DefaultTTL: 30_000,
  t1MaxSize: 500,
  enabled: true,
};

const CLEANUP_INTERVAL = 60_000; // 定期清理间隔

// ═══════════════════════════════════════════════════════════════
// CacheManager
// ═══════════════════════════════════════════════════════════════

export class CacheManager {
  private tier1 = new Map<string, MemCacheEntry<unknown>>();
  private config: CacheConfig;
  private storage: StorageManager;

  // 统计
  private stats: CacheStats = {
    tier1Size: 0,
    tier1Hits: 0,
    tier1Misses: 0,
    tier2Hits: 0,
    tier2Misses: 0,
    sets: 0,
    evictions: 0,
  };

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor(config?: Partial<CacheConfig>, storage?: StorageManager) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = storage ?? storageManager;
  }

  // ─── 初始化 / 销毁 ──────────────────────────────────

  /** 启动定期清理 */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => {
        this.evictExpired();
      }, CLEANUP_INTERVAL);
    }

    this.initialized = true;
    logger.debug('[CacheManager] 已初始化');
  }

  /** 释放资源 */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.tier1.clear();
    this.initialized = false;
    logger.debug('[CacheManager] 已销毁');
  }

  // ─── 核心读写 ──────────────────────────────────────

  /**
   * 读取缓存
   *
   * 策略:
   *   1. 查 Tier-1 (内存) → 命中则返回
   *   2. 未命中 → 查 Tier-2 (Storage) → 命中则回填 Tier-1 并返回
   *   3. 均未命中 → 返回 null
   *
   * @param cacheKey 缓存键（自动加类型前缀）
   * @returns 缓存数据，未命中返回 null
   */
  async get<T>(
    cacheKey: string,
  ): Promise<T | null> {
    if (!this.config.enabled) return null;

    // ── Tier-1 查内存 ──
    const t1Entry = this.tier1.get(cacheKey) as MemCacheEntry<T> | undefined;
    if (t1Entry) {
      if (Date.now() < t1Entry.expiresAt) {
        this.stats.tier1Hits++;
        return t1Entry.data;
      }
      // 过期 — 淘汰
      this.tier1.delete(cacheKey);
      this.stats.evictions++;
    } else {
      this.stats.tier1Misses++;
    }

    // ── Tier-2 查 Storage ──
    try {
      const t2Data = await this.storage.getCache<T>(cacheKey);
      if (t2Data !== null) {
        this.stats.tier2Hits++;

        // 回填 Tier-1 (使用各类型 TTL)
        const ttl = this.getT2TTL(cacheKey);
        this.setT1(cacheKey, t2Data, ttl);

        return t2Data;
      }
    } catch {
      // Storage 读取失败 — 静默降级
      logger.warn(`[CacheManager] Tier-2 读取失败: ${cacheKey}`);
    }

    this.stats.tier2Misses++;
    return null;
  }

  /**
   * 写入缓存 (Tier-1 + Tier-2)
   *
   * @param cacheKey 缓存键
   * @param data     数据
   * @param customTTL 可选 — 自定义 TTL { t1?, t2? }
   */
  async set<T>(
    cacheKey: string,
    data: T,
    customTTL?: { t1?: number; t2?: number },
  ): Promise<void> {
    if (!this.config.enabled) return;

    this.stats.sets++;

    // 写 Tier-1 (内存)
    const t1TTL = customTTL?.t1 ?? this.getT1TTL(cacheKey);
    this.setT1(cacheKey, data, t1TTL);

    // 写 Tier-2 (Storage)
    try {
      const t2TTL = customTTL?.t2 ?? this.getT2TTL(cacheKey);
      await this.storage.setCache(cacheKey, data, t2TTL);
    } catch (err) {
      logger.warn(`[CacheManager] Tier-2 写入失败: ${cacheKey}`, err);
      // Tier-1 仍有数据，静默降级
    }
  }

  /**
   * 删除缓存 (Tier-1 + Tier-2)
   */
  async delete(cacheKey: string): Promise<void> {
    this.tier1.delete(cacheKey);

    try {
      await this.storage.removeCache(cacheKey);
    } catch {
      // 静默
    }
  }

  /**
   * 判断缓存是否存在且有效
   */
  async has(cacheKey: string): Promise<boolean> {
    // Tier-1 检查
    const t1Entry = this.tier1.get(cacheKey);
    if (t1Entry && Date.now() < t1Entry.expiresAt) {
      return true;
    }

    // Tier-2 检查
    try {
      const t2Data = await this.storage.getCache(cacheKey);
      return t2Data !== null;
    } catch {
      return false;
    }
  }

  // ─── 批量操作 ──────────────────────────────────────

  /**
   * 批量读取缓存
   * 返回 Map<cacheKey, T | null>
   */
  async getMany<T>(
    cacheKeys: string[],
  ): Promise<Map<string, T | null>> {
    const result = new Map<string, T | null>();

    // 先查 Tier-1
    const remaining: string[] = [];
    for (const key of cacheKeys) {
      const t1Entry = this.tier1.get(key) as MemCacheEntry<T> | undefined;
      if (t1Entry && Date.now() < t1Entry.expiresAt) {
        result.set(key, t1Entry.data);
        this.stats.tier1Hits++;
      } else {
        remaining.push(key);
        this.stats.tier1Misses++;
      }
    }

    if (remaining.length === 0) return result;

    // 批量查 Tier-2
    for (const key of remaining) {
      try {
        const t2Data = await this.storage.getCache<T>(key);
        if (t2Data !== null) {
          result.set(key, t2Data);
          this.stats.tier2Hits++;

          // 回填 T1
          const ttl = this.getT2TTL(key);
          this.setT1(key, t2Data, ttl);
        } else {
          result.set(key, null);
          this.stats.tier2Misses++;
        }
      } catch {
        result.set(key, null);
        this.stats.tier2Misses++;
      }
    }

    return result;
  }

  /**
   * 清除所有缓存 (Tier-1 + Tier-2)
   */
  async clear(): Promise<void> {
    this.tier1.clear();
    this.stats.evictions += this.tier1.size;
    this.storage.clearCache();
    logger.info('[CacheManager] 缓存已全部清除');
  }

  /**
   * 清除指定类型的缓存
   *
   * @param type 缓存类型前缀，如 'quote' | 'sectors'
   */
  async clearByType(type: string): Promise<void> {
    const prefix = `cache_${type}`;

    // Tier-1: 删除前缀匹配
    for (const key of this.tier1.keys()) {
      if (key.startsWith(prefix)) {
        this.tier1.delete(key);
      }
    }

    // Tier-2: 暂不支持按前缀删除 Storage (需要额外维护索引)
    // 为简单起见，这里只做 T1 清除
    logger.debug(`[CacheManager] 清除类型缓存: ${type}`);
  }

  // ─── 统计 & 管理 ──────────────────────────────────

  /** 获取缓存统计 */
  getStats(): CacheStats {
    return {
      ...this.stats,
      tier1Size: this.tier1.size,
    };
  }

  /** 重置统计 */
  resetStats(): void {
    this.stats = {
      tier1Size: this.tier1.size,
      tier1Hits: 0,
      tier1Misses: 0,
      tier2Hits: 0,
      tier2Misses: 0,
      sets: 0,
      evictions: 0,
    };
  }

  /** 获取 Tier-1 缓存键列表 */
  getT1Keys(): string[] {
    return Array.from(this.tier1.keys());
  }

  /** 配置运行中更新 */
  setConfig(partial: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** 获取当前配置 */
  getConfig(): Readonly<CacheConfig> {
    return { ...this.config };
  }

  // ─── 内部方法 ──────────────────────────────────────

  /** 写入 Tier-1 (内存) */
  private setT1<T>(key: string, data: T, ttlMs: number): void {
    // 容量控制 — 超出上限时淘汰最旧的
    if (this.tier1.size >= this.config.t1MaxSize) {
      const oldestKey = this.tier1.keys().next().value;
      if (oldestKey !== undefined) {
        this.tier1.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.tier1.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /** 惰性淘汰过期条目 */
  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.tier1.entries()) {
      if (now >= entry.expiresAt) {
        this.tier1.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      this.stats.evictions += evicted;
      logger.debug(`[CacheManager] 淘汰 ${evicted} 条过期缓存`);
    }
  }

  /** 根据缓存键推测 Tier-1 TTL */
  private getT1TTL(cacheKey: string): number {
    for (const [type, ttl] of Object.entries(CACHE_TTL)) {
      if (cacheKey.startsWith(`cache_${type}`) || cacheKey.startsWith(type)) {
        return ttl.t1;
      }
    }
    return this.config.t1DefaultTTL;
  }

  /** 根据缓存键推测 Tier-2 TTL */
  private getT2TTL(cacheKey: string): number {
    for (const [type, ttl] of Object.entries(CACHE_TTL)) {
      if (cacheKey.startsWith(`cache_${type}`) || cacheKey.startsWith(type)) {
        return ttl.t2;
      }
    }
    return this.config.t2DefaultTTL;
  }

  /**
   * 生成标准缓存键
   *
   * @example
   * ```ts
   * cache.key('quote', '600519')   → 'quote:600519'
   * cache.key('sectors')            → 'sectors'
   * cache.key('analysis', 'pool')   → 'analysis:pool'
   * ```
   */
  static makeKey(type: string, ...parts: string[]): string {
    if (parts.length === 0) return type;
    return `${type}:${parts.join(':')}`;
  }
}

// ─── 单例 ──────────────────────────────────────────────

/** 全局单例 */
export const cacheManager = new CacheManager();
