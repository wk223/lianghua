/**
 * L3 个股分析模块
 * 对每只股票进行位置/强度/量价/逻辑/风险五维评估
 *
 * 职责:
 *   1. 接收 StockQuote + SectorData (板块上下文) 数据
 *   2. 五维评估:
 *      - 位置: 价格在趋势中的相对位置
 *      - 强度: 相对大盘/板块的强度
 *      - 量价: 量价配合关系
 *      - 逻辑: 上涨驱动逻辑（需 LLM 判断）
 *      - 风险: 风险因子识别
 *   3. 输出 StockAnalysisResult[]
 *
 * @module engine/l3-stock
 */

import type {
  StockAnalysisResult,
  StockQuote,
  MarketIndex,
  SectorData,
} from '../utils/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 定义涨停/bid-ask状态 */
const LIMIT_UP_THRESHOLD = 9.8;   // 涨幅 ≥9.8% 视为涨停
const LIMIT_DOWN_THRESHOLD = -9.8; // 跌幅 ≤-9.8% 视为跌停

/** 换手率区间 */
const TURNOVER = {
  LOW: 3,       // <3% 低换手
  MEDIUM: 8,    // 3-8% 正常换手
  HIGH: 15,     // 8-15% 活跃换手
  // >15% 极高换手
} as const;

/** 振幅区间 */
const AMPLITUDE = {
  NARROW: 3,    // <3% 窄幅
  NORMAL: 6,    // 3-6% 正常
  WIDE: 10,     // 6-10% 宽幅
  // >10% 巨幅
} as const;

// ═══════════════════════════════════════════════════════════════
// L3StockAnalyzer
// ═══════════════════════════════════════════════════════════════

export class L3StockAnalyzer {
  /**
   * 对一组股票进行五维评估
   *
   * 纯数据驱动的分析（不依赖 LLM），为 LLM 提供结构化输入
   *
   * @param quotes   - 个股行情数据
   * @param indices  - 大盘指数（用于判断相对强度）
   * @param sectors  - 板块行情（用于判断板块归属强度）
   * @returns StockAnalysisResult[]
   */
  async analyze(
    quotes: StockQuote[],
    indices?: MarketIndex[],
    sectors?: SectorData[],
  ): Promise<StockAnalysisResult[]> {
    if (quotes.length === 0) return [];

    // 大盘平均涨跌幅
    const avgMarketChange = this.getAvgMarketChange(indices);

    // 板块涨跌幅映射（code→changePercent）
    const sectorMap = this.buildSectorMap(sectors);

    const results: StockAnalysisResult[] = [];

    for (const quote of quotes) {
      try {
        const result = this.analyzeSingle(
          quote,
          avgMarketChange,
          sectorMap,
        );
        results.push(result);
      } catch (err) {
        logger.warn(`[L3] 分析 ${quote.code} 失败:`, err);
        // 降级返回基本信息
        results.push({
          stock: quote.name,
          code: quote.code,
          position: '数据不足',
          strength: '--',
          volumeAnalysis: '--',
          logic: '待 LLM 补充',
          risk: ['数据不完整'],
          buyPoint: '待定',
        });
      }
    }

    logger.debug(`[L3] 个股分析完成: ${results.length} 只`);
    return results;
  }

  /**
   * 分析单只个股
   */
  private analyzeSingle(
    quote: StockQuote,
    avgMarketChange: number,
    sectorMap: Map<string, number>,
  ): StockAnalysisResult {
    // 1. 位置评估
    const position = this.assessPosition(quote);

    // 2. 强度评估
    const strength = this.assessStrength(quote, avgMarketChange);

    // 3. 量价分析
    const volumeAnalysis = this.assessVolumePrice(quote);

    // 4. 逻辑（数据驱动部分 — 具体驱动逻辑需 LLM 补充）
    const logic = this.inferLogic(quote);

    // 5. 风险评估
    const risk = this.assessRisk(quote);

    // 6. 买入点位建议
    const buyPoint = this.suggestBuyPoint(quote, position);

    return {
      stock: quote.name,
      code: quote.code,
      position,
      strength,
      volumeAnalysis,
      logic,
      risk,
      buyPoint,
    };
  }

  // ─── 位置评估 ──────────────────────────────────────

