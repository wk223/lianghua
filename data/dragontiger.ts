/**
 * 龙虎榜数据适配器
 * 获取当日龙虎榜上榜股票 + 买入/卖出前五席位 + 知名游资标记 + 净买入额排名
 *
 * @module data/dragontiger
 *
 * 数据源策略:
 *   1. 同花顺 q.10jqka.com.cn 龙虎榜页面 HTML 解析
 *   2. 东方财富 datacenter API (备选)
 *   3. 兜底: 返回空框架
 *
 * 知名游资识别:
 *   内置常见游资席位名称数据库，匹配买卖席位中的知名游资
 */

import { DataFetcher } from './fetcher';
import { logger } from '../utils/logger';
import type { FetchOptions } from './types';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 龙虎榜席位 */
export interface TigerSeat {
  /** 席位名称 */
  name: string;
  /** 买入金额 (万元) */
  buyAmount: number;
  /** 卖出金额 (万元) */
  sellAmount: number;
  /** 净买入 (万元) */
  netAmount: number;
  /** 是否知名游资席位 */
  isFamous: boolean;
  /** 游资名称 (如 "章盟主", "赵老哥") */
  famousName?: string;
}

/** 龙虎榜上榜股票 */
export interface DragonTigerStock {
  code: string;
  name: string;
  /** 涨跌幅 % */
  changePercent: number;
  /** 收盘价 */
  closePrice: number;
  /** 成交额 (万元) */
  turnover: number;
  /** 净买入额 (万元) */
  netBuyAmount: number;
  /** 买入前五席位 */
  buySeats: TigerSeat[];
  /** 卖出前五席位 */
  sellSeats: TigerSeat[];
  /** 知名游资列表 (席位名称) */
  famousCapital: string[];
  /** 原因类别: 日涨幅偏离值达7% / 连续三个交易日内涨幅偏离值累计达20% / 等 */
  reasonCategory: string;
  /** 上榜日期 */
  date: string;
}

/** 龙虎榜全景数据 */
export interface DragonTigerOverview {
  /** 上榜股票列表 (按净买入额降序) */
  stocks: DragonTigerStock[];
  /** 上榜总数 */
  totalCount: number;
  /** 知名游资上榜次数统计 */
  famousStats: Array<{ name: string; appearCount: number; totalNetBuy: number }>;
  /** 净买入额排名前 5 */
  topBuy: DragonTigerStock[];
  /** 净卖出额排名前 5 */
  topSell: DragonTigerStock[];
  /** 数据更新时间 */
  updatedAt: number;
  /** 当前使用的数据源 */
  source: string;
}

// ═══════════════════════════════════════════════════════════════
// 知名游资席位数据库
// ═══════════════════════════════════════════════════════════════

interface FamousCapitalEntry {
  /** 游资称号 */
  name: string;
  /** 常见营业部名称 (部分匹配) */
  keywords: string[];
}

