/**
 * Chrome Storage 管理器
 * 类型安全的 storage.local + storage.sync 封装
 *
 * ─── 存储策略 ──────────────────────────────────────
 *
 * chrome.storage.sync（跨设备同步，有配额限制）:
 *   - api_key    : DeepSeek API Key（字符串，~64 字符）
 *   - settings   : 用户偏好设置（对象，体积小）
 *
 *   注: sync 的 QUOTA_BYTES_PER_ITEM = 8,192 字节 (≈8KB)
 *       QUOTA_BYTES = 102,400 字节 (≈100KB)
 *       每项必须 <8KB，总计 <100KB
 *
 * chrome.storage.local（本机存储，配额大）:
 *   - watchlist  : 自选股列表（字符串数组）
 *   - history    : 分析历史记录（数组，含完整结果）
 *   - cache_*    : 数据缓存（TTL 过期机制）
 *   - meta_*     : 内部元数据（版本号、安装时间等）
 *
 * ─── 用法示例 ─────────────────────────────────────
 *
 * ```ts
 * const storage = new StorageManager();
 *
 * // 读取设置（自动走 sync）
 * const settings = await storage.get('settings');
 *
 * // 写入 API Key（自动走 sync）
 * await storage.set('api_key', 'sk-xxx...');
 *
 * // 操作缓存
 * await storage.setCache('sectors', sectorData, 60_000);
 * const cached = await storage.getCache<MyType>('sectors');
 *
 * // 记录分析历史
 * await storage.addHistory(analysisResult);
 * const recent = await storage.getHistory({ limit: 10 });
 * ```
 *
 * @module storage/manager
 */

import { logger } from '../utils/logger';
import { CacheEntry } from '../data/types';
import type { AnalysisResult } from '../utils/types';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

// ─── 用户偏好设置 ─────────────────────────────

export interface UserSettings {
  /** DeepSeek 模型名 */
  model: string;
  /** 生成温度 (0.0 - 2.0) */
  temperature: number;
  /** 最大生成 Token 数 */
  maxTokens: number;
  /** 自动分析开关 */
  autoAnalyze: boolean;
  /** 最大并发分析数 */
  maxConcurrent: number;
  /** 调试模式 */
  debugMode: boolean;
}

// ─── 分析历史记录 ─────────────────────────────

/** 单条分析历史记录（包装 AnalysisResult + 元数据） */
export interface AnalysisRecord {
  /** 唯一标识 (UUID) */
  id: string;
  /** 记录创建时间戳 (ms) */
  createdAt: number;
  /** 用户标注的备注（可选） */
  note?: string;
  /** 标签列表，用于分类筛选 */
  tags?: string[];
  /** 完整分析结果 */
  result: AnalysisResult;
}

// ─── Storage 键 → 类型映射 ──────────────────

/**
 * Sync 区域键（跨设备同步）
 * 每项必须 < 8KB
 */
export interface SyncSchema {
  /** DeepSeek API Key */
  api_key: string;
  /** 用户偏好设置 */
  settings: UserSettings;
}

/**
 * Local 区域键（本机存储）
 * 无严格配额限制（但建议单键 < 10MB）
 */
export interface LocalSchema {
  /** 自选股列表 */
  watchlist: string[];
  /** 分析历史记录 */
  history: AnalysisRecord[];
}

/** 已知的 Storage 键（不含 cache_ 前缀的缓存键） */
export type KnownKey = keyof SyncSchema | keyof LocalSchema;

/** 缓存键模式: `cache_<name>` */
export type CacheKey = `cache_${string}`;

/** 元数据键模式: `meta_<name>` */
export type MetaKey = `meta_${string}`;

/** 所有可能的 Storage 键 */
export type StorageKey = KnownKey | CacheKey | MetaKey;

// ─── 区域映射 ─────────────────────────────────

/** 每个已知键对应的存储区域 */
const KEY_AREA: Record<KnownKey, 'sync' | 'local'> = {
  api_key: 'sync',
  settings: 'sync',
  watchlist: 'local',
  history: 'local',
};

// ─── 默认值 ───────────────────────────────────

/** 首次安装时的默认配置 */
export const DEFAULT_SETTINGS: UserSettings = {
  model: 'deepseek-chat',
  temperature: 0.7,
  maxTokens: 4096,
  autoAnalyze: false,
  maxConcurrent: 3,
  debugMode: false,
};

/** 各键的默认值 */
export const DEFAULTS: Record<KnownKey, unknown> = {
  api_key: '',
  settings: { ...DEFAULT_SETTINGS },
  watchlist: [],
  history: [],
};

// ─── 内部元数据键 ────────────────────────────

/** 内部元数据键名 */
export const META_KEYS = {
  VERSION: 'meta_version',
  INSTALLED_AT: 'meta_installed_at',
  LAST_ANALYSIS_AT: 'meta_last_analysis_at',
  MIGRATED: 'meta_migrated',
} as const;

// ═══════════════════════════════════════════════════════════════
// 错误类型
// ═══════════════════════════════════════════════════════════════

