/**
 * 日志工具
 * 分级日志，支持调试/信息/警告/错误级别
 *
 * @module utils/logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_PREFIX = '[xvqiu]';

const levelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 开发环境开启 debug 级别，生产环境 info 级别
// 通过 URL 参数 ?debug=true 或在 Console 中设置 localStorage.debug = 'true' 开启调试
const currentLevel: LogLevel =
  typeof window !== 'undefined' &&
  (window.location.search.includes('debug=true') ||
    window.localStorage?.getItem('xvqiu_debug') === 'true')
    ? 'debug'
    : 'info';

function log(level: LogLevel, ...args: any[]): void {
  if (levelOrder[level] < levelOrder[currentLevel]) return;

  const fn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'info'
          ? console.info
          : console.log;

  fn(LOG_PREFIX, `[${level.toUpperCase()}]`, ...args);
}

export const logger = {
  debug: (...args: any[]) => log('debug', ...args),
  info: (...args: any[]) => log('info', ...args),
  warn: (...args: any[]) => log('warn', ...args),
  error: (...args: any[]) => log('error', ...args),
};
