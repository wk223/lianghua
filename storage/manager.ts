/**
 * Storage 管理器 (Web 版)
 * 基于 localStorage 持久化存储
 * 替代 Electron 的 electron-store 和 Chrome Extension 的 chrome.storage
 *
 * @module storage/manager
 */

import type { AnalysisResult } from '../utils/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export interface UserSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  autoAnalyze: boolean;
  maxConcurrent: number;
  debugMode: boolean;
}

export interface AnalysisRecord {
  id: string;
  createdAt: number;
  note?: string;
  tags?: string[];
  result: AnalysisResult;
}

export interface StorageSchema {
  api_key: string;
  settings: UserSettings;
  watchlist: Array<{ code: string; name: string; addedAt: number }>;
  history: AnalysisRecord[];
  meta: Record<string, unknown>;
  cache: Record<string, { data: unknown; timestamp: number; ttl: number }>;
  /** 价格预警配置列表 */
  priceAlerts: import('../utils/types').PriceAlertConfig[];
}

// ═══════════════════════════════════════════════════════════════
// 默认值
// ═══════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS: UserSettings = {
  model: 'deepseek-chat',
  temperature: 0.7,
  maxTokens: 4096,
  autoAnalyze: false,
  maxConcurrent: 3,
  debugMode: false,
};

const DEFAULT_DATA: StorageSchema = {
  api_key: '',
  settings: { ...DEFAULT_SETTINGS },
  watchlist: [],
  history: [],
  meta: {
    installed_at: Date.now(),
    version: '1.0.0',
  },
  cache: {},
  priceAlerts: [],
};

const STORAGE_KEY = 'xvqiu_data';

// ═══════════════════════════════════════════════════════════════
// StorageManager (localStorage 实现)
// ═══════════════════════════════════════════════════════════════

export class StorageManager {
  private data: StorageSchema;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.data = this.load();
  }

  // ─── 文件读写 ──────────────────────────────────

  private load(): StorageSchema {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StorageSchema>;
        return { ...DEFAULT_DATA, ...parsed, meta: { ...DEFAULT_DATA.meta, ...parsed.meta } };
      }
    } catch (err) {
      console.error('[StorageManager] 读取 localStorage 失败，使用默认值:', err);
    }
    return { ...DEFAULT_DATA, meta: { ...DEFAULT_DATA.meta } };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.dirty = false;
    } catch (err) {
      console.error('[StorageManager] 写入 localStorage 失败:', err);
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.dirty) this.save();
    }, 300);
  }

  // ─── 通用读写 ──────────────────────────────────

  get<T = unknown>(key: string): T | undefined {
    return (this.data as unknown as Record<string, unknown>)[key] as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    (this.data as unknown as Record<string, unknown>)[key] = value;
    this.scheduleSave();
  }

  remove(key: string): void {
    delete (this.data as unknown as Record<string, unknown>)[key];
    this.scheduleSave();
  }

  has(key: string): boolean {
    return key in this.data;
  }

  getAll(): StorageSchema {
    return { ...this.data };
  }

  // ─── 缓存 ──────────────────────────────────────

  getCache<T>(name: string): T | null {
    const entry = this.data.cache[name];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      delete this.data.cache[name];
      this.scheduleSave();
      return null;
    }
    return entry.data as T;
  }

  setCache<T>(name: string, data: T, ttl: number = 30_000): void {
    this.data.cache[name] = { data, timestamp: Date.now(), ttl };
    this.scheduleSave();
  }

  removeCache(name: string): void {
    delete this.data.cache[name];
    this.scheduleSave();
  }

  /** 兼容旧 API 的别名 */
  clearAllCache(): void {
    this.clearCache();
  }

  clearCache(): void {
    this.data.cache = {};
    this.scheduleSave();
  }

  // ─── 价格预警 ──────────────────────────────────

  /**
   * 获取所有价格预警配置
   */
  getPriceAlerts(): import('../utils/types').PriceAlertConfig[] {
    return [...this.data.priceAlerts];
  }

  /**
   * 新增价格预警
   * @returns 预警 ID
   */
  addPriceAlert(alert: Omit<import('../utils/types').PriceAlertConfig, 'id' | 'createdAt'>): string {
    const id = generateId();
    const newAlert: import('../utils/types').PriceAlertConfig = {
      ...alert,
      id,
      createdAt: Date.now(),
    };
    this.data.priceAlerts.push(newAlert);
    this.scheduleSave();
    return id;
  }

  /**
   * 更新价格预警
   */
  updatePriceAlert(id: string, updates: Partial<import('../utils/types').PriceAlertConfig>): boolean {
    const idx = this.data.priceAlerts.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.data.priceAlerts[idx] = { ...this.data.priceAlerts[idx], ...updates };
    this.scheduleSave();
    return true;
  }

  /**
   * 删除价格预警
   */
  removePriceAlert(id: string): boolean {
    const idx = this.data.priceAlerts.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.data.priceAlerts.splice(idx, 1);
    this.scheduleSave();
    return true;
  }

  /**
   * 启用/禁用价格预警
   */
  togglePriceAlert(id: string, enabled: boolean): boolean {
    return this.updatePriceAlert(id, { enabled });
  }

  /**
   * 更新预警触发时间
   */
  markPriceAlertTriggered(id: string): boolean {
    return this.updatePriceAlert(id, { lastTriggeredAt: Date.now() });
  }

  /**
   * 获取所有启用的预警（用于轮询检查）
   */
  getEnabledPriceAlerts(): import('../utils/types').PriceAlertConfig[] {
    return this.data.priceAlerts.filter((a) => a.enabled);
  }

  // ─── 历史记录 ──────────────────────────────────

  getHistory(options?: {
    limit?: number;
    offset?: number;
    from?: number;
    to?: number;
    verdict?: string;
  }): AnalysisRecord[] {
    let filtered = [...this.data.history];

    if (options?.from !== undefined) {
      filtered = filtered.filter((r) => r.createdAt >= options.from!);
    }
    if (options?.to !== undefined) {
      filtered = filtered.filter((r) => r.createdAt <= options.to!);
    }
    if (options?.verdict) {
      filtered = filtered.filter((r) =>
        r.result.conclusions.some((c) => c.verdict === options.verdict),
      );
    }

    filtered.sort((a, b) => b.createdAt - a.createdAt);

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? filtered.length;
    return filtered.slice(offset, offset + limit);
  }

  addHistory(record: AnalysisResult, note?: string, tags?: string[]): string {
    const id = generateId();
    const entry: AnalysisRecord = {
      id,
      createdAt: Date.now(),
      note,
      tags,
      result: record,
    };
    this.data.history.push(entry);

    // 限制 500 条
    if (this.data.history.length > 500) {
      this.data.history = this.data.history.slice(-500);
    }

    this.scheduleSave();
    return id;
  }

  removeHistory(id: string): boolean {
    const idx = this.data.history.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.data.history.splice(idx, 1);
    this.scheduleSave();
    return true;
  }

  clearHistory(): void {
    this.data.history = [];
    this.scheduleSave();
  }

  // ─── 元数据 ──────────────────────────────────

  setMeta(name: string, value: unknown): void {
    this.data.meta[name] = value;
    this.scheduleSave();
  }

  getMeta<T = unknown>(name: string): T | undefined {
    return this.data.meta[name] as T | undefined;
  }

  removeMeta(name: string): void {
    delete this.data.meta[name];
    this.scheduleSave();
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// 单例导出
// ═══════════════════════════════════════════════════════════════

export const storageManager = new StorageManager();
