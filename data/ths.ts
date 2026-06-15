/**
 * 同花顺 (10jqka) 数据适配器
 * 获取个股行情 + 大盘指数 + 板块/题材数据
 *
 * @module data/ths
 *
 * 设计说明:
 * - 封装 d.10jqka.com.cn realhead API 调用（JSONP 格式）
 * - 提供 getQuote / getQuotes / getMarketIndex / getSectors /
 *   getSectorDetail / getHotTopics 六种接口
 * - 个股/指数使用 realhead API；板块/题材从 q.10jqka.com.cn HTML 解析
 * - 内部完成字段映射、JSONP 解析
 * - 复用 DataFetcher 的速率限制 + 缓存 + 重试
 *
 * API 参考:
 *   个股(沪):  d.10jqka.com.cn/v2/realhead/hs_{code}/last.js
 *   个股(深):  d.10jqka.com.cn/v2/realhead/sz_{code}/last.js
 *   指数:      d.10jqka.com.cn/v2/realhead/index_{code}/last.js
 *   行业板块:  q.10jqka.com.cn/thshy/    (HTML)
 *   概念板块:  q.10jqka.com.cn/gn/       (HTML)
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
  ThsRealheadResponse,
  ThsSectorRow,
  FetchOptions,
} from './types';
import { DataFetcher } from './fetcher';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/**
 * 同花顺 realhead API 基础 URL
 *
 * 开发环境: 通过 Vite proxy 转发 (解决浏览器 CORS 限制)
 * 生产环境: 直连同花顺 API（需 nginx 配置反向代理 /api/ths）
 */
const API_BASE = '/api/ths/v2/realhead';

/** 同花顺板块/概念 HTML 页面基础 URL */
const Q_BASE = '/api/ths_q';

/** 默认缓存 TTL（行情数据 10 秒） */
const QUOTE_TTL = 10_000;

/** 指数缓存 TTL（指数数据 15 秒） */
const INDEX_TTL = 15_000;

/** 板块缓存 TTL（板块数据 30 秒） */
const SECTOR_TTL = 30_000;

/** 大盘指数代码列表 */
const INDEX_CODES = [
  '000001',  // 上证指数
  '399001',  // 深证成指
  '399006',  // 创业板指
  '000688',  // 科创50
] as const;

/** 市场前缀映射 */
const EXCHANGE_MAP: Record<string, string> = {
  '6': 'hs',   // SH 主板
  '5': 'hs',   // SH 基金/债券
  '0': 'sz',   // SZ 主板
  '3': 'sz',   // SZ 创业板
  '4': 'bj',   // BJ
  '8': 'bj',   // BJ 北交所
};

// ═══════════════════════════════════════════════════════════════
// 同花顺 realhead items 字段键名
// 注: 这些数字键在同花顺 API 中相对稳定，并非所有字段每次都返回
// ═══════════════════════════════════════════════════════════════

const KEYS = {
  CODE: '5',        // 股票代码
  PRICE: '7',       // 最新价
  HIGH: '8',        // 最高价
  LOW: '9',         // 最低价
  OPEN: '10',       // 开盘价
  VOLUME: '13',     // 成交量（手）
  TURNOVER: '19',   // 成交额（元）
  PRECLOSE: '24',   // 昨收价
  AMPLITUDE: '2942',   // 振幅 %
  TURNOVER_RATE_1: '1149395', // 换手率 % (常出现)
  TURNOVER_RATE_2: '592920',  // 换手率 % (备选)
  MARKET_CAP: '3475914',    // 总市值
  CIRCULATING_CAP: '3541450', // 流通市值
} as const;

// ═══════════════════════════════════════════════════════════════
// ThsAdapter
// ═══════════════════════════════════════════════════════════════

export class ThsAdapter {
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

    const url = buildRealheadUrl(cleanCode);
    const raw = await this.fetchRealhead(url, options);

