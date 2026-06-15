/**
 * 东方财富数据适配器
 * 获取个股行情 + 大盘指数 + 板块/题材数据
 *
 * @module data/eastmoney
 *
 * 设计说明:
 * - 封装东方财富 push2 API 调用
 * - 提供 getQuote / getQuotes / getMarketIndex / getSectors /
 *   getSectorDetail / getHotTopics 六种接口
 * - 内部完成 secid 构造、原始响应解析、字段映射
 * - 复用 DataFetcher 的速率限制 + 缓存 + 重试
 *
 * API 参考:
 *   个股:     push2.eastmoney.com/api/qt/stock/get
 *   批量:     push2.eastmoney.com/api/qt/ulist.np/get
 *   板块列表: push2.eastmoney.com/api/qt/clist/get
 */

import type {
  StockQuote,
  MarketIndex,
  SectorData,
  SectorDetail,
  SectorStock,
  HotTopic,
} from '../utils/types';
import type {
  EastMoneyApiResponse,
  EastMoneyStockRaw,
  EastMoneyIndexRaw,
  EastMoneySectorRaw,
  EastMoneySectorStockRaw,
  EastMoneyListData,
  FetchOptions,
} from './types';
import { DataFetcher } from './fetcher';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/**
 * 东方财富 push2 API 基础 URL
 *
 * 开发环境: 通过 Vite proxy 转发 (解决浏览器 CORS 限制)
 * 生产环境: 直连东方财富 API（需 nginx 配置反向代理 /api/eastmoney）
 *
 * 注意: 生产构建后，需要 nginx 将 /api/eastmoney/* 反向代理到
 *       https://push2.eastmoney.com，否则前端无法跨域访问。
 */
/**
 * 东方财富 API 通过 Vite 代理转发（开发环境）或 nginx 反向代理（生产环境）
 * 解决浏览器端直接请求 push2.eastmoney.com 的 CORS 限制。
 *
 * ⚠️ 生产部署必须配置 nginx:
 *   location /api/eastmoney/ {
 *     proxy_pass https://push2.eastmoney.com/;
 *   }
 */
const API_BASE = '/api/eastmoney/api/qt';

/** 个股行情 API 路径 */
const STOCK_GET_PATH = '/stock/get';

/** 批量列表 API 路径 */
const ULIST_PATH = '/ulist.np/get';

/** 板块分类列表 API 路径 */
const CLIST_PATH = '/clist/get';

/** 板块/概念行情的请求字段 */
const SECTOR_FIELDS =
  'f2,f3,f4,f12,f14,f20,f62,f104,f128,f140,f141,f142';

/** 板块成分股的请求字段 */
const SECTOR_STOCK_FIELDS =
  'f2,f3,f4,f5,f6,f12,f14';

/**
 * 个股行情的请求字段
 * 覆盖 StockQuote 接口所有字段 + 预留字段
 */
const STOCK_FIELDS =
  'f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f55,f57,f58,f60,f116,f117,f162,f167';

/**
 * 指数行情的请求字段
 * 覆盖 MarketIndex 接口 + 上涨/下跌家数
 */
const INDEX_FIELDS =
  'f43,f44,f45,f46,f47,f48,f50,f52,f55,f57,f58,f60,f62,f115,f128,f140';

/** 大盘指数 secid 列表 */
const INDEX_SECIDS = [
  '1.000001',  // 上证指数
  '0.399001',  // 深证成指
  '0.399006',  // 创业板指
  '1.000688',  // 科创50
] as const;

/** 交易所映射: stock code prefix → East Money market code */
const EXCHANGE_MAP: Record<string, number> = {
  '6': 1,   // SH
  '5': 1,   // SH 基金/债券
  '0': 0,   // SZ 主板
  '3': 0,   // SZ 创业板
  '4': 0,   // BJ / 新三板
  '8': 0,   // BJ 北交所
};

/** 默认缓存 TTL（行情数据 10 秒） */
const QUOTE_TTL = 10_000;

/** 指数缓存 TTL（指数数据 15 秒） */
const INDEX_TTL = 15_000;

// ═══════════════════════════════════════════════════════════════
// EastMoneyAdapter
// ═══════════════════════════════════════════════════════════════

export class EastMoneyAdapter {
  private fetcher: DataFetcher;