/** Storage 操作错误 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly key?: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/** 配额超限（sync 超限时抛出） */
export class QuotaExceededError extends StorageError {
  constructor(key: string, sizeBytes: number, limitBytes: number) {
    super(
      `存储配额超限: "${key}" 大小 ${sizeBytes}B 超过限制 ${limitBytes}B`,
      'QUOTA_EXCEEDED',
      key,
    );
    this.name = 'QuotaExceededError';
  }
}

/** 校验错误 */
export class ValidationError extends StorageError {
  constructor(key: string, reason: string) {
    super(`值校验失败: "${key}" — ${reason}`, 'VALIDATION', key);
    this.name = 'ValidationError';
  }
}

// ═══════════════════════════════════════════════════════════════
// StorageManager
// ═══════════════════════════════════════════════════════════════

export class StorageManager {
  // ─── 内部状态 ──────────────────────────────────

  /** 内存缓存，避免频繁读取 Chrome Storage */
  private memoryCache = new Map<string, unknown>();

  /** 是否已初始化 */
  private initialized = false;

  /** 初始化 Promise，防止并发初始化 */
  private initPromise: Promise<void> | null = null;

  // ─── 内置变更监听器 ───────────────────────────

  /** 外部注册的 storage 变更回调 */
  private changeListeners = new Map<string, Set<(value: unknown, oldValue: unknown) => void>>();

  /** Chrome storage.onChanged 是否已监听 */
  private onChangeBound = false;

  // ═══════════════════════════════════════════════
  // 构造 & 初始化
  // ═══════════════════════════════════════════════

  /**
   * 创建 StorageManager 实例
   * 不自动初始化 —— 首次调用任意方法时会自动初始化
   */
  constructor() {
    // 延迟绑定 onChange 监听，避免在构造时触发
  }

  /**
   * 初始化存储
   * - 确保默认值存在于 storage 中（首次安装时写入）
   * - 绑定 chrome.storage.onChanged 监听
   *
   * 幂等，可重复调用
   */
  async init(options?: { force?: boolean }): Promise<void> {
    if (this.initialized && !options?.force) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInit(): Promise<void> {
    // 1. 绑定 onChanged 监听（仅一次）
    if (!this.onChangeBound) {
      this.bindOnChange();
    }

    // 2. 写入默认值
    await this.ensureDefaults();

    // 3. 从 Chrome Storage 预热内存缓存
    await this.warmCache();

    this.initialized = true;
    logger.info('[StorageManager] 初始化完成');
  }

  /** 确保初始化（所有公开方法先调用此方法） */
  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  // ═══════════════════════════════════════════════
  // 核心读写
  // ═══════════════════════════════════════════════

  /**
   * 读取指定键的值
   *
   * 自动识别存储区域（sync / local），也支持显式指定
   * 优先返回内存缓存中的数据（最新一次 set/get 后缓存）
   *
   * @param key   - 存储键
   * @param area  - 可选，显式指定存储区域（默认根据键名自动判断）
   *
   * @example
   * ```ts
   * const apiKey = await storage.get('api_key');
   * const settings = await storage.get('settings');
   * const history = await storage.get('history');
   * ```
   */
  async get<T = unknown>(
    key: StorageKey,
    area?: 'sync' | 'local',
  ): Promise<T> {
    await this.ensureInit();

    // 先查内存缓存
    const cached = this.memoryCache.get(key);
    if (cached !== undefined) {
      return cached as T;
    }

    // 确定存储区域
    const storageArea = area ?? this.resolveArea(key);

    try {
      const storage = this.getChromeStorage(storageArea);
      const result = await storage.get(key);
      const value = result[key] as T | undefined;

      // 回写入内存缓存（即使 undefined）
      this.memoryCache.set(key, value);

      return (value ?? this.getDefault(key)) as T;
    } catch (err) {
      throw this.wrapError(err, '读取失败', key);
    }
  }

  /**
   * 批量读取多个键
   *
   * @example
   * ```ts
   * const { api_key, settings } = await storage.getMany(['api_key', 'settings']);
   * ```
   */
  async getMany<T extends Record<string, unknown>>(
    keys: StorageKey[],
  ): Promise<T> {
    await this.ensureInit();

    const result: Record<string, unknown> = {};

    // 按区域分组
    const syncKeys: string[] = [];
    const localKeys: string[] = [];

    for (const key of keys) {
      const area = this.resolveArea(key);
      if (area === 'sync') {
        syncKeys.push(key);
      } else {
        localKeys.push(key);
      }
    }

    // 并行读取两个区域
    const [syncResult, localResult] = await Promise.all([
      syncKeys.length > 0
        ? this.getChromeStorage('sync').get(syncKeys)
        : Promise.resolve({}),
      localKeys.length > 0
        ? this.getChromeStorage('local').get(localKeys)
        : Promise.resolve({}),
    ]);

    // 合并结果
    const merged: Record<string, unknown> = { ...syncResult, ...localResult };

    for (const key of keys) {
      const value = (merged[key] as T[keyof T] | undefined) ?? this.getDefault(key);
      result[key] = value;
      this.memoryCache.set(key, value);
    }

    return result as T;
  }

  /**
   * 写入指定键的值
   *
   * 自动识别存储区域，写入后更新内存缓存
   * 对 sync 区域做大小校验（防止静默失败）
   *
   * @param key   - 存储键
   * @param value - 要写入的值
   * @param area  - 可选，显式指定存储区域
   *
   * @throws {QuotaExceededError} sync 区域超出配额
   * @throws {ValidationError}    值校验失败
   */
  async set<T = unknown>(
    key: StorageKey,
    value: T,
    area?: 'sync' | 'local',
  ): Promise<void> {
    await this.ensureInit();

    // 校验
    this.validateValue(key, value);

    const storageArea = area ?? this.resolveArea(key);

    // sync 区域做大小校验
    if (storageArea === 'sync') {
      this.checkSyncQuota(key, value);
    }

    try {
      const storage = this.getChromeStorage(storageArea);
      await storage.set({ [key]: value });

      // 更新内存缓存
      this.memoryCache.set(key, value);

      logger.debug(`[StorageManager] 已写入: ${key} → ${storageArea}`);
    } catch (err) {
      // Chrome 自身可能抛出 QUOTA_BYTES_PER_ITEM 错误
      if (err instanceof Error && err.message.includes('QUOTA_BYTES_PER_ITEM')) {
        throw new QuotaExceededError(key, this.estimateSize(value), 8192);
      }
      throw this.wrapError(err, '写入失败', key);
    }
  }

  /**
   * 批量写入多个键
   *
   * 按区域分组后并行写入
   *
   * @example
   * ```ts
   * await storage.setMany({
   *   api_key: 'sk-xxx',
   *   settings: { model: 'deepseek-chat', ... },
   * });
   * ```
   */
  async setMany(entries: Record<StorageKey, unknown>): Promise<void> {
    await this.ensureInit();

    const syncPayload: Record<string, unknown> = {};
    const localPayload: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(entries)) {
      this.validateValue(key, value);

      const area = this.resolveArea(key);
      if (area === 'sync') {
        this.checkSyncQuota(key, value);
        syncPayload[key] = value;
      } else {
        localPayload[key] = value;
      }

      this.memoryCache.set(key, value);
    }

    await Promise.all([
      Object.keys(syncPayload).length > 0
        ? this.getChromeStorage('sync').set(syncPayload)
        : Promise.resolve(),
      Object.keys(localPayload).length > 0
        ? this.getChromeStorage('local').set(localPayload)
        : Promise.resolve(),
    ]);

    logger.debug(`[StorageManager] 批量写入完成: sync=${Object.keys(syncPayload).length}, local=${Object.keys(localPayload).length}`);
  }