const FAMOUS_CAPITAL: FamousCapitalEntry[] = [
  { name: '章盟主', keywords: ['国泰君安证券股份有限公司上海分公司', '国泰君安上海江苏路', '中信证券上海分公司'] },
  { name: '赵老哥', keywords: ['中国银河证券股份有限公司绍兴证券营业部', '银河证券绍兴', '浙商证券绍兴分公司'] },
  { name: '炒股养家', keywords: ['华鑫证券上海分公司', '华鑫证券上海茅台路', '华鑫证券上海宛平南路'] },
  { name: '作手新一', keywords: ['国泰君安证券股份有限公司南京太平南路证券营业部', '国泰君安南京太平南路'] },
  { name: '小鳄鱼', keywords: ['南京证券股份有限公司南京大钟亭证券营业部', '南京证券南京大钟亭'] },
  { name: '方新侠', keywords: ['兴业证券股份有限公司陕西分公司', '兴业证券陕西分公司'] },
  { name: '欢乐海岸', keywords: ['中信证券股份有限公司深圳分公司', '中信证券深圳分公司'] },
  { name: '古北路', keywords: ['中信证券股份有限公司上海古北路证券营业部', '中信证券上海古北路'] },
  { name: '孙哥', keywords: ['中信证券股份有限公司上海溧阳路证券营业部', '中信证券上海溧阳路'] },
  { name: '上塘路', keywords: ['财通证券股份有限公司杭州上塘路证券营业部', '财通证券杭州上塘路'] },
  { name: '西湖国贸', keywords: ['财通证券股份有限公司杭州西湖国贸中心证券营业部', '财通证券杭州西湖国贸'] },
  { name: '湖州劳动路', keywords: ['华泰证券股份有限公司湖州劳动路证券营业部', '华泰证券湖州劳动路'] },
  { name: '宁波桑田路', keywords: ['国盛证券有限责任公司宁波桑田路证券营业部', '国盛证券宁波桑田路'] },
  { name: '深圳帮', keywords: ['华泰证券股份有限公司深圳益田路荣超商务中心证券营业部', '华泰证券深圳益田路'] },
  { name: '山东帮', keywords: ['中泰证券股份有限公司深圳分公司', '中泰证券深圳分公司'] },
  { name: '成都帮', keywords: ['华泰证券股份有限公司成都南一环路第二证券营业部', '华泰证券成都南一环路'] },
  { name: '溧阳路', keywords: ['中信证券股份有限公司上海溧阳路证券营业部', '中信证券上海溧阳路'] },
  { name: '机构专用', keywords: ['机构专用'] },
  { name: '深股通专用', keywords: ['深股通专用'] },
  { name: '沪股通专用', keywords: ['沪股通专用'] },
];

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 同花顺龙虎榜页面 URL */
const THS_DRAGON_TIGER_URL = '/api/ths_zt/lhb/';

/** 东方财富龙虎榜 API */
const EM_DRAGON_TIGER_URL =
  '/api/em/api/qt/clist/get?cb=&pn=1&pz=50&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f62&fs=m:90+t:1&fields=f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124,f128,f140,f136';

/** 缓存 TTL (秒) — 龙虎榜通常盘后发布，缓存 60 秒 */
const DRAGON_TIGER_TTL = 60_000;

// ═══════════════════════════════════════════════════════════════
// DragonTigerAdapter
// ═══════════════════════════════════════════════════════════════

export class DragonTigerAdapter {
  private fetcher: DataFetcher;

  constructor(fetcher?: DataFetcher) {
    this.fetcher = fetcher ?? new DataFetcher();
  }

  // ─── 公开接口 ──────────────────────────────────────────

  /**
   * 获取当日龙虎榜全景数据
   *
   * 多数据源自动降级:
   *   1. 同花顺 HTML 解析
   *   2. 东方财富 API
   *   3. 兜底: 返回空框架
   *
   * @param options 可选覆写请求配置
   * @returns DragonTigerOverview
   */
  async getOverview(options?: FetchOptions): Promise<DragonTigerOverview> {
    let stocks: DragonTigerStock[] = [];
    let source = '';
    const opts = { useCache: true, ttl: DRAGON_TIGER_TTL, ...options };

    // ═══ 策略 1: 同花顺 HTML 解析 ═══
    try {
      stocks = await this.fetchFromThs(opts);
      source = '同花顺龙虎榜';
      logger.info('[DragonTiger] 同花顺数据获取成功:', stocks.length, '只');
    } catch (err) {
      logger.warn('[DragonTiger] 同花顺获取失败，尝试东方财富:', (err as Error).message);
    }

    // ═══ 策略 2: 东方财富 API ═══
    if (stocks.length === 0) {
      try {
        stocks = await this.fetchFromEastMoney(opts);
        source = '东方财富';
        logger.info('[DragonTiger] 东方财富数据获取成功:', stocks.length, '只');
      } catch (err) {
        logger.warn('[DragonTiger] 东方财富获取失败，使用空框架:', (err as Error).message);
      }
    }

    if (stocks.length === 0) {
      source = source || '无可用数据源';
    }

    return this.buildOverview(stocks, source);
  }