  /**
   * @param fetcher 可注入自定义 DataFetcher（便于测试 / 共享限制器）
   */
  constructor(fetcher?: DataFetcher) {
    this.fetcher = fetcher ?? new DataFetcher();
  }

  // ─── 公开接口 ──────────────────────────────────────────

  /**
   * 获取个股实时行情
   *
   * @param code 股票代码（6 位数字，如 "600519"）
   * @returns StockQuote
   * @throws 股票代码无效 / 网络异常 / API 返回空数据
   */
  async getQuote(code: string, options?: FetchOptions): Promise<StockQuote> {
    const cleanCode = code.replace(/^(SH|SZ|BJ)/i, '').trim();

    if (!/^\d{6}$/.test(cleanCode)) {
      throw new Error(`无效的股票代码: ${code}，应为 6 位数字`);
    }

    const secid = buildSecId(cleanCode);
    const url = buildStockGetUrl(secid);

    const response = await this.fetcher.fetchJSON<
      EastMoneyApiResponse<EastMoneyStockRaw>
    >(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options,
    });

    if (!response.data) {
      throw new Error(`东方财富 API 返回空数据: code=${code}`);
    }

    return parseStockQuote(response.data, cleanCode);
  }

  /**
   * 批量获取个股实时行情
   *
   * @param codes 股票代码数组（每个 6 位数字）
   * @param options 可选覆写请求配置
   * @returns StockQuote[] — 成功解析的行情列表（失败的静默忽略）
   */
  async getQuotes(codes: string[], options?: FetchOptions): Promise<StockQuote[]> {
    if (codes.length === 0) return [];
    if (codes.length > 50) {
      throw new Error('批量查询最多支持 50 只股票');
    }

    const validCodes = codes
      .map((c) => c.replace(/^(SH|SZ|BJ)/i, '').trim())
      .filter((c) => /^\d{6}$/.test(c));

    if (validCodes.length === 0) return [];

    const secids = validCodes.map(buildSecId);
    const url = buildUlistUrl(secids, STOCK_FIELDS);

    const response = await this.fetcher.fetchJSON<
      EastMoneyApiResponse<EastMoneyListData<EastMoneyStockRaw>>
    >(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options,
    });

    if (!response.data || !response.data.diff) {
      return [];
    }

    return response.data.diff
      .filter((raw) => raw !== null && raw.f57 !== null)
      .map((raw) => parseStockQuote(raw));
  }

  /**
   * 获取大盘指数数据
   * 返回 [上证指数, 深证成指, 创业板指, 科创50]
   */
  async getMarketIndex(options?: FetchOptions): Promise<MarketIndex[]> {
    const url = buildUlistUrl([...INDEX_SECIDS], INDEX_FIELDS);

    const response = await this.fetcher.fetchJSON<
      EastMoneyApiResponse<EastMoneyListData<EastMoneyIndexRaw>>
    >(url, {
      useCache: true,
      ttl: INDEX_TTL,
      ...options,
    });

    if (!response.data || !response.data.diff) {
      return [];
    }

    return response.data.diff
      .filter((raw) => raw !== null && raw.f57 !== null)
      .map(parseMarketIndex);
  }

  // ─── 板块/题材接口 ──────────────────────────────────

  /**
   * 获取板块行情列表（按涨幅降序）
   *
   * 请求东方财富行业板块（m:90+t:2），返回涨幅前 20 的板块
   *
   * @param options 可选覆写请求配置
   * @returns SectorData[]
   */
  async getSectors(options?: FetchOptions): Promise<SectorData[]> {
    const url = buildClistUrl('m:90+t:2', 20, SECTOR_FIELDS, 'f3');

    const response = await this.fetcher.fetchJSON<
      EastMoneyApiResponse<EastMoneyListData<EastMoneySectorRaw>>
    >(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options,
    });

    if (!response.data || !response.data.diff) {
      return [];
    }

    return response.data.diff
      .filter((raw) => raw !== null && raw.f12 !== null)
      .map(parseSectorData);
  }

  /**
   * 获取板块明细（含成分股列表）
   *
   * 先通过 ulist.np/get 获取板块元数据（市场 90），
   * 再通过 clist/get 获取成分股行情
   *
   * @param code 板块代码（如 "BK0477" 或 "BK0477"）
   * @param options 可选覆写请求配置
   * @returns SectorDetail
   * @throws 板块代码无效 / 板块不存在
   */
  async getSectorDetail(
    code: string,
    options?: FetchOptions,
  ): Promise<SectorDetail> {
    // 规范化板块代码：去除 "BK" 前缀后重组
    const cleanCode = code.replace(/^BK/i, '').trim().toUpperCase();
    const sectorCode = `BK${cleanCode}`;

    if (!/^BK\d{4}$/i.test(sectorCode)) {
      throw new Error(
        `无效的板块代码: ${code}，应为 BK + 4 位数字（如 BK0477）`,
      );
    }

    // ── 1) 获取板块元数据 ──
    // 板块使用市场代码 90，secid = "90.BKxxxx"
    const secid = `90.${sectorCode}`;
    const metaUrl = buildUlistUrl([secid], SECTOR_FIELDS);

    const metaResp = await this.fetcher.fetchJSON<
      EastMoneyApiResponse<EastMoneyListData<EastMoneySectorRaw>>
    >(metaUrl, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options,
    });

    if (!metaResp.data?.diff?.[0]) {
      throw new Error(`板块不存在: ${sectorCode}`);
    }

    const sector = parseSectorData(metaResp.data.diff[0]);

    // ── 2) 获取成分股行情 ──
    const stocksUrl = buildClistUrl(`b:${sectorCode}`, 50, SECTOR_STOCK_FIELDS, 'f3');

    const stocksResp = await this.fetcher.fetchJSON<
      EastMoneyApiResponse<EastMoneyListData<EastMoneySectorStockRaw>>
    >(stocksUrl, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options,
    });

    const stocks = (stocksResp.data?.diff ?? [])
      .filter((raw) => raw !== null && raw.f12 !== null)
      .map(parseSectorStock);

    return { sector, stocks };
  }

  /**
   * 获取热门题材/概念列表
   *
   * 请求东方财富概念板块（m:90+t:3），按涨幅降序返回前 20
   *
   * @param options 可选覆写请求配置
   * @returns HotTopic[]
   */
  async getHotTopics(options?: FetchOptions): Promise<HotTopic[]> {
    const url = buildClistUrl('m:90+t:3', 20, SECTOR_FIELDS, 'f3');

    const response = await this.fetcher.fetchJSON<
      EastMoneyApiResponse<EastMoneyListData<EastMoneySectorRaw>>
    >(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options,
    });

    if (!response.data || !response.data.diff) {
      return [];
    }

    return response.data.diff
      .filter((raw) => raw !== null && raw.f12 !== null)
      .map(parseHotTopic);
  }

  /**
   * 获取底层 DataFetcher 实例
   * 用于统计 / 缓存操作
   */
  getFetcher(): DataFetcher {
    return this.fetcher;
  }
}

// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 根据股票代码前缀获取交易所代码
 * SH(6) → 1, SZ(0/3) → 0, BJ(4/8) → 0
 */
function getMarketCode(code: string): number {
  const prefix = code.charAt(0);
  return EXCHANGE_MAP[prefix] ?? 0;
}

/**
 * 构建东方财富 secid 格式 "市场代码.股票代码"
 * 如 "1.600519"（上证）或 "0.000001"（深证）
 */
function buildSecId(code: string): string {
  const market = getMarketCode(code);
  return `${market}.${code}`;
}

/**
 * 构建个股行情查询 URL
 */
function buildStockGetUrl(secid: string): string {
  const params = new URLSearchParams({
    fltt: '2',
    secid,
    fields: STOCK_FIELDS,
    _: String(Date.now()),
  });
  return `${API_BASE}${STOCK_GET_PATH}?${params.toString()}`;
}

/**
 * 构建板块分类列表查询 URL
 *
 * @param fs    分类过滤器，如 "m:90+t:2"（行业板块）、"b:BK0477"（成分股）
 * @param pz    每页条数
 * @param fields 请求字段
 * @param fid   排序字段（默认 f3 涨跌幅）
 * @param po    排序方向（1=降序，0=升序，默认 1）
 */
function buildClistUrl(
  fs: string,
  pz: number,
  fields: string,
  fid: string = 'f3',
  po: number = 1,
): string {
  const params = new URLSearchParams({
    pn: '1',
    pz: String(pz),
    po: String(po),
    np: '1',
    fltt: '2',
    invt: '2',
    fid,
    fs,
    fields,
    _: String(Date.now()),
  });
  return `${API_BASE}${CLIST_PATH}?${params.toString()}`;
}