  /**
   * 位置评估（基于涨跌幅、换手、振幅的综合判断）
   *
   * 策略:
   *   - 大涨 + 高换手 + 宽振幅 → "高位/突破"
   *   - 小涨 + 低换手 + 窄振幅 → "低位"
   *   - 大跌 + 放量 → "回调/破位"
   */
  private assessPosition(quote: StockQuote): string {
    const { changePercent, turnoverRate, amplitude } = quote;

    // 涨停/大涨
    if (changePercent >= LIMIT_UP_THRESHOLD) {
      if (turnoverRate > TURNOVER.HIGH) return '放量涨停(高位)';
      if (turnoverRate > TURNOVER.MEDIUM) return '涨停(中位)';
      return '缩量涨停(强势)';
    }

    // 大跌/跌停
    if (changePercent <= LIMIT_DOWN_THRESHOLD) {
      if (turnoverRate > TURNOVER.MEDIUM) return '放量跌停(危险)';
      return '跌停(弱势)';
    }

    // 上涨 (0~9.8%)
    if (changePercent > 3) {
      if (amplitude > AMPLITUDE.WIDE) return '宽幅上涨(突破区)';
      if (amplitude > AMPLITUDE.NORMAL) return '震荡上涨(中位)';
      return '稳步上涨(趋势中)';
    }

    if (changePercent > 0) {
      if (turnoverRate < TURNOVER.LOW) return '缩量微涨(低位盘整)';
      return '温和上涨(中位)';
    }

    // 下跌 (-9.8%~0)
    if (changePercent > -3) {
      if (turnoverRate < TURNOVER.LOW) return '缩量微跌(低位)';
      return '放量微跌(承压)';
    }

    // 大跌 (-3%~-9.8%)
    if (turnoverRate > TURNOVER.MEDIUM) return '放量下跌(破位)';
    return '缩量下跌(回调)';
  }

  // ─── 强度评估 ──────────────────────────────────────

  /**
   * 个股相对大盘的强度
   *
   * 策略:
   *   - 个股涨幅 > 大盘 +2% → 强
   *   - 个股涨幅 ≈ 大盘 → 中
   *   - 个股涨幅 < 大盘 -2% → 弱
   */
  private assessStrength(
    quote: StockQuote,
    avgMarketChange: number,
  ): string {
    const relativeStrength = quote.changePercent - avgMarketChange;

    if (quote.changePercent >= LIMIT_UP_THRESHOLD) return '极强(涨停)';
    if (relativeStrength > 3) return '强(远超大盘)';
    if (relativeStrength > 0) return '偏强(强于大盘)';
    if (relativeStrength > -2) return '中性(与大盘同步)';
    if (relativeStrength > -5) return '偏弱(弱于大盘)';
    return '弱(远弱于大盘)';
  }

  // ─── 量价分析 ──────────────────────────────────────

  /**
   * 量价配合关系分析
   */
  private assessVolumePrice(quote: StockQuote): string {
    const { changePercent, turnoverRate, amplitude } = quote;

    // 涨停量价
    if (changePercent >= LIMIT_UP_THRESHOLD) {
      if (turnoverRate < TURNOVER.LOW) return '缩量涨停(筹码锁定好)';
      if (turnoverRate < TURNOVER.MEDIUM) return '温和放量涨停(健康)';
      return '放量涨停(分歧大)';
    }

    // 上涨量价
    if (changePercent > 3) {
      if (turnoverRate > TURNOVER.HIGH) return '放量上攻(资金活跃)';
      if (turnoverRate > TURNOVER.MEDIUM) return '量价配合(正常)';
      return '缩量上涨(抛压轻)';
    }

    if (changePercent > 0) {
      if (turnoverRate > TURNOVER.MEDIUM) return '放量滞涨(需警惕)';
      return '量平价稳(正常)';
    }

    // 下跌量价
    if (changePercent > -3) {
      if (turnoverRate > TURNOVER.MEDIUM) return '放量滞跌(有承接)';
      return '缩量微跌(正常调整)';
    }

    if (turnoverRate > TURNOVER.MEDIUM) return '放量下跌(资金出逃)';
    if (amplitude > AMPLITUDE.WIDE) return '宽幅震荡下跌(分歧)';
    return '缩量下跌(无人接盘)';
  }

  // ─── 逻辑推断（数据层面） ──────────────────────────

