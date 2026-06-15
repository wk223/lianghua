/**
 * xvqiu Electron Main Process
 *
 * 职责:
 *   1. 创建主窗口（替换 Chrome Side Panel）
 *   2. 注册 IPC handlers (替换 service-worker.ts)
 *   3. 注册 Storage IPC handlers (替换 chrome.storage)
 *   4. 管理窗口生命周期
 *
 * @module electron/main
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers, registerStreamIpcHandlers } from './ipc';
import { getStore } from './store';
// Re-route logger for main process context
function logger(info: string, ...args: unknown[]): void {
  console.log(`[Main] ${info}`, ...args);
}

// ═══════════════════════════════════════════════════════════════
// __dirname for ESM
// ═══════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

const isDev = !app.isPackaged;
const APP_NAME = 'xvqiu - A股短线交易决策助手';

let mainWindow: BrowserWindow | null = null;

// ═══════════════════════════════════════════════════════════════
// 窗口创建
// ═══════════════════════════════════════════════════════════════

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    icon: path.join(__dirname, '../icons/icon-128.png'),
    width: 420,
    height: 720,
    minWidth: 360,
    minHeight: 500,
    resizable: true,
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // ─── 加载页面 ──────────────────────────────
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // ─── 窗口事件 ──────────────────────────────
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ─── 阻止外链导航 ─────────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (url.startsWith('https://platform.deepseek.com')) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });

  logger(`窗口已创建 (${isDev ? '开发' : '生产'}模式)`);
}

// ═══════════════════════════════════════════════════════════════
// Storage IPC Handlers
// ═══════════════════════════════════════════════════════════════

function registerStoreIpcHandlers(): void {
  const store = getStore();

  ipcMain.handle('store:get', (_event: Electron.IpcMainInvokeEvent, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('store:set', (_event: Electron.IpcMainInvokeEvent, key: string, value: unknown) => {
    store.set(key, value);
  });

  ipcMain.handle('store:remove', (_event: Electron.IpcMainInvokeEvent, key: string) => {
    store.remove(key);
  });

  ipcMain.handle('store:getWatchlist', () => {
    return store.get<Array<{ code: string; name: string; addedAt: number }>>('watchlist') ?? [];
  });

  ipcMain.handle('store:setWatchlist', (_event: Electron.IpcMainInvokeEvent, list: Array<{ code: string; name: string; addedAt: number }>) => {
    store.set('watchlist', list);
  });

  ipcMain.handle('store:getHistory', (_event: Electron.IpcMainInvokeEvent, options?: unknown) => {
    return store.getHistory(options as any);
  });

  ipcMain.handle('store:addHistory', (_event: Electron.IpcMainInvokeEvent, record: unknown, note?: string, tags?: string[]) => {
    return store.addHistory(record as any, note, tags);
  });

  ipcMain.handle('store:removeHistory', (_event: Electron.IpcMainInvokeEvent, id: string) => {
    return store.removeHistory(id);
  });

  ipcMain.handle('store:clearHistory', () => {
    store.clearHistory();
  });

  logger('Storage IPC handlers 已注册');
}

// ═══════════════════════════════════════════════════════════════
// 应用生命周期
// ═══════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  logger(`${APP_NAME} 启动中...`);

  registerIpcHandlers();
  registerStreamIpcHandlers();
  registerStoreIpcHandlers();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    const store = getStore();
    store.close();
    app.quit();
  }
});

app.on('before-quit', () => {
  const store = getStore();
  store.close();
});
