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

// ─── 财联社 (cls.cn) API 原始响应 ────────────────────

/**
 * 财联社 sw API 统一响应外层
 *
 * POST https://www.cls.cn/api/sw?app=CailianpressWeb&os=web&sv=8.4.6
 *
 * 所有接口共用同一包裹格式:
 * {
 *   "code": 0,            // 0=成功
 *   "data": { ... },      // 具体数据
 *   "message": "success"
 * }
 */
export interface ClsApiEnvelope<T> {
  code: number;
  data: T;
  message?: string;
}

/**
 * 财联社快讯/电报列表响应 data 字段
 *
 * type="telegram" 时返回此结构
 */
export interface ClsRollData {
  /** 快讯列表 */
  roll_data: ClsFlashRawItem[];
  /** 是否有更多 */
  has_more: boolean;
  /** 分页游标 */
  cursor?: string;
  /** 当前分类 */
  category?: string;
}

/**
 * 财联社单条快讯/电报原始数据
 *
 * 字段名使用蛇形 (snake_case)，保持与 API 原始响应一致
 */
export interface ClsFlashRawItem {
  /** 唯一 ID */
  id: number;
  /** 标题（部分快讯无标题） */
  title?: string;
  /** 正文内容（HTML 格式可能包含富文本） */
  content: string;
  /** 创建时间 "2025-01-15 09:32:00" */
  ctime: string;
  /** 更新时间 */
  updated_at?: string;
  /** 来源（如"财联社"、"电报"） */
  source?: string;
  /** 是否重要 0=普通 1=重要 */
  is_important?: number;
  /** 关联股票代码，逗号分隔 "600519,000858" */
  stock_codes?: string;
  /** 关联股票名称，逗号分隔 */
  stock_name?: string;
  /** 分类标签 */
  category?: string;
  /** 阅读量 */
  read_count?: number;
}

/**
 * 财联社热门题材/概念 data 字段
 *
 * type="hot_topic" 时返回此结构
 */
export interface ClsTopicData {
  list: ClsTopicRawItem[];
}

/**
 * 财联社热门题材条目原始数据
 */
export interface ClsTopicRawItem {
  id: number;
  /** 题材名称 */
  name: string;
  /** 热度值 */
  hot_value: number;
  /** 相关股票数量 */
  stock_count: number;
  /** 今日涨幅 % */
  change_percent: number;
  /** 描述 */
  desc?: string;
  /** 领涨股 */
  lead_stock?: string;
  /** 领涨股涨幅 % */
  lead_change?: number;
}

/**
 * 财联社公告列表 data 字段
 *
 * type="announcement" 时返回此结构
 */
export interface ClsAnnouncementData {
  list: ClsAnnouncementRawItem[];
  has_more: boolean;
  cursor?: string;
}

/**
 * 财联社公告条目原始数据
 */
export interface ClsAnnouncementRawItem {
  id: number;
  /** 公告标题 */
  title: string;
  /** 公告摘要 */
  summary?: string;
  /** 关联股票代码 */
  stock_code: string;
  /** 关联股票名称 */
  stock_name: string;
  /** 发布时间 "2025-01-15 18:00:00" */
  ctime: string;
  /** 公告分类: 业绩预告/增减持/重组/分红/其他 */
  type: string;
  /** 公告原文 URL */
  url?: string;
}

/**
 * 财联社 API 请求类型枚举
 */
export type ClsApiType =
  | 'telegram'        // 电报/快讯
  | 'announcement'    // 公告
  | 'hot_topic'       // 热门题材
  | 'important_news'  // 重要新闻
  | 'live'           // 直播
  | 'roll';           // 滚动
