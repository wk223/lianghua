/**
 * 排除规则引擎 — ExclusionFilter
 *
 * 严格对齐 xvqiu-requirements.md Section 6 的11条排除规则
 * 对每只股票进行11维硬性过滤，识别明显硬伤
 *
 * 规则列表:
 * 1. 高位接力风险大 — 连续涨停后放量分歧，追高盈亏比差
 * 2. 逻辑不清 — 上涨逻辑无法用一句话说清
 * 3. 买点差 — 当前价格处于近期高点，没有安全边际
 * 4. 盈亏比差 — 上方空间明显小于下方风险
 * 5. 题材透支 — 题材已充分炒作，缺乏新催化
 * 6. 承接差 — 分时图显示反弹无量、下跌放量
 * 7. 缩量 — 缩量上涨/缩量下跌，量价背离
 * 8. 冲高回落 — 日内冲高后大幅回落，上影线长
 * 9. 逻辑不连续 — 上涨逻辑孤立，缺乏持续催化
 * 10. 模式不匹配 — 加速板/一字板/通道党票
 * 11. 市场不配合 — 大盘环境差，个股独立行情难以持续
 *
 * @module engine/exclusion-filter
 */

import type {
  StockQuote,
  MarketIndex,
  ExclusionResult,
  ExclusionRule,
} from '../utils/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 阈值常量
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  // 高位判断
  CONSECUTIVE_LIMIT_DAYS: 3,     // 连续涨停≥3天视为高位
  HIGH_CHANGE_3D: 20,            // 3日涨幅≥20%视为高位
  HIGH_CHANGE_5D: 30,            // 5日涨幅≥30%视为高位

  // 量价
  LOW_TURNOVER: 3,               // 换手率<3% 缩量
  HIGH_TURNOVER: 15,             // 换手率>15% 爆量分歧
  LOW_AMPLITUDE: 2,              // 振幅<2% 无量
  HIGH_AMPLITUDE: 8,             // 振幅>8% 大波动

  // 冲高回落
  SHADOW_RATIO: 0.35,            // 上影线/(最高-最低) > 35% 视为冲高回落

  // 强度
  WEAK_STRENGTH: -3,             // 相对大盘弱于-3%
  MARKET_UNFIT: -1.5,            // 大盘跌幅>1.5%视为环境差

  // 盈亏比
  MIN_UP_SIDE: 3,                // 上方最小空间%
  MAX_DOWN_SIDE: 5,              // 下方最大风险%

  // 综合评分权重
  SCORE_WEIGHT: {
    POSITION: 25,                // 位置权重
    LOGIC: 20,                   // 逻辑权重
    BUY_POINT: 20,               // 买点权重
    RISK_REWARD: 15,             // 盈亏比权重
    VOLUME: 10,                  // 量价权重
    STRENGTH: 10,                // 强度权重
  },
};

// ═══════════════════════════════════════════════════════════════
// ExclusionFilter
// ═══════════════════════════════════════════════════════════════

