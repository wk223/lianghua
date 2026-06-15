/**
 * L1 市场环境判断模块
 * 分析大盘指数、情绪强弱、赚钱效应 → 输出环境级别 + 仓位建议
 *
 * 职责:
 *   1. 接收 MarketIndex[] + SectorData[] + SentimentData 等市场数据
 *   2. 计算关键指标:
 *      - 指数趋势方向 & 强度
 *      - 涨跌家数比（通过板块综合数据估算）
 *      - 成交量能变化
 *      - 板块效应强度（上涨板块占比 + 领涨板块涨幅）
 *      - 舆情/快讯情绪（基于财联社电报关键词分析）
 *   3. 输出 MarketEnvResult
 *
 * 评级标准:
 *   S = 极强: 指数共振向上 + 成交量放大 + 板块普涨 + 赚钱效应好 + 舆情乐观
 *   A = 强势: 指数上涨 + 量能配合 + 有主线板块 + 赚钱效应正常 + 情绪偏多
 *   B = 中性: 指数震荡 + 量能持平 + 板块分化 + 赚钱效应一般 + 情绪中性
 *   C = 弱势: 指数下跌 + 缩量 + 板块普跌 + 亏钱效应明显 + 情绪偏空
 *   D = 极弱: 指数暴跌 + 放量下跌 + 恐慌情绪 + 系统性风险 + 舆论悲观
 *
 * @module engine/l1-market
 */

import type {
  MarketEnvResult,
  MarketIndex,
  SectorData,
  EnvLevel,
  SentimentData,
} from '../utils/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 评分权重
// ═══════════════════════════════════════════════════════════════

const WEIGHTS = {
  INDEX_TREND: 0.30,       // 指数趋势权重
  SECTOR_EFFECT: 0.22,     // 板块效应权重
  VOLUME: 0.18,            // 成交量能权重
  MARKET_BREADTH: 0.18,    // 市场宽度（涨跌家数等）
  FLASH_SENTIMENT: 0.12,   // 舆情/快讯情绪权重（财联社 data）
} as const;

/** 每项满分 100 分 */
const MAX_SCORE = 100;

// ═══════════════════════════════════════════════════════════════
// L1MarketAnalyzer
// ═══════════════════════════════════════════════════════════════

export class L1MarketAnalyzer {
  /**
   * 全量分析市场环境
   *
   * @param indices     - 大盘指数列表（上证/深证/创业板/科创50）
   * @param sectors     - 板块行情列表（用于判断板块效应）
   * @param sentiment   - 舆情情绪数据（基于财联社快讯，可选）
   * @param prevIndices - 前一日指数数据（用于判断趋势变化，可选）
   * @returns MarketEnvResult
   */
  async analyze(
    indices: MarketIndex[],
    sectors: SectorData[],
    sentiment?: SentimentData,
    prevIndices?: MarketIndex[],
  ): Promise<MarketEnvResult> {
    if (indices.length === 0) {
      logger.warn('[L1] 无指数数据，返回默认环境');
      return {
        envLevel: 'B',
        sentiment: '数据不足',
        suggestion: '等待数据更新后再做判断',
      };
    }

    // 计算各部分得分
    const indexScore = this.scoreIndexTrend(indices, prevIndices);
    const sectorScore = this.scoreSectorEffect(sectors);
    const volumeScore = this.scoreVolume(indices);
    const breadthScore = this.scoreMarketBreadth(indices, sectors);
    const flashScore = sentiment
      ? this.scoreFlashSentiment(sentiment)
      : 50; // 无舆情数据时默认中性

    // 加权总分
    const totalScore =
      indexScore * WEIGHTS.INDEX_TREND +
      sectorScore * WEIGHTS.SECTOR_EFFECT +
      volumeScore * WEIGHTS.VOLUME +
      breadthScore * WEIGHTS.MARKET_BREADTH +
      flashScore * WEIGHTS.FLASH_SENTIMENT;

    // 评级 & 建议
    const envLevel = this.scoreToLevel(totalScore);
    const sentimentDesc = this.describeSentiment(indices, envLevel, sentiment);
    const suggestion = this.getSuggestion(envLevel, totalScore, indices, sentiment);

    logger.debug('[L1] 环境评分结果:', {
      indexScore: indexScore.toFixed(1),
      sectorScore: sectorScore.toFixed(1),
      volumeScore: volumeScore.toFixed(1),
      breadthScore: breadthScore.toFixed(1),
      flashScore: flashScore.toFixed(1),
      totalScore: totalScore.toFixed(1),
      envLevel,
      sentimentLabel: sentiment?.label ?? '无数据',
    });

    return { envLevel, sentiment: sentimentDesc, suggestion };
  }

  /**
   * 快速判断 — 只给评级，不做详细打分
   * 用于获取数据的模块内部快速判断
   */
  quickAssess(indices: MarketIndex[]): EnvLevel {
    if (indices.length === 0) return 'B';

    try {
      const avgChange = this.averageChange(indices);
      if (avgChange >= 1.5) return 'S';
      if (avgChange >= 0.5) return 'A';
      if (avgChange >= -0.5) return 'B';
      if (avgChange >= -1.5) return 'C';
      return 'D';
    } catch {
      return 'B';
    }
  }