  /**
   * 基于数据推断可能的上涨逻辑
   * 具体逻辑需 LLM 补充，这里只做数据层面的提示
   */
  private inferLogic(quote: StockQuote): string {
    const { changePercent, turnoverRate, amplitude } = quote;

    // 涨停
    if (changePercent >= LIMIT_UP_THRESHOLD) {
      return '涨停 — 可能有消息/题材驱动，需 LLM 确认具体逻辑';
    }

    // 大涨
    if (changePercent > 5) {
      return '大幅上涨 — 资金主动买入，需 LLM 确认驱动因素';
    }

    // 上涨
    if (changePercent > 2) {
      if (turnoverRate > TURNOVER.MEDIUM) {
        return '放量上涨 — 资金介入明显，需 LLM 判断题材属性';
      }
      return '温和上涨 — 趋势延续，需 LLM 判断逻辑强度';
    }

    // 震荡
    if (Math.abs(changePercent) <= 2) {
      if (turnoverRate < TURNOVER.LOW) {
        return '缩量整理 — 等待方向选择，需 LLM 判断中期逻辑';
      }
      return '震荡 — 多空平衡，需 LLM 分析题材催化';
    }

    // 下跌
    return '下跌 — 需 LLM 判断是洗盘还是出货';
  }

  // ─── 风险评估 ──────────────────────────────────────

  /**
   * 数据层面的风险识别
   */
  private assessRisk(quote: StockQuote): string[] {
    const risks: string[] = [];
    const { changePercent, turnoverRate, amplitude, high, low, price } = quote;

    // 涨幅过大风险
    if (changePercent > 7) {
      risks.push('短线涨幅已大，追高有回调风险');
    }

    // 爆量风险
    if (turnoverRate > TURNOVER.HIGH) {
      risks.push('换手率过高，筹码松动');
    }

    // 高振幅风险
    if (amplitude > AMPLITUDE.WIDE) {
      risks.push('波动剧烈，多空分歧大');
    }

    // 大幅下跌风险
    if (changePercent < -5) {
      risks.push('趋势走弱，下方支撑不明');
    }

    // 量价背离 (下跌放量)
    if (changePercent < -2 && turnoverRate > TURNOVER.MEDIUM) {
      risks.push('放量下跌，资金出逃');
    }

    // 无量上涨
    if (changePercent > 3 && turnoverRate < TURNOVER.LOW) {
      risks.push('缩量上涨，持续性存疑');
    }

    // 高开低走
    if (amplitude > AMPLITUDE.NORMAL && changePercent < 0 && high > price * 1.03) {
      risks.push('高开低走，抛压沉重');
    }

    // 默认风险
    if (risks.length === 0) {
      risks.push('大盘系统性风险');
    }

    return risks;
  }

  // ─── 买入点位建议 ──────────────────────────────────

  /**
   * 基于当前位置和状态建议买入点位
   */
  private suggestBuyPoint(quote: StockQuote, position: string): string {
    const { price, low, high } = quote;

    if (position.includes('涨停')) {
      return `打板确认/排板，不低吸`;
    }

    if (position.includes('高位') || position.includes('突破')) {
      return `回调至 ${low.toFixed(2)} 附近低吸`;
    }

    if (position.includes('低位') || position.includes('盘整')) {
      return `现价附近分批建仓 ${(price * 0.98).toFixed(2)}-${(price * 1.02).toFixed(2)}`;
    }

    if (position.includes('回调') || position.includes('下跌')) {
      return `等待企稳信号，关注 ${low.toFixed(2)} 支撑`;
    }

    return `现价 ${price} 附近观察`;
  }

  // ─── 辅助方法 ──────────────────────────────────────

  /** 获取大盘平均涨跌幅 */
  private getAvgMarketChange(indices?: MarketIndex[]): number {
    if (!indices || indices.length === 0) return 0;
    return indices.reduce((sum, idx) => sum + idx.changePercent, 0) / indices.length;
  }

  /** 构建板块代码→涨跌幅 映射 */
  private buildSectorMap(sectors?: SectorData[]): Map<string, number> {
    const map = new Map<string, number>();
    if (sectors) {
      for (const s of sectors) {
        map.set(s.code, s.changePercent);
      }
    }
    return map;
  }
}
