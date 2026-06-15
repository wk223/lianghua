/**
 * L2 方向判断模块
 * 识别主线/次主线/题材持续性 → 输出方向优先级 + 逻辑强度
 *
 * 职责:
 *   1. 接收 SectorData[] / HotTopic[] 等板块数据
 *   2. 分析板块涨幅、资金流向、涨停家数、持续性
 *   3. 识别主线方向、次主线方向、轮动方向
 *   4. 输出方向优先级排序
 *
 * 判断维度:
 *   - 涨幅强度: 板块/题材当日的涨幅排名
 *   - 资金强度: 资金净流入量
 *   - 广度强度: 上涨家数占比
 *   - 持续性: 近 N 日反复活跃程度（通过多次调用窗口判断）
 *   - 逻辑确定性: 政策/业绩/事件驱动
 *
 * @module engine/l2-direction
 */

import type {
  DirectionResult,
  SectorData,
  HotTopic,
} from '../utils/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 评分维度定义
// ═══════════════════════════════════════════════════════════════

interface DirectionScore {
  name: string;
  code: string;
  changePercent: number;
  upRatio: number;        // 上涨家数占比 (0~1)
  capitalFlow: number;    // 资金净流入 (万元)
  compositeScore: number; // 综合评分
  type: 'sector' | 'topic';
}

/** 评分权重 */
const WEIGHTS = {
  CHANGE: 0.30,      // 涨幅权重
  BREADTH: 0.25,     // 广度（涨跌比）权重
  CAPITAL: 0.25,     // 资金流向权重
  LEADING: 0.20,     // 领涨股强度权重
} as const;

/** 方向分类阈值 */
const THRESHOLDS = {
  MAIN_LINE: 65,     // ≥65分 → 主线
  SUB_LINE: 40,      // ≥40分 → 次线
  // <40分 → 一般方向
} as const;

/** 最多推荐方向数 */
const MAX_DIRECTIONS = 3;

// ═══════════════════════════════════════════════════════════════
// L2DirectionAnalyzer
// ═══════════════════════════════════════════════════════════════

export class L2DirectionAnalyzer {
  /**
   * 分析当前市场方向
   *
   * @param sectors - 行业板块行情列表（从东方财富获取）
   * @param topics  - 概念/题材列表
   * @returns DirectionResult[] — 按优先级排序的方向列表
   */
  async analyze(
    sectors: SectorData[],
    topics?: HotTopic[],
  ): Promise<DirectionResult[]> {
    if (sectors.length === 0 && (!topics || topics.length === 0)) {
      logger.warn('[L2] 无板块/题材数据，返回空方向');
      return [];
    }

    // ── 1. 计算所有方向的综合评分 ──
    const scored: DirectionScore[] = [];

    // 评分行业板块
    for (const sector of sectors) {
      const score = this.calculateCompositeScore(sector);
      scored.push({
        name: sector.name,
        code: sector.code,
        changePercent: sector.changePercent,
        upRatio: sector.upCount + sector.downCount > 0
          ? sector.upCount / (sector.upCount + sector.downCount)
          : 0.5,
        capitalFlow: sector.capitalFlow,
        compositeScore: score,
        type: 'sector',
      });
    }

    // 评分概念题材
    if (topics) {
      for (const topic of topics) {
        const score = this.calculateTopicScore(topic);
        scored.push({
          name: topic.name,
          code: topic.code,
          changePercent: topic.changePercent,
          upRatio: topic.upCount + topic.downCount > 0
            ? topic.upCount / (topic.upCount + topic.downCount)
            : 0.5,
          capitalFlow: topic.capitalFlow,
          compositeScore: score,
          type: 'topic',
        });
      }
    }

    // ── 2. 按综合评分降序排列 ──
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // ── 3. 分类：主线 / 次线 / 淘汰 ──
    const mainLines: DirectionScore[] = [];
    const subLines: DirectionScore[] = [];

    for (const d of scored.slice(0, 10)) {
      // 去重：同类型方向只保留得分最高的
      if (d.compositeScore >= THRESHOLDS.MAIN_LINE) {
        if (!this.isDuplicateDirection(mainLines, d)) {
          mainLines.push(d);
        }
      } else if (d.compositeScore >= THRESHOLDS.SUB_LINE) {
        if (!this.isDuplicateDirection(subLines, d)) {
          subLines.push(d);
        }
      }
    }

    // ── 4. 构建输出 ──
    const results: DirectionResult[] = [];
    let rank = 0;

    // 主线（最多 2 条）
    for (const d of mainLines.slice(0, 2)) {
      rank++;
      results.push({
        mainLine: d.name,
        subLine: rank === 1 ? '主线核心' : '主线延伸/补涨',
        recommendations: [], // L3 分析后填充
      });
    }

    // 次线（最多 1 条）
    if (subLines.length > 0 && results.length < MAX_DIRECTIONS) {
      const d = subLines[0];
      results.push({
        mainLine: d.name,
        subLine: '次线/轮动方向',
        recommendations: [],
      });
    }

    // 如果没有识别到任何方向，返回一个默认
    if (results.length === 0) {
      results.push({
        mainLine: '无明显主线',
        subLine: '快速轮动/防守',
        recommendations: [],
      });
    }

    logger.debug('[L2] 方向分析结果:', {
      analyzed: scored.length,
      mainLines: mainLines.map((d) => `${d.name}(${d.compositeScore.toFixed(0)}分)`),
      subLines: subLines.map((d) => `${d.name}(${d.compositeScore.toFixed(0)}分)`),
    });

    return results;
  }