  /**
   * 删除指定键
   *
   * @param key  - 要删除的键
   * @param area - 可选，显式指定存储区域
   */
  async remove(key: StorageKey, area?: 'sync' | 'local'): Promise<void> {
    await this.ensureInit();

    const storageArea = area ?? this.resolveArea(key);

    try {
      const storage = this.getChromeStorage(storageArea);
      await storage.remove(key);

      // 清除内存缓存
      this.memoryCache.delete(key);

      logger.debug(`[StorageManager] 已删除: ${key}`);
    } catch (err) {
      throw this.wrapError(err, '删除失败', key);
    }
  }

  /**
   * 清空所有存储数据
   *
   * ⚠️ 危险操作 — 会删除所有已知键 + 缓存 + 元数据
   * 不会删除其他扩展存储的数据（Chrome 自动隔离）
   *
   * @returns 被删除的键列表
   */
  async clear(): Promise<string[]> {
    await this.ensureInit();

    // 收集所有要删除的键
    const syncKeys: string[] = Object.keys(KEY_AREA).filter(
      (k) => KEY_AREA[k as KnownKey] === 'sync',
    );
    const localKeys: string[] = [
      ...Object.keys(KEY_AREA).filter((k) => KEY_AREA[k as KnownKey] === 'local'),
      ...this.collectCacheKeys(),
      ...this.collectMetaKeys(),
    ];

    await Promise.all([
      this.getChromeStorage('sync').remove(syncKeys),
      this.getChromeStorage('local').remove(localKeys),
    ]);

    // 清空内存缓存
    this.memoryCache.clear();
    this.initialized = false;

    const allKeys = [...syncKeys, ...localKeys];
    logger.info(`[StorageManager] 存储已清空: ${allKeys.length} 个键`);

    return allKeys;
  }

