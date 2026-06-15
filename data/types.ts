/**
 * 数据类型定义
 * 数据层专用类型
 *
 * @module data/types
 */

// ─── 缓存相关 ──────────────────────────────────────────

/** 缓存条目 */
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/** 数据获取配置 */
export interface FetchOptions {
  /** 重试次数（默认 3） */
  retry?: number;
  /** 超时时间 ms（默认 8000） */
  timeout?: number;
  /** 是否使用缓存（默认 true） */
  useCache?: boolean;
  /** 缓存 TTL ms（默认 30000） */
  ttl?: number;
  /** 自定义请求头 */
  headers?: Record<string, string>;
}

// ─── 速率限制 ──────────────────────────────────────────

export interface RateLimitConfig {
  /** 时间窗口内最大请求数 */
  maxRequests: number;
  /** 时间窗口(ms) */
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 1000, // 5 req / sec
};

// ─── 东方财富 API 原始响应 ────────────────────────────

/**
 * 东方财富 API 统一响应外层结构
 *
 * 个股行情: { rc: 0, rt: 7, data: EastMoneyStockRaw }
 * 批量行情: { rc: 0, rt: 7, data: { total: number, diff: EastMoneyStockRaw[] } }
 */
export interface EastMoneyApiResponse<T> {
  rc: number;        // 返回码，0 表示成功
  rt: number;        // 返回码 2
  svr: number;       // 服务器 ID
  lt: number;        // 时间戳
  full: number;      // 是否全量
  data: T | null;
}

/** 东方财富原始个股行情字段（f 开头数字字段） */
export interface EastMoneyStockRaw {
  f43: number | null;   // 最新价
  f44: number | null;   // 最高价
  f45: number | null;   // 最低价
  f46: number | null;   // 开盘价
  f47: number | null;   // 成交量（手）
  f48: number | null;   // 成交额（元）
  f49: number | null;   // 振幅 %
  f50: number | null;   // 换手率 %
  f51: number | null;   // 量比
  f52: number | null;   // 涨跌额
  f55: number | null;   // 涨跌幅 %
  f57: string | null;   // 股票代码
  f58: string | null;   // 股票名称
  f60: number | null;   // 昨收价
  f116: number | null;  // 总市值
  f117: number | null;  // 流通市值
  f162: number | null;  // 市盈率(动态)
  f167: number | null;  // 市净率
  [key: string]: unknown;
}

/** 东方财富原始指数行情字段 */
export interface EastMoneyIndexRaw {
  f43: number | null;   // 当前点位
  f44: number | null;   // 最高点位
  f45: number | null;   // 最低点位
  f46: number | null;   // 开盘点位
  f47: number | null;   // 成交量（手）
  f48: number | null;   // 成交额（元）
  f50: number | null;   // 换手率（指数专用）
  f52: number | null;   // 涨跌额
  f55: number | null;   // 涨跌幅 %
  f57: string | null;   // 指数代码
  f58: string | null;   // 指数名称
  f60: number | null;   // 昨收点位
  f62: number | null;   // 上涨家数
  f115: number | null;  // 下跌家数
  f128: number | null;  // 领涨股票代码
  f140: number | null;  // 领涨股票名称
  f169: number | null;  // 上市天数
  f170: number | null;  // 总股本
  f171: number | null;  // 流通股本
  [key: string]: unknown;
}

/** 批量列表响应数据 */
export interface EastMoneyListData<T> {
  total: number;
  diff: T[];
}

/** 东方财富原始板块/概念行情字段 */
export interface EastMoneySectorRaw {
  f2: number | null;    // 板块指数值
  f3: number | null;    // 涨跌幅 %
  f4: number | null;    // 涨跌额
  f12: string | null;   // 板块代码 (BKxxxx)
  f14: string | null;   // 板块名称
  f20: number | null;   // 总市值
  f62: number | null;   // 领涨股代码(数字)
  f104: string | null;  // 领涨股名称
  f128: number | null;  // 领涨股涨跌幅 %
  f140: number | null;  // 上涨家数
  f141: number | null;  // 下跌家数
  f142: number | null;  // 资金净流入(万元)
  [key: string]: unknown;
}

/** 东方财富板块成分股原始字段 */
export interface EastMoneySectorStockRaw {
  f2: number | null;    // 最新价
  f3: number | null;    // 涨跌幅 %
  f4: number | null;    // 涨跌额
  f5: number | null;    // 成交量（手）
  f6: number | null;    // 成交额（元）
  f12: string | null;   // 股票代码
  f14: string | null;   // 股票名称
  [key: string]: unknown;
}

// ─── 统计 / 指标 ──────────────────────────────────────

export interface FetcherStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  failedRequests: number;
  rateLimited: number;
}
