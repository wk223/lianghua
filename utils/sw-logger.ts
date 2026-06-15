/**
 * Service Worker 日志工具 (Web 版兼容)
 * 不依赖 DOM API / Chrome API 的轻量日志
 *
 * @module utils/sw-logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[xvqiu:sw]';

let _debugEnabled = false;

// Web 版使用 localStorage 替代 chrome.storage
try {
  _debugEnabled = localStorage.getItem('xvqiu_debug') === 'true';
} catch {
  // 无痕模式忽略
}

const levelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  const effective: LogLevel = _debugEnabled ? 'debug' : 'info';
  return levelOrder[level] >= levelOrder[effective];
}

function log(level: LogLevel, ...args: unknown[]): void {
  if (!shouldLog(level)) return;

  const fn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'info'
          ? console.info
          : console.log;

  const timestamp = new Date().toISOString().slice(11, 23);
  fn(PREFIX, `[${timestamp}]`, `[${level.toUpperCase()}]`, ...args);
}

export const swLog = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