  /**
   * 获取当前最强方向（仅返回第一条主线）
   * 用于快速判断方向偏好
   */
  async getPrimaryDirection(
    sectors: SectorData[],
    topics?: HotTopic[],
  ): Promise<DirectionResult | null> {
    const directions = await this.analyze(sectors, topics);
    return directions.length > 0 ? directions[0] : null;
  }

  // ─── 评分方法 ──────────────────────────────────────

  /**
   * 计算板块方向的综合评分 (0-100)
   */
  private calculateCompositeScore(sector: SectorData): number {
    // 涨幅得分 (0~100)
    // +5% → 100, +2% → 60, 0% → 30, -2% → 10, -5% → 0
    const changeScore = Math.max(0, Math.min(100,
      30 + (sector.changePercent / 5) * 70
    ));

    // 广度得分 (0~100)
    const total = sector.upCount + sector.downCount;
    const breadthScore = total > 0
      ? (sector.upCount / total) * 100
      : 50;

    // 资金得分 (0~100)
    // +10亿 → 100, 0 → 50, -10亿 → 0
    const capitalScore = Math.max(0, Math.min(100,
      50 + (sector.capitalFlow / 100_000) * 50
    ));

    // 领涨股强度得分 (0~100)
    const leadingScore = Math.max(0, Math.min(100,
      50 + (sector.leadingChange / 10) * 50
    ));

    return (
      changeScore * WEIGHTS.CHANGE +
      breadthScore * WEIGHTS.BREADTH +
      capitalScore * WEIGHTS.CAPITAL +
      leadingScore * WEIGHTS.LEADING
    );
  }

  /**
   * 计算概念题材的综合评分 (0-100)
   * 概念数据结构与板块略有不同
   */
  private calculateTopicScore(topic: HotTopic): number {
    // 涨幅得分 (0~100)
    const changeScore = Math.max(0, Math.min(100,
      30 + (topic.changePercent / 5) * 70
    ));

    // 广度得分 (0~100)
    const total = topic.upCount + topic.downCount;
    const breadthScore = total > 0
      ? (topic.upCount / total) * 100
      : 50;

    // 资金得分 (0~100)
    const capitalScore = Math.max(0, Math.min(100,
      50 + (topic.capitalFlow / 100_000) * 50
    ));

    // 领涨股强度得分 (0~100)
    const leadingScore = Math.max(0, Math.min(100,
      50 + (topic.leadingChange / 10) * 50
    ));

    // 题材的权重分配略有不同（题材更看重涨幅和广度）
    return (
      changeScore * 0.35 +
      breadthScore * 0.30 +
      capitalScore * 0.20 +
      leadingScore * 0.15
    );
  }

  // ─── 辅助方法 ──────────────────────────────────────

  /**
   * 检查是否为重复方向（名称相似的主题/板块去重）
   */
  private isDuplicateDirection(
    existing: DirectionScore[],
    candidate: DirectionScore,
  ): boolean {
    return existing.some((d) => {
      // 名称包含或被包含
      const nameA = d.name.replace(/[板块概念题材]/g, '');
      const nameB = candidate.name.replace(/[板块概念题材]/g, '');
      return nameA.includes(nameB) || nameB.includes(nameA);
    });
  }
}