export class ExclusionFilter {
  /**
   * 对单只股票执行11条排除规则检测
   *
   * @param quote - 个股行情
   * @param avgMarketChange - 大盘平均涨跌幅
   * @param options - 可选附加信息
   * @returns ExclusionResult
   */
  analyze(
    quote: StockQuote,
    avgMarketChange: number,
    options?: {
      /** 连续涨停天数（需要外部传入） */
      consecutiveLimitDays?: number;
      /** 近3日涨幅 */
      change3D?: number;
      /** 近5日涨幅 */
      change5D?: number;
      /** 题材是否透支 */
      topicExhausted?: boolean;
      /** 逻辑是否清晰 */
      logicClear?: boolean;
      /** 是否有持续催化 */
      hasContinuousCatalyst?: boolean;
      /** 是否是一字板/加速板 */
      isGapUpLimit?: boolean;
    },
  ): ExclusionResult {
    const hitRules: ExclusionRule[] = [];
    const details: ExclusionResult['details'] = [];
    const { price, changePercent, turnoverRate, amplitude, high, low, open } = quote;

    // 计算上影线比例（如果当日有振幅）
    const shadowRatio = (high - Math.max(open, price)) / (high - low || 1);
    const isUpDay = changePercent > 0;

    // ─── 规则1: 高位接力风险大 ────────────────────
    const isHighPosition =
      (options?.consecutiveLimitDays ?? 0) >= THRESHOLDS.CONSECUTIVE_LIMIT_DAYS ||
      (options?.change3D ?? 0) >= THRESHOLDS.HIGH_CHANGE_3D ||
      (options?.change5D ?? 0) >= THRESHOLDS.HIGH_CHANGE_5D;

    if (isHighPosition && turnoverRate > THRESHOLDS.HIGH_TURNOVER) {
      hitRules.push('高位接力风险大');
      details.push({
        rule: '高位接力风险大',
        reason: `连续涨停${options?.consecutiveLimitDays ?? '?'}天/近3日涨幅${(options?.change3D ?? 0).toFixed(1)}%，换手率${turnoverRate.toFixed(1)}%偏高，分歧大`,
        severity: 'high',
      });
    } else if (isHighPosition) {
      hitRules.push('高位接力风险大');
      details.push({
        rule: '高位接力风险大',
        reason: `位置已高（近3日涨幅${(options?.change3D ?? 0).toFixed(1)}%），追高风险收益比差`,
        severity: 'medium',
      });
    }

    // ─── 规则2: 逻辑不清 ──────────────────────────
    if (options?.logicClear === false) {
      hitRules.push('逻辑不清');
      details.push({
        rule: '逻辑不清',
        reason: '上涨驱动逻辑不清晰，无法用一句话说清为什么涨',
        severity: 'high',
      });
    }

    // ─── 规则3: 买点差 ────────────────────────────
    // 当日大涨后追高
    if (changePercent > 7 && turnoverRate > THRESHOLDS.HIGH_TURNOVER) {
      hitRules.push('买点差');
      details.push({
        rule: '买点差',
        reason: `当前涨幅${changePercent.toFixed(1)}%已高，换手${turnoverRate.toFixed(1)}%过大，追高无安全边际`,
        severity: 'high',
      });
    } else if (changePercent > 5) {
      hitRules.push('买点差');
      details.push({
        rule: '买点差',
        reason: `涨幅${changePercent.toFixed(1)}%，处于当日高点，买入即面临回调风险`,
        severity: 'medium',
      });
    }

    // ─── 规则4: 盈亏比差 ──────────────────────────
    // 大涨后上方空间有限
    if (changePercent > 8 && options?.change3D && options.change3D > 10) {
      hitRules.push('盈亏比差');
      details.push({
        rule: '盈亏比差',
        reason: `短期已涨${options.change3D.toFixed(1)}%，上方空间不足${THRESHOLDS.MIN_UP_SIDE}%，下方回调风险>${THRESHOLDS.MAX_DOWN_SIDE}%`,
        severity: 'high',
      });
    }

    // ─── 规则5: 题材透支 ──────────────────────────
    if (options?.topicExhausted === true) {
      hitRules.push('题材透支');
      details.push({
        rule: '题材透支',
        reason: '题材已充分炒作，缺乏新的催化因素',
        severity: 'high',
      });
    }

    // ─── 规则6: 承接差 ────────────────────────────
    // 高换手但涨幅不大(放量滞涨)
    if (turnoverRate > THRESHOLDS.HIGH_TURNOVER && changePercent < 2 && changePercent > -2) {
      hitRules.push('承接差');
      details.push({
        rule: '承接差',
        reason: `换手率${turnoverRate.toFixed(1)}%偏高但涨幅仅${changePercent.toFixed(1)}%，放量滞涨，资金承接不足`,
        severity: 'medium',
      });
    }

    // 下跌放量
    if (changePercent < -3 && turnoverRate > THRESHOLDS.HIGH_TURNOVER) {
      hitRules.push('承接差');
      details.push({
        rule: '承接差',
        reason: `下跌${changePercent.toFixed(1)}%且换手率${turnoverRate.toFixed(1)}%高，放量下跌，资金出逃`,
        severity: 'high',
      });
    }

    // ─── 规则7: 缩量 ──────────────────────────────
    if (isUpDay && turnoverRate < THRESHOLDS.LOW_TURNOVER) {
      hitRules.push('缩量');
      details.push({
        rule: '缩量',
        reason: `缩量上涨（换手${turnoverRate.toFixed(1)}%），缺乏资金确认，持续性存疑`,
        severity: 'medium',
      });
    }

    if (!isUpDay && turnoverRate < THRESHOLDS.LOW_TURNOVER) {
      hitRules.push('缩量');
      // 跌时缩量可能是好事也可能是坏事，低严重度
      if (!hitRules.includes('缩量')) {
        hitRules.push('缩量');
        details.push({
          rule: '缩量',
          reason: `缩量下跌（换手${turnoverRate.toFixed(1)}%），无人接盘`,
          severity: 'low',
        });
      }
    }

    // ─── 规则8: 冲高回落 ──────────────────────────
    if (isUpDay && shadowRatio > THRESHOLDS.SHADOW_RATIO && amplitude > THRESHOLDS.HIGH_AMPLITUDE) {
      hitRules.push('冲高回落');
      details.push({
        rule: '冲高回落',
        reason: `上影线比例${(shadowRatio * 100).toFixed(0)}%，振幅${amplitude.toFixed(1)}%，冲高回落明显`,
        severity: 'high',
      });
    } else if (shadowRatio > THRESHOLDS.SHADOW_RATIO) {
      hitRules.push('冲高回落');
      details.push({
        rule: '冲高回落',
        reason: `上影线比例${(shadowRatio * 100).toFixed(0)}%，日内冲高回落，抛压显现`,
        severity: 'medium',
      });
    }

    // ─── 规则9: 逻辑不连续 ────────────────────────
    if (options?.hasContinuousCatalyst === false) {
      hitRules.push('逻辑不连续');
      details.push({
        rule: '逻辑不连续',
        reason: '上涨逻辑是孤立事件，缺乏持续催化因素',
        severity: 'medium',
      });
    }

    // ─── 规则10: 模式不匹配 ───────────────────────
    if (options?.isGapUpLimit === true) {
      hitRules.push('模式不匹配');
      details.push({
        rule: '模式不匹配',
        reason: '一字板/加速板，无法参与，通道党票',
        severity: 'high',
      });
    }

    // ─── 规则11: 市场不配合 ───────────────────────
    if (avgMarketChange < -THRESHOLDS.MARKET_UNFIT) {
      hitRules.push('市场不配合');
      details.push({
        rule: '市场不配合',
        reason: `大盘环境偏弱（平均涨跌幅${avgMarketChange.toFixed(1)}%），个股独立行情难以持续`,
        severity: 'medium',
      });
    }

    // ─── 计算综合评分 ────────────────────────────

    // 基础分 100
    let score = 100;

    // 根据命中的规则扣分
    for (const detail of details) {
      switch (detail.severity) {
        case 'high':
          score -= 20;
          break;
        case 'medium':
          score -= 10;
          break;
        case 'low':
          score -= 5;
          break;
      }
    }

    // 技术面加分
    // 换手适中加分
    if (turnoverRate >= THRESHOLDS.LOW_TURNOVER && turnoverRate <= THRESHOLDS.HIGH_TURNOVER) {
      score += 5;
    }
    // 上涨加分
    if (changePercent > 0) score += 5;
    // 振幅适中加分
    if (amplitude > THRESHOLDS.LOW_AMPLITUDE && amplitude < THRESHOLDS.HIGH_AMPLITUDE) {
      score += 3;
    }

    // 评分限幅
    const compositeScore = Math.max(0, Math.min(100, score));

    return {
      excluded: hitRules.length > 0,
      hitRules,
      details,
      compositeScore,
    };
  }

