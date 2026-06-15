/**
 * Electron API 类型声明
 * 与 preload.ts 暴露的 window.electronAPI 对应
 *
 * @module shared/electron-api
 */

export interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  onStreamEvent: (callback: (event: unknown) => void) => () => void;
  startStream: (type: string, payload: unknown) => void;
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
    getWatchlist: () => Promise<Array<{ code: string; name: string; addedAt: number }>>;
    setWatchlist: (list: Array<{ code: string; name: string; addedAt: number }>) => Promise<void>;
    getHistory: (options?: unknown) => Promise<unknown[]>;
    addHistory: (record: unknown, note?: string, tags?: string[]) => Promise<string>;
    removeHistory: (id: string) => Promise<boolean>;
    clearHistory: () => Promise<void>;
  };
}

/** 全局 window 类型扩展 */
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