  /**
   * 识别游资名称
   *
   * @param seatName 营业部名称
   * @returns 匹配到的游资称号, 未匹配返回 undefined
   */
  static identifyFamousCapital(seatName: string): string | undefined {
    for (const entry of FAMOUS_CAPITAL) {
      for (const keyword of entry.keywords) {
        if (seatName.includes(keyword)) {
          return entry.name;
        }
      }
    }
    return undefined;
  }

  /**
   * 获取底层 DataFetcher 实例
   */
  getFetcher(): DataFetcher {
    return this.fetcher;
  }

  // ─── 数据源实现 ──────────────────────────────────────

  /**
   * 从同花顺龙虎榜页面解析数据
   *
   * q.10jqka.com.cn/lhb/ 页面展示当日龙虎榜上榜股票
   * 包含买入/卖出前五席位明细
   */
  private async fetchFromThs(
    opts: FetchOptions,
  ): Promise<DragonTigerStock[]> {
    const html = await this.fetcher.fetchRawText(THS_DRAGON_TIGER_URL, {
      ...opts,
      useCache: true,
      ttl: DRAGON_TIGER_TTL,
    });

    if (!html || html.length < 200) {
      throw new Error('同花顺龙虎榜页面返回数据过短');
    }

    return this.parseThsDragonTigerHtml(html);
  }

  /**
   * 从东方财富 API 获取龙虎榜
   */
  private async fetchFromEastMoney(
    opts: FetchOptions,
  ): Promise<DragonTigerStock[]> {
    try {
      const data = await this.fetcher.fetchJSON<any>(
        EM_DRAGON_TIGER_URL,
        { ...opts, useCache: true, ttl: DRAGON_TIGER_TTL },
      );

      if (!data?.data?.diff || !Array.isArray(data.data.diff)) {
        throw new Error('东方财富龙虎榜返回格式异常');
      }

      return data.data.diff.map((item: any) => {
        const stock: DragonTigerStock = {
          code: item.f12 || '',
          name: item.f14 || '',
          changePercent: item.f3 ?? 0,
          closePrice: item.f2 ?? 0,
          turnover: item.f62 ?? 0,
          netBuyAmount: item.f184 ?? 0,
          buySeats: [],
          sellSeats: [],
          famousCapital: [],
          reasonCategory: this.getReasonCategory(item),
          date: '',
        };
        return stock;
      });
    } catch {
      throw new Error('东方财富龙虎榜 API 获取失败');
    }
  }

  // ─── HTML 解析 ────────────────────────────────────────

