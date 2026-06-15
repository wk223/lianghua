/**
 * xvqiu Electron 文件存储
 * 替换 Chrome Extension 的 chrome.storage
 *
 * 使用本地 JSON 文件持久化数据
 * 路径: app.getPath('userData')/xvqiu-data.json
 *
 * @module electron/store
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisResult } from '../utils/types';

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

export interface StoreData {
  api_key: string;
  settings: UserSettings;
  watchlist: Array<{ code: string; name: string; addedAt: number }>;
  history: AnalysisRecord[];
  meta: Record<string, unknown>;
  cache: Record<string, { data: unknown; timestamp: number; ttl: number }>;
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

const DEFAULT_DATA: StoreData = {
  api_key: '',
  settings: { ...DEFAULT_SETTINGS },
  watchlist: [],
  history: [],
  meta: {
    installed_at: Date.now(),
    version: '1.0.0',
  },
  cache: {},
};

// ═══════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════

export class FileStore {
  private data: StoreData;
  private filePath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'xvqiu-data.json');
    this.data = this.load();
  }

  // ─── 文件读写 ──────────────────────────────────

  private load(): StoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_DATA, ...parsed };
      }
    } catch (err) {
      console.error('[FileStore] 读取失败，使用默认值:', err);
    }
    return { ...DEFAULT_DATA, meta: { ...DEFAULT_DATA.meta } };
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err) {
      console.error('[FileStore] 写入失败:', err);
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.dirty) this.save();
    }, 500); // 防抖 500ms
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

  getAll(): StoreData {
    return { ...this.data };
  }

  resetAll(): void {
    this.data = { ...DEFAULT_DATA, meta: { ...DEFAULT_DATA.meta } };
    this.save();
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

  clearCache(): void {
    this.data.cache = {};
    this.scheduleSave();
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
    const id = this.generateId();
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

  // ─── 工具 ────────────────────────────────────

  private generateId(): string {
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

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    if (this.dirty) {
      this.save();
    }
  }
}

// ─── 单例 ──────────────────────────────────────────

let storeInstance: FileStore | null = null;

export function getStore(): FileStore {
  if (!storeInstance) {
    storeInstance = new FileStore();
  }
  return storeInstance;
}