/**
 * 构建批量列表查询 URL
 */
function buildUlistUrl(secids: string[], fields: string): string {
  const params = new URLSearchParams({
    fltt: '2',
    secids: secids.join(','),
    fields,
    _: String(Date.now()),
  });
  return `${API_BASE}${ULIST_PATH}?${params.toString()}`;
}

/**
 * 解析东方财富原始个股行情 → StockQuote
 * 空值统一转为 0
 */
function parseStockQuote(raw: EastMoneyStockRaw, fallbackCode?: string): StockQuote {
  const code = raw.f57 ?? fallbackCode ?? '000000';
  const price = safeNumber(raw.f43, 0);
  const preClose = safeNumber(raw.f60, price);
  const change = safeNumber(raw.f52, 0);
  const changePercent = safeNumber(raw.f55, 0);

  return {
    code,
    name: raw.f58 ?? '',
    price,
    change,
    changePercent,
    volume: safeNumber(raw.f47, 0),
    turnover: safeNumber(raw.f48, 0),
    high: safeNumber(raw.f44, price),
    low: safeNumber(raw.f45, price),
    open: safeNumber(raw.f46, price),
    amplitude: safeNumber(raw.f49, 0),
    turnoverRate: safeNumber(raw.f50, 0),
  };
}

/**
 * 解析东方财富原始指数行情 → MarketIndex
 */
function parseMarketIndex(raw: EastMoneyIndexRaw): MarketIndex {
  const price = safeNumber(raw.f43, 0);
  const change = safeNumber(raw.f52, 0);

  return {
    code: raw.f57 ?? '000000',
    name: raw.f58 ?? '',
    price,
    change,
    changePercent: safeNumber(raw.f55, 0),
    volume: safeNumber(raw.f47, 0),
    amount: safeNumber(raw.f48, 0),
  };
}

/**
 * 解析东方财富原始板块行情 → SectorData
 */
function parseSectorData(raw: EastMoneySectorRaw): SectorData {
  const code = raw.f12 ?? 'BK0000';
  const leadingStockCode = raw.f62 != null ? String(raw.f62).padStart(6, '0') : '';

  return {
    code,
    name: raw.f14 ?? '',
    changePercent: safeNumber(raw.f3, 0),
    change: safeNumber(raw.f4, 0),
    indexValue: safeNumber(raw.f2, 0),
    leadingStock: raw.f104 ?? '',
    leadingStockCode,
    leadingChange: safeNumber(raw.f128, 0),
    upCount: safeNumber(raw.f140, 0),
    downCount: safeNumber(raw.f141, 0),
    capitalFlow: safeNumber(raw.f142, 0),
  };
}

/**
 * 解析东方财富原始板块成分股 → SectorStock
 */
function parseSectorStock(raw: EastMoneySectorStockRaw): SectorStock {
  return {
    code: raw.f12 ?? '000000',
    name: raw.f14 ?? '',
    price: safeNumber(raw.f2, 0),
    changePercent: safeNumber(raw.f3, 0),
    change: safeNumber(raw.f4, 0),
    volume: safeNumber(raw.f5, 0),
    turnover: safeNumber(raw.f6, 0),
  };
}

/**
 * 解析东方财富原始概念行情 → HotTopic
 * 概念数据与板块数据结构完全一致，复用 SectorRaw 并转为 HotTopic
 */
function parseHotTopic(raw: EastMoneySectorRaw): HotTopic {
  const code = raw.f12 ?? 'BK0000';
  const leadingStockCode = raw.f62 != null ? String(raw.f62).padStart(6, '0') : '';

  return {
    code,
    name: raw.f14 ?? '',
    changePercent: safeNumber(raw.f3, 0),
    change: safeNumber(raw.f4, 0),
    leadingStock: raw.f104 ?? '',
    leadingStockCode,
    leadingChange: safeNumber(raw.f128, 0),
    upCount: safeNumber(raw.f140, 0),
    downCount: safeNumber(raw.f141, 0),
    capitalFlow: safeNumber(raw.f142, 0),
  };
}

/**
 * 安全的数字取值：null / undefined / NaN → fallback
 */
function safeNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