  /**
   * 检查键是否存在
   */
  async has(key: StorageKey): Promise<boolean> {
    await this.ensureInit();

    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key) !== undefined;
    }

    const area = this.resolveArea(key);
    const storage = this.getChromeStorage(area);
    const result = await storage.get(key);
    return result[key] !== undefined;
  }

  // ═══════════════════════════════════════════════
  // 默认值管理
  // ═══════════════════════════════════════════════

  /**
   * 获取指定键的默认值
   */
  getDefault(key: StorageKey): unknown {
    if (key in DEFAULTS) {
      const def = DEFAULTS[key as KnownKey];
      // 返回深拷贝，防止外部修改默认值
      return deepClone(def);
    }

    // 缓存键默认返回 null
    if (key.startsWith('cache_')) {
      return null;
    }

    // 元数据键默认返回 undefined
    if (key.startsWith('meta_')) {
      return undefined;
    }

    return undefined;
  }

  /**
   * 重置指定键为默认值
   */
  async resetToDefault(key: KnownKey): Promise<void> {
    const defaultValue = this.getDefault(key);
    await this.set(key, defaultValue);
    logger.info(`[StorageManager] 已重置为默认值: ${key}`);
  }

  /**
   * 重置所有键为默认值
   */
  async resetAll(): Promise<void> {
    const entries: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULTS)) {
      entries[key] = this.getDefault(key as KnownKey);
    }
    await this.setMany(entries);
    logger.info('[StorageManager] 所有键已重置为默认值');
  }

  /**
   * 获取所有已知键的当前值（含默认值回退）
   */
  async getAll(): Promise<Record<KnownKey, unknown>> {
    const keys = Object.keys(KEY_AREA) as KnownKey[];
    const result = await this.getMany(keys);
    return result as unknown as Record<KnownKey, unknown>;
  }

  /**
   * 获取当前存储使用统计
   */
  async getStorageInfo(): Promise<{
    sync: { keys: number; bytes: number };
    local: { keys: number; bytes: number };
  }> {
    const [syncBytes, localBytes] = await Promise.all([
      this.getChromeStorage('sync').getBytesInUse(null),
      this.getChromeStorage('local').getBytesInUse(null),
    ]);

    return {
      sync: {
        keys: Object.keys(KEY_AREA).filter((k) => KEY_AREA[k as KnownKey] === 'sync').length,
        bytes: syncBytes,
      },
      local: {
        keys: Object.keys(KEY_AREA).filter((k) => KEY_AREA[k as KnownKey] === 'local').length,
        bytes: localBytes,
      },
    };
  }

  // ═══════════════════════════════════════════════
  // 缓存管理
  // ═══════════════════════════════════════════════

  /**
   * 设置缓存条目
   *
   * @param name  - 缓存名（自动加 `cache_` 前缀）
   * @param data  - 要缓存的数据
   * @param ttl   - 过期时间 (ms)，默认 30 秒
   *
   * @example
   * ```ts
   * await storage.setCache('sectors', sectorData, 60_000);
   * ```
   */
  async setCache<T>(name: string, data: T, ttl: number = 30_000): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };

    const key: CacheKey = `cache_${name}`;
    await this.set(key, entry, 'local');
  }

  /**
   * 读取缓存条目
   *
   * 如果缓存不存在或已过期，返回 null
   *
   * @param name - 缓存名
   *
   * @example
   * ```ts
   * const sectors = await storage.getCache<SectorData[]>('sectors');
   * if (sectors) { /* 使用缓存 * / }
   * ```
   */
  async getCache<T>(name: string): Promise<T | null> {
    const key: CacheKey = `cache_${name}`;
    const entry = await this.get<CacheEntry<T> | null>(key, 'local');

    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > entry.ttl) {
      // 过期 — 清除并返回 null
      await this.remove(key, 'local').catch(() => {});
      return null;
    }

    return entry.data;
  }

  /**
   * 删除指定缓存
   */
  async removeCache(name: string): Promise<void> {
    const key: CacheKey = `cache_${name}`;
    await this.remove(key, 'local');
  }

  /**
   * 清除所有过期缓存
   *
   * @returns 被清除的缓存数量
   */
  async clearExpiredCache(): Promise<number> {
    const cacheKeys = this.collectCacheKeys();
    let cleared = 0;

    for (const key of cacheKeys) {
      try {
        const cacheKey = key as CacheKey;
        const entry = await this.get<CacheEntry<unknown> | null>(cacheKey, 'local');
        if (entry && Date.now() - entry.timestamp > entry.ttl) {
          await this.remove(cacheKey, 'local');
          cleared++;
        }
      } catch {
        // 单个缓存读取失败不影响整体
      }
    }

    if (cleared > 0) {
      logger.info(`[StorageManager] 已清除 ${cleared} 条过期缓存`);
    }

    return cleared;
  }

  /**
   * 清除所有缓存（无论是否过期）
   *
   * @returns 被清除的缓存数量
   */
  async clearAllCache(): Promise<number> {
    const cacheKeys = this.collectCacheKeys();

    if (cacheKeys.length > 0) {
      await this.getChromeStorage('local').remove(cacheKeys);
      for (const key of cacheKeys) {
        this.memoryCache.delete(key);
      }
    }

    logger.info(`[StorageManager] 已清除全部缓存: ${cacheKeys.length} 条`);
    return cacheKeys.length;
  }

  /**
   * 获取缓存统计信息
   */
  async getCacheStats(): Promise<{
    total: number;
    expired: number;
    valid: number;
  }> {
    const cacheKeys = this.collectCacheKeys();
    let expired = 0;
    let valid = 0;

    for (const key of cacheKeys) {
      try {
        const cacheKey = key as CacheKey;
        const entry = await this.get<CacheEntry<unknown> | null>(cacheKey, 'local');
        if (entry) {
          if (Date.now() - entry.timestamp > entry.ttl) {
            expired++;
          } else {
            valid++;
          }
        }
      } catch {
        // 忽略
      }
    }

    return { total: cacheKeys.length, expired, valid };
  }

  // ═══════════════════════════════════════════════
  // 历史记录管理
  // ═══════════════════════════════════════════════

  /**
   * 添加一条分析记录到历史
   *
   * @param result - 分析结果
   * @param options - 可选：备注、标签
   * @returns 生成的记录 ID
   */
  async addHistory(
    result: AnalysisResult,
    options?: { note?: string; tags?: string[] },
  ): Promise<string> {
    const record: AnalysisRecord = {
      id: generateId(),
      createdAt: Date.now(),
      note: options?.note,
      tags: options?.tags,
      result,
    };

    // 读取当前历史，追加
    const history = await this.get<AnalysisRecord[]>('history');
    history.push(record);

    // 限制历史记录数量（默认保留最近 500 条）
    const MAX_HISTORY = 500;
    const trimmed = history.length > MAX_HISTORY
      ? history.slice(history.length - MAX_HISTORY)
      : history;

    await this.set('history', trimmed);

    // 更新最后分析时间
    await this.setMeta('last_analysis_at', Date.now());

    logger.debug(`[StorageManager] 已添加分析记录: ${record.id}`);
    return record.id;
  }

  /**
   * 查询历史记录
   *
   * @param options - 查询条件
   * @returns 符合条件的记录列表
   *
   * @example
   * ```ts
   * // 最近 10 条
   * const recent = await storage.getHistory({ limit: 10 });
   *
   * // 分页
   * const page = await storage.getHistory({ offset: 20, limit: 10 });
   *
   * // 按日期范围
   * const today = await storage.getHistory({
   *   from: Date.now() - 86400000,
   *   to: Date.now(),
   * });
   * ```
   */
  async getHistory(options?: {
    limit?: number;
    offset?: number;
    from?: number;
    to?: number;
    verdict?: string;
  }): Promise<AnalysisRecord[]> {
    const history = await this.get<AnalysisRecord[]>('history');

    let filtered = history;

    // 时间范围筛选
    if (options?.from !== undefined) {
      filtered = filtered.filter((r) => r.createdAt >= options.from!);
    }
    if (options?.to !== undefined) {
      filtered = filtered.filter((r) => r.createdAt <= options.to!);
    }

    // 结论类型筛选
    if (options?.verdict) {
      filtered = filtered.filter((r) =>
        r.result.conclusions.some((c) => c.verdict === options.verdict),
      );
    }

    // 按时间降序排列（最新的在前）
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    // 分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? filtered.length;

    return filtered.slice(offset, offset + limit);
  }

  /**
   * 删除单条历史记录
   *
   * @param recordId - 记录 ID
   * @returns 是否找到并删除
   */
  async removeHistory(recordId: string): Promise<boolean> {
    const history = await this.get<AnalysisRecord[]>('history');
    const idx = history.findIndex((r) => r.id === recordId);

    if (idx === -1) return false;

    history.splice(idx, 1);
    await this.set('history', history);

    logger.debug(`[StorageManager] 已删除分析记录: ${recordId}`);
    return true;
  }

  /**
   * 清空所有历史记录
   */
  async clearHistory(): Promise<void> {
    await this.set('history', []);
    logger.info('[StorageManager] 分析历史已清空');
  }

  /**
   * 获取历史记录统计
   */
  async getHistoryStats(): Promise<{
    total: number;
    byVerdict: Record<string, number>;
    lastWeek: number;
    lastMonth: number;
  }> {
    const history = await this.get<AnalysisRecord[]>('history');

    const byVerdict: Record<string, number> = {};
    const oneWeekAgo = Date.now() - 7 * 86400000;
    const oneMonthAgo = Date.now() - 30 * 86400000;

    let lastWeek = 0;
    let lastMonth = 0;

    for (const record of history) {
      // 按结论统计
      for (const c of record.result.conclusions) {
        byVerdict[c.verdict] = (byVerdict[c.verdict] ?? 0) + 1;
      }

      if (record.createdAt >= oneWeekAgo) lastWeek++;
      if (record.createdAt >= oneMonthAgo) lastMonth++;
    }

    return {
      total: history.length,
      byVerdict,
      lastWeek,
      lastMonth,
    };
  }

  // ═══════════════════════════════════════════════
  // 元数据管理
  // ═══════════════════════════════════════════════

  /**
   * 设置元数据
   */
  async setMeta(name: string, value: unknown): Promise<void> {
    const key: MetaKey = `meta_${name}`;
    await this.set(key, value, 'local');
  }

  /**
   * 读取元数据
   */
  async getMeta<T = unknown>(name: string): Promise<T | undefined> {
    const key: MetaKey = `meta_${name}`;
    return this.get<T | undefined>(key, 'local');
  }

  /**
   * 删除元数据
   */
  async removeMeta(name: string): Promise<void> {
    const key: MetaKey = `meta_${name}`;
    await this.remove(key, 'local');
  }

  // ═══════════════════════════════════════════════
  // 变更监听
  // ═══════════════════════════════════════════════

  /**
   * 监听指定键的变更
   *
   * @param key      - 要监听的键
   * @param callback - 变更回调 (newValue, oldValue)
   * @returns 取消监听的函数
   *
   * @example
   * ```ts
   * const unsub = storage.onChange('settings', (val, old) => {
   *   console.log('设置已更新', val);
   * });
   * // 不再需要时取消监听
   * unsub();
   * ```
   */
  onChange<T = unknown>(
    key: StorageKey,
    callback: (value: T | undefined, oldValue: T | undefined) => void,
  ): () => void {
    if (!this.changeListeners.has(key)) {
      this.changeListeners.set(key, new Set());
    }

    const listeners = this.changeListeners.get(key)!;
    listeners.add(callback as (value: unknown, oldValue: unknown) => void);

    // 返回取消函数
    return () => {
      listeners.delete(callback as (value: unknown, oldValue: unknown) => void);
      if (listeners.size === 0) {
        this.changeListeners.delete(key);
      }
    };
  }

  /**
   * 监听多个键的变更
   *
   * @param keys     - 要监听的键列表
   * @param callback - 变更回调 (changes)
   * @returns 取消监听的函数
   */
  onChangeMany(
    keys: StorageKey[],
    callback: (changes: Record<string, { newValue: unknown; oldValue: unknown }>) => void,
  ): () => void {
    const unsubs = keys.map((key) =>
      this.onChange(key, (newValue, oldValue) => {
        callback({ [key]: { newValue, oldValue } });
      }),
    );

    return () => unsubs.forEach((unsub) => unsub());
  }

  // ═══════════════════════════════════════════════
  // 数据迁移
  // ═══════════════════════════════════════════════

  /**
   * 从旧版存储迁移数据到新版 StorageManager 架构
   *
   * 旧版使用 `xvqiu_` 前缀键，新版使用规范化键名
   *
   * 迁移映射:
   *   xvqiu_settings   → settings
   *   deepseek_api_key → api_key
   *   xvqiu_installed_at → meta_installed_at
   *   xvqiu_version    → meta_version
   *
   * 幂等 —— 检查 meta_migrated 标记，已迁移则跳过
   */
  async migrateFromLegacy(): Promise<{ migrated: number; skipped: number }> {
    const migrated = await this.getMeta<boolean>('migrated');
    if (migrated) {
      logger.info('[StorageManager] 数据迁移已执行过，跳过');
      return { migrated: 0, skipped: 0 };
    }

    let count = 0;
    let skipped = 0;

    try {
      // 读取旧版存储
      const legacyData = await this.getChromeStorage('local').get([
        'xvqiu_settings',
        'deepseek_api_key',
        'xvqiu_installed_at',
        'xvqiu_version',
      ]);

      // 迁移 settings
      if (legacyData.xvqiu_settings) {
        const oldSettings = legacyData.xvqiu_settings as Record<string, unknown>;
        const newSettings: UserSettings = {
          model: (oldSettings.model as string) ?? DEFAULT_SETTINGS.model,
          temperature: (oldSettings.temperature as number) ?? DEFAULT_SETTINGS.temperature,
          maxTokens: (oldSettings.maxTokens as number) ?? DEFAULT_SETTINGS.maxTokens,
          autoAnalyze: (oldSettings.autoAnalyze as boolean) ?? DEFAULT_SETTINGS.autoAnalyze,
          maxConcurrent: (oldSettings.maxConcurrent as number) ?? DEFAULT_SETTINGS.maxConcurrent,
          debugMode: (oldSettings.debugMode as boolean) ?? DEFAULT_SETTINGS.debugMode,
        };
        await this.set('settings', newSettings);
        count++;
      } else {
        skipped++;
      }

      // 迁移 API Key
      if (legacyData.deepseek_api_key) {
        const key = legacyData.deepseek_api_key as string;
        if (key.trim()) {
          await this.set('api_key', key.trim());
          count++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }

      // 迁移元数据
      if (legacyData.xvqiu_installed_at) {
        await this.setMeta('installed_at', legacyData.xvqiu_installed_at);
        count++;
      } else {
        skipped++;
      }
      if (legacyData.xvqiu_version) {
        await this.setMeta('version', legacyData.xvqiu_version);
        count++;
      } else {
        skipped++;
      }

      // 清理旧版键
      await this.getChromeStorage('local').remove([
        'xvqiu_settings',
        'deepseek_api_key',
        'xvqiu_installed_at',
        'xvqiu_version',
      ]);

      // 标记迁移完成
      await this.setMeta('migrated', true);

      logger.info(`[StorageManager] 数据迁移完成: 迁移 ${count} 项，跳过 ${skipped} 项`);
    } catch (err) {
      logger.error('[StorageManager] 数据迁移失败:', err);
      throw err;
    }

    return { migrated: count, skipped };
  }

  // ═══════════════════════════════════════════════
  // 内部工具
  // ═══════════════════════════════════════════════

  /**
   * 获取 Chrome Storage 对象
   */
  private getChromeStorage(area: 'sync' | 'local'): chrome.storage.StorageArea {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new StorageError('Chrome Storage API 不可用', 'API_UNAVAILABLE');
    }

    return area === 'sync' ? chrome.storage.sync : chrome.storage.local;
  }

  /**
   * 解析键名对应的存储区域
   */
  private resolveArea(key: string): 'sync' | 'local' {
    // 已知键 → 按配置
    if (key in KEY_AREA) {
      return KEY_AREA[key as KnownKey];
    }

    // 缓存/元数据 → local
    if (key.startsWith('cache_') || key.startsWith('meta_')) {
      return 'local';
    }

    // 未知键 → 默认 local
    return 'local';
  }

  /**
   * 写入默认值（首次安装时）
   */
  private async ensureDefaults(): Promise<void> {
    const keys = Object.keys(KEY_AREA) as KnownKey[];

    // 读取所有已知键
    const syncKeys = keys.filter((k) => KEY_AREA[k] === 'sync');
    const localKeys = keys.filter((k) => KEY_AREA[k] === 'local');

    const [syncResult, localResult] = await Promise.all([
      syncKeys.length > 0
        ? this.getChromeStorage('sync').get(syncKeys)
        : Promise.resolve({}),
      localKeys.length > 0
        ? this.getChromeStorage('local').get(localKeys)
        : Promise.resolve({}),
    ]);

    const allExisting: Record<string, unknown> = { ...syncResult, ...localResult };

    // 对缺失的键写入默认值
    const toSet: Record<string, unknown> = {};

    for (const key of keys) {
      const knownKey = key as KnownKey;
      if (allExisting[key] === undefined) {
        toSet[key] = this.getDefault(knownKey);
      }
    }

    if (Object.keys(toSet).length === 0) {
      logger.debug('[StorageManager] 所有默认值已存在');
      return;
    }

    // 按区域分组写入
    const syncToSet: Record<string, unknown> = {};
    const localToSet: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(toSet)) {
      const area = this.resolveArea(key);
      if (area === 'sync') {
        syncToSet[key] = value;
      } else {
        localToSet[key] = value;
      }
    }

    await Promise.all([
      Object.keys(syncToSet).length > 0
        ? this.getChromeStorage('sync').set(syncToSet)
        : Promise.resolve(),
      Object.keys(localToSet).length > 0
        ? this.getChromeStorage('local').set(localToSet)
        : Promise.resolve(),
    ]);

    // 写入元数据
    await Promise.all([
      this.getChromeStorage('local').set({
        [META_KEYS.VERSION]: '1.0.0',
        [META_KEYS.INSTALLED_AT]: Date.now(),
      }),
    ]);

    logger.info(`[StorageManager] 默认值已写入: ${Object.keys(toSet).length} 项`);
  }

  /**
   * 预热内存缓存 — 从 Chrome Storage 读取所有已知键
   */
  private async warmCache(): Promise<void> {
    const knownKeys = Object.keys(KEY_AREA) as KnownKey[];

    const syncKeys = knownKeys.filter((k) => KEY_AREA[k] === 'sync');
    const localKeys = knownKeys.filter((k) => KEY_AREA[k] === 'local');

    const [syncResult, localResult] = await Promise.all([
      syncKeys.length > 0
        ? this.getChromeStorage('sync').get(syncKeys)
        : Promise.resolve({}),
      localKeys.length > 0
        ? this.getChromeStorage('local').get(localKeys)
        : Promise.resolve({}),
    ]);

    const all: Record<string, unknown> = { ...syncResult, ...localResult };

    for (const key of knownKeys) {
      this.memoryCache.set(key, all[key] ?? this.getDefault(key));
    }

    logger.debug(`[StorageManager] 内存缓存已预热: ${knownKeys.length} 个键`);
  }

  /**
   * 收集所有缓存键
   */
  private collectCacheKeys(): string[] {
    // 从内存缓存中收集
    const keys: string[] = [];
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith('cache_')) {
        keys.push(key);
      }
    }
    return keys;
  }

  /**
   * 收集所有元数据键
   */
  private collectMetaKeys(): string[] {
    const keys: string[] = [];
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith('meta_')) {
        keys.push(key);
      }
    }
    // 加上已知的元数据键
    for (const value of Object.values(META_KEYS)) {
      if (!keys.includes(value)) {
        keys.push(value);
      }
    }
    return keys;
  }

  /**
   * 绑定 chrome.storage.onChanged 监听
   */
  private bindOnChange(): void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
      logger.warn('[StorageManager] chrome.storage.onChanged 不可用');
      return;
    }

    chrome.storage.onChanged.addListener(
      (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
          // 只关心我们管理的键
          if (!this.isManagedKey(key)) continue;

          // 更新内存缓存
          this.memoryCache.set(key, newValue);

          // 通知监听器
          const listeners = this.changeListeners.get(key);
          if (listeners && listeners.size > 0) {
            for (const callback of listeners) {
              try {
                callback(newValue, oldValue);
              } catch (err) {
                logger.error(`[StorageManager] 变更监听回调出错 (${key}):`, err);
              }
            }
          }
        }
      },
    );

    this.onChangeBound = true;
    logger.debug('[StorageManager] onChanged 监听已绑定');
  }

  /**
   * 判断键是否由 StorageManager 管理
   */
  private isManagedKey(key: string): boolean {
    return (
      key in KEY_AREA ||
      key.startsWith('cache_') ||
      key.startsWith('meta_')
    );
  }

  /**
   * 校验值的合法性
   *
   * @throws {ValidationError} 校验不通过
   */
  private validateValue(key: string, value: unknown): void {
    if (value === null || value === undefined) {
      // 允许 null/undefined，统一转为 remove
      return;
    }

    switch (key) {
      case 'api_key': {
        if (typeof value !== 'string') {
          throw new ValidationError(key, 'API Key 必须是字符串');
        }
        if (value.length > 2048) {
          throw new ValidationError(key, 'API Key 长度超过 2048 字符');
        }
        break;
      }

      case 'settings': {
        if (typeof value !== 'object' || value === null) {
          throw new ValidationError(key, '设置必须是对象');
        }
        const s = value as Record<string, unknown>;
        if (typeof s.model !== 'string') {
          throw new ValidationError(key, 'model 必须是字符串');
        }
        if (typeof s.temperature !== 'number' || s.temperature < 0 || s.temperature > 2) {
          throw new ValidationError(key, 'temperature 必须在 0-2 范围内');
        }
        if (typeof s.maxTokens !== 'number' || s.maxTokens < 1 || s.maxTokens > 128_000) {
          throw new ValidationError(key, 'maxTokens 必须在 1-128000 范围内');
        }
        break;
      }

      case 'watchlist': {
        if (!Array.isArray(value)) {
          throw new ValidationError(key, '自选股必须是数组');
        }
        if (value.length > 200) {
          throw new ValidationError(key, '自选股数量超过 200 上限');
        }
        for (const item of value) {
          if (typeof item !== 'string') {
            throw new ValidationError(key, '自选股元素必须是字符串');
          }
        }
        break;
      }

      case 'history': {
        if (!Array.isArray(value)) {
          throw new ValidationError(key, '历史记录必须是数组');
        }
        break;
      }

      default: {
        // cache_* / meta_* 不做严格校验
        if (key.startsWith('cache_')) {
          if (typeof value !== 'object' || value === null) {
            throw new ValidationError(key, '缓存值必须是对象（CacheEntry）');
          }
        }
        break;
      }
    }
  }

  /**
   * 检查 sync 区域配额
   *
   * chrome.storage.sync 限制:
   *   - QUOTA_BYTES_PER_ITEM = 8,192 (每项 8KB)
   *   - QUOTA_BYTES = 102,400 (总计 100KB)
   *
   * @throws {QuotaExceededError} 超出配额
   */
  private checkSyncQuota(key: string, value: unknown): void {
    const size = this.estimateSize(value);

    if (size > 8192) {
      throw new QuotaExceededError(key, size, 8192);
    }
  }

  /**
   * 估算值的 JSON 序列化大小（字节）
   */
  private estimateSize(value: unknown): number {
    try {
      const json = JSON.stringify(value);
      return new TextEncoder().encode(json).length;
    } catch {
      return 0;
    }
  }

  /**
   * 将错误包装为 StorageError
   */
  private wrapError(err: unknown, fallbackMsg: string, key?: string): StorageError {
    if (err instanceof StorageError) return err;

    const message = err instanceof Error ? err.message : String(err);
    return new StorageError(
      `${fallbackMsg}: ${message}`,
      'UNKNOWN',
      key,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 生成简易 UUID v4
 */
function generateId(): string {
  const chars = '0123456789abcdef';
  const sections = [8, 4, 4, 4, 12];
  return sections
    .map((len) => {
      let s = '';
      for (let i = 0; i < len; i++) {
        s += chars[Math.floor(Math.random() * 16)];
      }
      return s;
    })
    .join('-');
}

/**
 * 深拷贝（JSON 序列化方式，适用于可序列化数据）
 */
function deepClone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

// ═══════════════════════════════════════════════════════════════
// 单例导出
// ═══════════════════════════════════════════════════════════════

/** 全局单例 */
export const storageManager = new StorageManager();