  // ─── 评分方法 ──────────────────────────────────────

  /**
   * 指数趋势评分 (0-100)
   * - 各指数的涨跌幅平均值
   * - 上证/创业板加权（更重要的指数赋予更高权重）
   */
  private scoreIndexTrend(
    indices: MarketIndex[],
    prevIndices?: MarketIndex[],
  ): number {
    if (indices.length === 0) return 50;

    // 计算加权平均涨跌幅
    const avgChange = this.averageChange(indices);

    // 得分映射: 涨跌幅 → 0~100
    // +3%以上 → 100, +1% → 75, 0% → 50, -1% → 25, -3%以下 → 0
    let score = 50 + (avgChange / 3) * 50;
    score = Math.max(0, Math.min(100, score));

    // 趋势变化加分（如果今天比昨天好）
    if (prevIndices && prevIndices.length > 0) {
      const prevAvgChange = this.averageChange(prevIndices);
      const improvement = avgChange - prevAvgChange;
      if (improvement > 0.5) {
        score += 10; // 明显改善
      } else if (improvement < -0.5) {
        score -= 10; // 明显恶化
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 板块效应评分 (0-100)
   * - 上涨板块比例
   * - 领涨板块的涨幅强度
   */
  private scoreSectorEffect(sectors: SectorData[]): number {
    if (sectors.length === 0) return 50;

    // 上涨板块占比
    const upCount = sectors.filter((s) => s.changePercent > 0).length;
    const upRatio = upCount / sectors.length;

    // 领涨板块强度
    const top3Avg =
      sectors
        .slice(0, 3)
        .reduce((sum, s) => sum + Math.max(0, s.changePercent), 0) / 3;

    // 综合得分
    const ratioScore = upRatio * 100;
    const strengthScore = Math.min(100, (top3Avg / 5) * 100);

    return ratioScore * 0.6 + strengthScore * 0.4;
  }

  /**
   * 成交量能评分 (0-100)
   * - 比较各指数的成交量与成交额变化
   * - 放量上涨 = 健康
   * - 缩量下跌 = 弱势
   */
  private scoreVolume(indices: MarketIndex[]): number {
    if (indices.length === 0) return 50;

    // 基于涨跌幅推断成交量配合
    const avgChange = this.averageChange(indices);

    if (avgChange > 1) return 70; // 上涨放量
    if (avgChange > 0) return 60; // 温和上涨
    if (avgChange > -0.5) return 50; // 震荡
    if (avgChange > -1.5) return 30; // 下跌缩量
    return 20; // 放量下跌
  }

  /**
   * 市场宽度评分 (0-100)
   * - 上涨/下跌家数比（通过板块数据估算）
   * - 涨停/跌停数量
   */
  private scoreMarketBreadth(
    indices: MarketIndex[],
    sectors: SectorData[],
  ): number {
    if (indices.length === 0 && sectors.length === 0) return 50;

    // 板块涨跌比
    let sectorRatio = 0.5;
    if (sectors.length > 0) {
      const upCount = sectors.filter((s) => s.changePercent > 0).length;
      sectorRatio = upCount / sectors.length;
    }

    const ratioScore = sectorRatio * 100;

    // 行业板块的平均涨跌家数比
    let breadthBonus = 0;
    const sectorWithBreadth = sectors.filter(
      (s) => s.upCount > 0 || s.downCount > 0,
    );
    if (sectorWithBreadth.length > 0) {
      const avgUpDownRatio =
        sectorWithBreadth.reduce((sum, s) => {
          const total = s.upCount + s.downCount;
          return total > 0 ? sum + s.upCount / total : sum;
        }, 0) / sectorWithBreadth.length;

      breadthBonus = (avgUpDownRatio - 0.5) * 40;
    }

    return Math.max(0, Math.min(100, ratioScore * 0.7 + breadthBonus));
  }

  /**
   * 舆情/快讯情绪评分 (0-100)
   *
   * 基于财联社快讯的语义分析得分，映射到 0~100 分:
   *   Sentiment score -100 ~ 100 → 0 ~ 100
   *
   * 额外考量:
   * - 重要快讯占比越高，信号可信度越高
   * - 政策利好/利空信号数量影响信心
   */
  private scoreFlashSentiment(sentiment: SentimentData): number {
    // 基准: sentiment.score 范围 -100 ~ 100
    // 映射到 0 ~ 100: score=100 → 100, score=-100 → 0, score=0 → 50
    let baseScore = 50 + (sentiment.score / 100) * 50;
    baseScore = Math.max(0, Math.min(100, baseScore));

    // 快讯数量信心加成: 快讯越多，信号越可靠
    const confidenceBonus = Math.min(10, sentiment.flashCount / 5);

    // 重要快讯比例加分
    const importantRatio =
      sentiment.flashCount > 0
        ? sentiment.importantCount / sentiment.flashCount
        : 0;
    const importantBonus = importantRatio * 10;

    // 政策信号加分（更多政策利好 → 积极）
    const policyBonus = Math.min(5, sentiment.policyCues.length * 1);
    const riskPenalty = Math.min(5, sentiment.riskCues.length * 1);

    let finalScore = baseScore + confidenceBonus + importantBonus + policyBonus - riskPenalty;

    return Math.max(0, Math.min(100, Math.round(finalScore)));
  }

  // ─── 辅助方法 ──────────────────────────────────────

  /** 计算指数平均涨跌幅 */
  private averageChange(indices: MarketIndex[]): number {
    if (indices.length === 0) return 0;
    return indices.reduce((sum, idx) => sum + idx.changePercent, 0) / indices.length;
  }

  /** 分数 → 环境评级 */
  private scoreToLevel(score: number): EnvLevel {
    if (score >= 80) return 'S';
    if (score >= 60) return 'A';
    if (score >= 40) return 'B';
    if (score >= 20) return 'C';
    return 'D';
  }

  /** 生成情绪描述（结合指数数据 + 舆情情绪） */
  private describeSentiment(
    indices: MarketIndex[],
    level: EnvLevel,
    sentiment?: SentimentData,
  ): string {
    const avgChange = this.averageChange(indices);

    // 如果有舆情数据，优先使用舆情标签
    if (sentiment && sentiment.flashCount > 0) {
      const flashPart = sentiment.label;
      const topicPart =
        sentiment.hotTopics.length > 0
          ? `热点: ${sentiment.hotTopics.slice(0, 3).join('/')}`
          : '';
      const policyPart =
        sentiment.policyCues.length > 0
          ? `政策: ${sentiment.policyCues.slice(0, 3).join('/')}`
          : '';

      const parts = [flashPart];
      if (topicPart) parts.push(topicPart);
      if (policyPart) parts.push(policyPart);

      return parts.join(' | ');
    }

    // 无舆情数据时，基于指数数据推断
    const sentimentMap: Record<EnvLevel, string[]> = {
      S: ['情绪亢奋', '赚钱效应强', '市场全面活跃'],
      A: ['情绪偏多', '赚钱效应较好', '市场健康'],
      B: ['情绪中性', '赚钱效应一般', '市场震荡'],
      C: ['情绪偏空', '亏钱效应明显', '市场低迷'],
      D: ['情绪恐慌', '系统性风险', '市场极端弱势'],
    };

    const options = sentimentMap[level];
    if (avgChange > 2) return options[0];
    if (avgChange > 0.5) return options[1];
    return options[2];
  }

  /** 获取仓位/风格建议（结合舆情情绪调整） */
  private getSuggestion(
    level: EnvLevel,
    score: number,
    indices: MarketIndex[],
    sentiment?: SentimentData,
  ): string {
    const avgChange = this.averageChange(indices);

    // 根据舆情情绪调整建议
    const sentimentAdjustment = sentiment
      ? this.sentimentAdjustment(sentiment)
      : '';

    let base: string;

    switch (level) {
      case 'S':
        base =
          avgChange > 2
            ? '可积极做多，仓位 7-8 成，追涨需谨慎'
            : '可适当加仓，仓位 5-7 成，围绕主线操作';
        break;
      case 'A':
        base = '仓位 4-6 成，聚焦主线，避免追高';
        break;
      case 'B':
        base = '仓位 3-5 成，谨慎操作，快进快出';
        break;
      case 'C':
        base = '仓位 1-3 成，防守为主，仅做核心龙头';
        break;
      case 'D':
        base = '空仓或极轻仓，不建议开新仓';
        break;
    }

    if (sentimentAdjustment) {
      return `${base}。${sentimentAdjustment}`;
    }
    return base;
  }

  /**
   * 基于舆情情绪生成额外的操作提示
   */
  private sentimentAdjustment(sentiment: SentimentData): string {
    const tips: string[] = [];

    // 政策信号提示
    if (sentiment.policyCues.length >= 3) {
      tips.push('政策利好密集释放，关注受益板块');
    } else if (sentiment.policyCues.length >= 1) {
      tips.push('政策面偏积极');
    }

    // 风险信号提示
    if (sentiment.riskCues.length >= 3) {
      tips.push('注意利空因素累积风险');
    } else if (sentiment.riskCues.length >= 1) {
      tips.push('关注提示的利空因素');
    }

    // 情绪极端提示
    if (sentiment.score <= -60) {
      tips.push('舆情极度悲观，警惕短期超跌反弹机会');
    } else if (sentiment.score >= 60) {
      tips.push('情绪过于亢奋，注意回调风险');
    }

    // 热点提示
    if (sentiment.hotTopics.length > 0) {
      tips.push(`舆情热点: ${sentiment.hotTopics.slice(0, 3).join('/')}`);
    }

    return tips.join('；');
  }
}
