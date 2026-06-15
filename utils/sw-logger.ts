/**
 * Service Worker 日志工具
 * 不依赖 DOM API 的轻量日志，兼容 Service Worker 上下文
 *
 * @module utils/sw-logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[xvqiu:sw]';

// 通过 chrome.storage.local 中的调试开关控制日志级别
// 在 Console 中执行: chrome.storage.local.set({ xvqiu_debug: true })
let _debugEnabled = false;

// 初始化读取调试开关（异步，首次可能错过几条日志）
chrome.storage.local.get('xvqiu_debug').then((res) => {
  _debugEnabled = res.xvqiu_debug === true;
}).catch(() => {
  // storage 不可用时默认关闭
});

// 监听调试开关变更
chrome.storage.onChanged.addListener((changes) => {
  if (changes.xvqiu_debug !== undefined) {
    _debugEnabled = changes.xvqiu_debug.newValue === true;
  }
});

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