  /**
   * 解析同花顺龙虎榜 HTML
   *
   * 同花顺龙虎榜页面结构较复杂，有多个表格:
   * - 整体榜单表格
   * - 每个上榜股票点开后有买入/卖出明细
   *
   * 这里解析概览表格, 席位明细通过接口无法直接获取—留到组件层展示概览
   */
  private parseThsDragonTigerHtml(html: string): DragonTigerStock[] {
    const stocks: DragonTigerStock[] = [];

    // 尝试匹配股票列表区域
    // 同花顺龙虎榜表格结构与涨停板类似
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trRegex.exec(html)) !== null) {
      const trContent = trMatch[1].trim();
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let tdMatch: RegExpExecArray | null;

      while ((tdMatch = tdRegex.exec(trContent)) !== null) {
        const cellText = tdMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, '')
          .replace(/[\s\n\r]+/g, '')
          .trim();
        cells.push(cellText);
      }

      if (cells.length < 8) continue;
      if (/^(序号|代码|名称|最新价)/.test(cells[0] || '')) continue;
      const seqNum = parseInt(cells[0], 10);
      if (Number.isNaN(seqNum)) continue;

      // 列: 0:序号 1:代码 2:名称 3:最新价 4:涨跌幅% 5:成交额 6:净买入额 7:原因
      const code = this.extractCode(cells[1] || '');
      const name = cells[2] || '';
      const price = parseFloat(cells[3] || '0');
      const changePct = parseFloat(cells[4] || '0');
      const turnover = this.parseAmount(cells[5] || '0');
      const netBuy = this.parseAmount(cells[6] || '0');
      const reason = cells[7] || '';

      if (!code || !name) continue;

      stocks.push({
        code,
        name,
        changePercent: Number.isNaN(changePct) ? 0 : changePct,
        closePrice: Number.isNaN(price) ? 0 : price,
        turnover: Number.isNaN(turnover) ? 0 : turnover,
        netBuyAmount: Number.isNaN(netBuy) ? 0 : netBuy,
        buySeats: [],
        sellSeats: [],
        famousCapital: [],
        reasonCategory: reason,
        date: new Date().toISOString().slice(0, 10),
      });
    }

    if (stocks.length === 0) {
      throw new Error('同花顺龙虎榜 HTML 解析未匹配到数据');
    }

    // 按净买入额降序排列
    stocks.sort((a, b) => b.netBuyAmount - a.netBuyAmount);

    return stocks;
  }

  // ─── 辅助方法 ──────────────────────────────────────

  /**
   * 从 HTML 中提取股票代码
   */
  private extractCode(text: string): string {
    const match = text.match(/(\d{6})/);
    return match ? match[1] : '';
  }

  /**
   * 解析金额 (支持"亿"/"万"单位, 统一返回万元)
   */
  private parseAmount(val: string): number {
    if (!val) return 0;
    const cleaned = val.replace(/[,，\s]/g, '');
    if (cleaned.includes('亿')) {
      return parseFloat(cleaned) * 10000;
    }
    if (cleaned.includes('万')) {
      return parseFloat(cleaned);
    }
    return parseFloat(cleaned) || 0;
  }

  /**
   * 从东方财富数据推断上榜原因
   */
  private getReasonCategory(item: any): string {
    const f128 = item.f128;
    if (f128 === 1) return '日涨幅偏离值达7%';
    if (f128 === 2) return '日换手率达20%';
    if (f128 === 3) return '日振幅达15%';
    if (f128 === 4) return '连续三个交易日内涨幅偏离值累计达20%';
    if (f128 === 5) return 'ST、*ST证券连续三个交易日内跌幅偏离值累计达12%';
    return '其他';
  }

  // ─── 全景数据构建 ──────────────────────────────────────

  /**
   * 从上榜股票列表构建全景数据
   */
  private buildOverview(
    stocks: DragonTigerStock[],
    source: string,
  ): DragonTigerOverview {
    // 游资上榜统计
    const famousMap = new Map<string, { appearCount: number; totalNetBuy: number }>();
    for (const stock of stocks) {
      for (const name of stock.famousCapital) {
        const entry = famousMap.get(name) || { appearCount: 0, totalNetBuy: 0 };
        entry.appearCount++;
        entry.totalNetBuy += stock.netBuyAmount;
        famousMap.set(name, entry);
      }
    }

    const famousStats = [...famousMap.entries()]
      .sort((a, b) => b[1].appearCount - a[1].appearCount)
      .map(([name, stats]) => ({
        name,
        appearCount: stats.appearCount,
        totalNetBuy: stats.totalNetBuy,
      }));

    // 净买入/卖出前 5
    const sortedByNet = [...stocks].sort((a, b) => b.netBuyAmount - a.netBuyAmount);
    const topBuy = sortedByNet.slice(0, 5);
    const topSell = sortedByNet.reverse().slice(0, 5);

    return {
      stocks: sortedByNet,
      totalCount: stocks.length,
      famousStats,
      topBuy,
      topSell,
      updatedAt: Date.now(),
      source,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 单例
// ═══════════════════════════════════════════════════════════════

export const dragonTigerAdapter = new DragonTigerAdapter();
