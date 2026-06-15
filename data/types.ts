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

// ─── 同花顺 (10jqka) API 原始响应 ──────────────────────

/**
 * 同花顺 realhead API 响应结构
 *
 * JSONP 包裹: quotebridge_v2_realhead_hs_{code}_last({...})
 * 实际解析时去除 JSONP 回调外层
 *
 * 个股: d.10jqka.com.cn/v2/realhead/hs_{code}/last.js
 * 指数: d.10jqka.com.cn/v2/realhead/index_{code}/last.js
 */
export interface ThsRealheadResponse {
  /** 数值字段映射 (数字键 → 字符串值) */
  items: Record<string, string>;
  /** 股票/指数名称 */
  name?: string;
  /** 停牌状态: 0=正常 */
  stop?: number;
  /** 行情时间 */
  time?: string;
  /** 市场类型 (如 HS_stock_sh) */
  marketType?: string;
  /** 股票代码 (外层冗余) */
  "5"?: string;
  /** 股票状态 */
  stockStatus?: string;
  [key: string]: unknown;
}

/**
 * 同花顺板块/行业行情行 (从 q.10jqka.com.cn HTML 解析)
 *
 * HTML 表格列顺序:
 * 序号 | 名称 | 涨幅(%) | 总成交额(亿) | 总成交额(元) | 资金流入(万) |
 * 上涨家数 | 下跌家数 | 领涨股 | 领涨股涨幅(%) | ...
 */
export interface ThsSectorRow {
  /** 板块名称 */
  name: string;
  /** 涨跌幅 % */
  changePercent: number;
  /** 总成交额 (万元) */
  totalAmount: number;
  /** 资金净流入 (万元) */
  capitalFlow: number;
  /** 上涨家数 */
  upCount: number;
  /** 下跌家数 */
  downCount: number;
  /** 领涨股名称 */
  leadingStock: string;
  /** 领涨股涨幅 % */
  leadingChange: number;
}

// ─── 统计 / 指标 ──────────────────────────────────────

export interface FetcherStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  failedRequests: number;
  rateLimited: number;
}