  /**
   * 批量分析多只股票
   */
  analyzeBatch(
    quotes: StockQuote[],
    avgMarketChange: number,
    optionsMap?: Map<string, {
      consecutiveLimitDays?: number;
      change3D?: number;
      change5D?: number;
      topicExhausted?: boolean;
      logicClear?: boolean;
      hasContinuousCatalyst?: boolean;
      isGapUpLimit?: boolean;
    }>,
  ): Map<string, ExclusionResult> {
    const results = new Map<string, ExclusionResult>();

    for (const quote of quotes) {
      const opts = optionsMap?.get(quote.code);
      results.set(quote.code, this.analyze(quote, avgMarketChange, opts));
    }

    return results;
  }

  /**
   * 获取被排除的股票列表
   */
  getExcluded(
    results: Map<string, ExclusionResult>,
  ): Array<{ code: string; result: ExclusionResult }> {
    const excluded: Array<{ code: string; result: ExclusionResult }> = [];
    for (const [code, result] of results) {
      if (result.excluded) {
        excluded.push({ code, result });
      }
    }
    return excluded;
  }

  /**
   * 获取通过过滤的股票列表（综合评分 > 50）
   */
  getPassed(
    results: Map<string, ExclusionResult>,
  ): Array<{ code: string; result: ExclusionResult }> {
    const passed: Array<{ code: string; result: ExclusionResult }> = [];
    for (const [code, result] of results) {
      if (!result.excluded || result.compositeScore > 50) {
        passed.push({ code, result });
      }
    }
    return passed;
  }

  /**
   * 生成排除规则的自然语言报告
   */
  generateReport(result: ExclusionResult): string {
    if (!result.excluded) {
      return '✅ 通过所有排除规则检查';
    }

    const lines: string[] = ['⚠️ 触发排除规则:'];
    for (const detail of result.details) {
      const icon = detail.severity === 'high' ? '🔴' : detail.severity === 'medium' ? '🟡' : '🟢';
      lines.push(`  ${icon} [${detail.rule}] ${detail.reason}`);
    }
    lines.push(`\n综合评分: ${result.compositeScore}/100`);

    return lines.join('\n');
  }
}

// ═══════════════════════════════════════════════════════════════
// 单例导出
// ═══════════════════════════════════════════════════════════════

export const exclusionFilter = new ExclusionFilter();
