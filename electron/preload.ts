/**
 * xvqiu Preload Script
 * 通过 contextBridge 暴露安全的 IPC API 给渲染进程
 *
 * @module electron/preload
 */

import { contextBridge, ipcRenderer } from 'electron';

// ═══════════════════════════════════════════════════════════════
// IPC API 类型（与渲染进程共享）
// ═══════════════════════════════════════════════════════════════

export interface ElectronAPI {
  // ─── 请求-响应 IPC ─────────────────────────
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;

  // ─── 流式事件监听 ──────────────────────────
  onStreamEvent: (callback: (event: unknown) => void) => () => void;

  // ─── 启动流式分析 ─────────────────────────
  startStream: (type: string, payload: unknown) => void;

  // ─── 存储 ──────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════
// 暴露 API
// ═══════════════════════════════════════════════════════════════

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── 通用 invoke ────────────────────────────
  invoke: (channel: string, ...args: unknown[]) => {
    // 白名单频道
    const allowedChannels = [
      'PING',
      'ENV_CHECK',
      'ANALYZE_POOL',
      'ANALYZE_SINGLE',
      'GET_QUOTE',
      'GET_MARKET',
      'GET_SECTOR',
    ];
    if (allowedChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`不允许的 IPC 频道: ${channel}`));
  },

  // ─── 流式事件 ───────────────────────────────
  onStreamEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => {
      callback(data);
    };
    ipcRenderer.on('stream:event', handler);

    // 返回取消监听的函数
    return () => {
      ipcRenderer.removeListener('stream:event', handler);
    };
  },

  // ─── 启动流式分析 ─────────────────────────
  startStream: (type: string, payload: unknown) => {
    ipcRenderer.send('stream:start', { type, payload });
  },

  // ─── 存储 ────────────────────────────────────
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    remove: (key: string) => ipcRenderer.invoke('store:remove', key),
    getWatchlist: () => ipcRenderer.invoke('store:getWatchlist'),
    setWatchlist: (list: Array<{ code: string; name: string; addedAt: number }>) =>
      ipcRenderer.invoke('store:setWatchlist', list),
    getHistory: (options?: unknown) => ipcRenderer.invoke('store:getHistory', options),
    addHistory: (record: unknown, note?: string, tags?: string[]) =>
      ipcRenderer.invoke('store:addHistory', record, note, tags),
    removeHistory: (id: string) => ipcRenderer.invoke('store:removeHistory', id),
    clearHistory: () => ipcRenderer.invoke('store:clearHistory'),
  },
} satisfies ElectronAPI);