    return parseStockQuote(raw, cleanCode);
  }

  /**
   * 批量获取个股实时行情
   *
   * 同花顺 realhead API 不支持真正的批量查询，这里使用并发请求实现
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

    // 并发请求（限制并发数避免触发速率限制）
    const results = await Promise.allSettled(
      validCodes.map((code) => this.getQuote(code, options)),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<StockQuote> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  /**
   * 获取大盘指数数据
   * 返回 [上证指数, 深证成指, 创业板指, 科创50]
   */
  async getMarketIndex(options?: FetchOptions): Promise<MarketIndex[]> {
    // 并发获取各指数
    const results = await Promise.allSettled(
      INDEX_CODES.map((code) => this.fetchIndex(code, options)),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<MarketIndex> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  // ─── 板块/题材接口 ──────────────────────────────────

  /**
   * 获取行业板块行情列表（按涨幅降序）
   *
   * 从 q.10jqka.com.cn/thshy/ 解析 HTML 表格数据
   *
   * @param options 可选覆写请求配置
   * @returns SectorData[]
   */
  async getSectors(options?: FetchOptions): Promise<SectorData[]> {
    const url = `${Q_BASE}/thshy/`;
    const html = await this.fetcher.fetchRaw(url, 10_000);
    const text = await html.text();

    const rows = parseSectorTable(text);
    return rows.map((row, i) => ({
      code: `BK${String(i + 1).padStart(4, '0')}`,
      name: row.name,
      changePercent: row.changePercent,
      change: 0,
      indexValue: 0,
      leadingStock: row.leadingStock,
      leadingStockCode: '',
      leadingChange: row.leadingChange,
      upCount: row.upCount,
      downCount: row.downCount,
      capitalFlow: row.capitalFlow,
    }));
  }

  /**
   * 获取板块明细（含成分股列表）
   *
   * ⚠️ 同花顺公开板块成分股 API 有限，此方法返回板块元数据 + 空成分股列表
   * 成分股数据可通过 getQuotes 单独获取
   *
   * @param code 板块代码（暂支持 "thshy" 使用行业板块数据）
   * @param options 可选覆写请求配置
   * @returns SectorDetail
   */
  async getSectorDetail(
    code: string,
    options?: FetchOptions,
  ): Promise<SectorDetail> {
    // 使用行业板块数据作为板块详情的基础
    const sectors = await this.getSectors(options);
    const sector = sectors.find(
      (s) => s.code === code || s.name.includes(code),
    );

    if (!sector) {
      throw new Error(`板块未找到: ${code}`);
    }

    return {
      sector,
      stocks: [], // 成分股数据通过 getQuotes 单独获取
    };
  }

  /**
   * 获取热门题材/概念列表
   *
   * 从 q.10jqka.com.cn/gn/ 解析 HTML 表格数据
   *
   * @param options 可选覆写请求配置
   * @returns HotTopic[]
   */
  async getHotTopics(options?: FetchOptions): Promise<HotTopic[]> {
    const url = `${Q_BASE}/gn/`;
    const html = await this.fetcher.fetchRaw(url, 10_000);
    const text = await html.text();

    const rows = parseSectorTable(text);
    return rows.map((row, i) => ({
      code: `BK${String(i + 1).padStart(4, '0')}`,
      name: row.name,
      changePercent: row.changePercent,
      change: 0,
      leadingStock: row.leadingStock,
      leadingStockCode: '',
      leadingChange: row.leadingChange,
      upCount: row.upCount,
      downCount: row.downCount,
      capitalFlow: row.capitalFlow,
    }));
  }

  /**
   * 获取底层 DataFetcher 实例
   * 用于统计 / 缓存操作
   */
  getFetcher(): DataFetcher {
    return this.fetcher;
  }

  // ─── 内部方法 ──────────────────────────────────────

  /**
   * 获取单只指数行情
   */
  private async fetchIndex(
    code: string,
    options?: FetchOptions,
  ): Promise<MarketIndex> {
    const url = `${API_BASE}/hs_${code}/last.js`;
    const raw = await this.fetchRealhead(url, {
      useCache: true,
      ttl: INDEX_TTL,
      ...options,
    });

    return parseMarketIndex(raw, code);
  }

  /**
   * 获取 realhead API 原始数据
   * 处理 JSONP 格式解析
   */
  private async fetchRealhead(
    url: string,
    options?: FetchOptions,
  ): Promise<ThsRealheadResponse> {
    const text = await this.fetcher.fetchRawText(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options,
    });

    const json = parseJsonp(text);
    if (!json) {
      throw new Error(`同花顺 API 返回数据解析失败: ${url}`);
    }
    return json;
  }
}

// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 根据股票代码前缀获取市场前缀
 * SH(6) → hs, SZ(0/3) → sz, BJ(4/8) → bj
 */
function getMarketPrefix(code: string): string {
  const prefix = code.charAt(0);
  return EXCHANGE_MAP[prefix] ?? 'hs';
}

/**
 * 构建同花顺 realhead URL
 * 沪: hs_{code}  深: sz_{code}  京: bj_{code}
 */
function buildRealheadUrl(code: string): string {
  const prefix = getMarketPrefix(code);
  return `${API_BASE}/${prefix}_${code}/last.js`;
}

/**
 * 解析 JSONP 响应
 *
 * 同花顺返回格式:
 *   quotebridge_v2_realhead_hs_{code}_last({...})
 *
 * 提取括号内的 JSON 对象
 */
function parseJsonp(text: string): ThsRealheadResponse | null {
  if (!text || text.trim().length === 0) return null;

  try {
    // 尝试直接 JSON 解析（误伤少）
    if (text.startsWith('{')) {
      return JSON.parse(text) as ThsRealheadResponse;
    }

    // 解析 JSONP: functionName({...})
    const match = text.match(/\((\{[\s\S]*\})\)/);
    if (match && match[1]) {
      return JSON.parse(match[1]) as ThsRealheadResponse;
    }

    // 尝试更宽松的匹配
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      const jsonStr = text.slice(startIdx, endIdx + 1);
      return JSON.parse(jsonStr) as ThsRealheadResponse;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 从 items 中安全获取数值
 */
function getItemNumber(items: Record<string, string>, key: string): number | null {
  const val = items[key];
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

/**
 * 解析个股行情
 * change/changePercent 优先计算（price - preClose），避免 items 中误差
 */
function parseStockQuote(raw: ThsRealheadResponse, fallbackCode?: string): StockQuote {
  const { items, name } = raw;

  const code = items[KEYS.CODE] ?? fallbackCode ?? '000000';
  const price = getItemNumber(items, KEYS.PRICE) ?? 0;
  const preClose = getItemNumber(items, KEYS.PRECLOSE) ?? price;
  const change = price - preClose;
  const changePercent = preClose > 0 ? (change / preClose) * 100 : 0;

  return {
    code,
    name: name ?? '',
    price,
    change: roundTo(change, 2),
    changePercent: roundTo(changePercent, 2),
    volume: getItemNumber(items, KEYS.VOLUME) ?? 0,
    turnover: getItemNumber(items, KEYS.TURNOVER) ?? 0,
    high: getItemNumber(items, KEYS.HIGH) ?? price,
    low: getItemNumber(items, KEYS.LOW) ?? price,
    open: getItemNumber(items, KEYS.OPEN) ?? price,
    amplitude: getItemNumber(items, KEYS.AMPLITUDE) ?? 0,
    turnoverRate:
      getItemNumber(items, KEYS.TURNOVER_RATE_1) ??
      getItemNumber(items, KEYS.TURNOVER_RATE_2) ??
      0,
  };
}

/**
 * 解析指数行情
 */
function parseMarketIndex(raw: ThsRealheadResponse, fallbackCode?: string): MarketIndex {
  const { items, name } = raw;

  const code = items[KEYS.CODE] ?? fallbackCode ?? '000000';
  const price = getItemNumber(items, KEYS.PRICE) ?? 0;
  const preClose = getItemNumber(items, KEYS.PRECLOSE) ?? price;
  const change = price - preClose;
  const changePercent = preClose > 0 ? (change / preClose) * 100 : 0;

  return {
    code,
    name: name ?? '',
    price,
    change: roundTo(change, 2),
    changePercent: roundTo(changePercent, 2),
    volume: getItemNumber(items, KEYS.VOLUME) ?? 0,
    amount: getItemNumber(items, KEYS.TURNOVER) ?? 0,
  };
}

/**
 * 解析同花顺板块/概念 HTML 表格
 *
 * q.10jqka.com.cn 的板块页面使用统一 HTML 表格结构
 * 提取前 N 行的名称、涨幅、成交额、资金流、涨跌家数、领涨股等
 *
 * @param html 完整 HTML 字符串
 * @returns ThsSectorRow[] 解析后的板块行列表
 */
function parseSectorTable(html: string): ThsSectorRow[] {
  const rows: ThsSectorRow[] = [];

  // 使用正则匹配表格行
  // 同花顺板块 HTML 表格每一行格式:
  // <tr>\n  <td>序号</td>\n  <td>名称</td>\n  <td>涨幅%</td>\n  ...
  // 用 <tr> 分割后逐行解析
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const trContent = trMatch[1].trim();

    // 提取所有 td 内容
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let tdMatch: RegExpExecArray | null;

    while ((tdMatch = tdRegex.exec(trContent)) !== null) {
      const cellText = tdMatch[1]
        .replace(/<[^>]+>/g, '')  // 移除内部 HTML 标签
        .replace(/&nbsp;/g, '')
        .replace(/[\s\n\r]+/g, '')
        .trim();
      if (cellText) {
        cells.push(cellText);
      }
    }

    // 跳过表头行和空行
    if (cells.length < 8) continue;
    if (/^(序号|代码|名称|涨幅)/.test(cells[1] || cells[0])) continue;
    if (/^\d+$/.test(cells[0]) === false) continue; // 第一列必须是数字序号

    // 同花顺板块表格列顺序:
    // 0:序号 1:名称 2:涨幅% 3:总成交额(亿) 4:资金流入(万)
    // 5:上涨家数 6:下跌家数 7:领涨股名 8:领涨涨幅%
    const name = cells[1] || '';
    const changePercent = parseChinesePercent(cells[2]);
    const totalAmount = parseChineseNumber(cells[3]);
    const capitalFlow = parseChineseNumber(cells[4]);
    const upCount = parseInt(cells[5] || '0', 10);
    const downCount = parseInt(cells[6] || '0', 10);
    const leadingStock = cells[7] || '';
    const leadingChange = parseChinesePercent(cells[8]);

    // 过滤无效行
    if (!name || Number.isNaN(changePercent)) continue;

    rows.push({
      name,
      changePercent,
      totalAmount,
      capitalFlow,
      upCount,
      downCount,
      leadingStock,
      leadingChange,
    });
  }

  // 如果正则匹配失败（HTML 结构差异），降级返回空数组
  return rows;
}

/**
 * 解析中文百分比字符串
 * "8.24" → 8.24, "20.01" → 20.01
 */
function parseChinesePercent(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[%\s]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

/**
 * 解析中文数字（含单位）
 * "2303.23" → 2303.23, "1507.20" → 1507.20
 * "128.22亿" → 1282200 (万元)
 */
function parseChineseNumber(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[,，\s]/g, '');

  if (cleaned.includes('亿')) {
    return parseFloat(cleaned) * 10000;
  }
  if (cleaned.includes('万')) {
    return parseFloat(cleaned);
  }

  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? roundTo(num, 2) : 0;
}

/**
 * 保留指定位数小数
 */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
