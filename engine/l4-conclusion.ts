/**
 * L4 结论输出模块 — 增强版
 *
 * 对齐 xvqiu-requirements.md Section 5 完整9项输出结构
 * 支持增强的 MarketEnvResult、DirectionResult、StockAnalysisResult 字段
 * 支持比较模式 CompareResult
 * 支持环境诊断增强字段 (todayAction, avoidType, certainDirections)
 *
 * @module engine/l4-conclusion
 */

import type {
  AnalysisResult,
  ConclusionResult,
  DirectionResult,
  MarketEnvResult,
  StockAnalysisResult,
  CompareResult,
  Verdict,
  EnvLevel,
  LogicStrength,
  StockStatus,
  BuyMethod,
  RiskRewardGrade,
  BuyPointGrade,
} from '../utils/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 解析错误
// ═══════════════════════════════════════════════════════════════

export class L4ParseError extends Error {
  constructor(
    message: string,
    public readonly rawText?: string,
    public readonly parseStage?: string,
  ) {
    super(message);
    this.name = 'L4ParseError';
  }
}

// ═══════════════════════════════════════════════════════════════
// LLM 输出接口（JSON 结构定义 — 增强版）
// ═══════════════════════════════════════════════════════════════

interface LLMOutput {
  marketEnv?: {
    envLevel?: string;
    sentiment?: string;
    suggestion?: string;
    todayAction?: string;
    avoidType?: string;
    certainDirections?: string[];
  };
  directions?: Array<{
    mainLine?: string;
    subLine?: string;
    logicStrength?: string;
    suitablePlay?: string;
    recommendations?: string[];
  }>;
  stocks?: Array<{
    stock?: string;
    code?: string;
    direction?: string;
    directionType?: string;
    logicStrength?: string;
    logicSummary?: string;
    stockStatus?: string;
    position?: string;
    buyPoint?: string;
    buyPointReason?: string;
    buyMethod?: string;
    riskReward?: string;
    riskRewardDetail?: string;
    strength?: string;
    volumeAnalysis?: string;
    logic?: string;
    risk?: string[];
    verdict?: string;
    reason?: string;
    priority?: number;
  }>;
  conclusions?: Array<{
    stockCode?: string;
    stockName?: string;
    verdict?: string;
    reason?: string;
    riskPoints?: string[];
    priority?: number;
  }>;
  compareResult?: {
    exists?: boolean;
    winner?: string;
    winnerReason?: string;
    loserReason?: string;
    betterFit?: string;
    betterBuyPoint?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// 有效值范围
// ═══════════════════════════════════════════════════════════════

const VALID_ENV_LEVELS: EnvLevel[] = ['S', 'A', 'B', 'C', 'D'];
const VALID_VERDICTS: Verdict[] = ['BUY', 'COND_BUY', 'WATCH', 'NO_BUY'];
const VALID_LOGIC_STRENGTHS: LogicStrength[] = ['强', '中', '弱'];
const VALID_STOCK_STATUSES: StockStatus[] = ['核心', '前排', '跟风', '补涨', '边缘'];
const VALID_BUY_METHODS: BuyMethod[] = ['打板', '低吸', '半路', '观望'];
const VALID_RISK_REWARDS: RiskRewardGrade[] = ['好', '一般', '差'];
const VALID_BUY_POINTS: BuyPointGrade[] = ['好', '一般', '差'];

// ═══════════════════════════════════════════════════════════════
// L4ConclusionEngine
// ═══════════════════════════════════════════════════════════════

export class L4ConclusionEngine {
  /**
   * 解析并处理 LLM 输出
   */
  async process(
    llmOutput: string,
    fallback?: {
      envLevel?: EnvLevel;
      stockCodes?: string[];
    },
  ): Promise<AnalysisResult> {
    if (!llmOutput || llmOutput.trim().length === 0) {
      throw new L4ParseError('LLM 输出为空', llmOutput, 'empty');
    }

    // 清理输出
    const cleaned = this.cleanLLMOutput(llmOutput);

    // 解析 JSON
    let parsed: LLMOutput;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const repaired = this.attemptJSONRepair(cleaned);
      if (repaired !== null) {
        parsed = repaired;
      } else {
        throw new L4ParseError(
          `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
          llmOutput,
          'json-parse',
        );
      }
    }

    // 逐部分校验
    const marketEnv = this.parseMarketEnv(parsed.marketEnv, fallback?.envLevel);
    const directions = this.parseDirections(parsed.directions);
    const stocks = this.parseStocks(parsed.stocks);
    const conclusions = this.parseConclusions(
      parsed.conclusions,
      parsed.stocks,
      fallback?.stockCodes,
    );
    const compareResult = this.parseCompareResult(parsed.compareResult);

    // 完整性检查
    if (conclusions.length === 0 && fallback?.stockCodes) {
      logger.warn('[L4] LLM 未输出结论，使用 fallback');
      for (const code of fallback.stockCodes) {
        conclusions.push({
          stockCode: code,
          stockName: code,
          verdict: 'WATCH',
          reason: 'LLM 未给出结论，默认观察',
          riskPoints: ['数据不足'],
          priority: 99,
        });
      }
    }

    // 优先级排序
    conclusions.sort((a, b) => a.priority - b.priority);
    this.normalizePriorities(conclusions);

    const result: AnalysisResult = {
      marketEnv,
      directions,
      stocks,
      conclusions,
      compareResult: compareResult ?? undefined,
      timestamp: Date.now(),
    };

    logger.debug('[L4] 结论处理完成:', {
      envLevel: marketEnv.envLevel,
      directions: directions.length,
      stocks: stocks.length,
      conclusions: conclusions.length,
      buyCount: conclusions.filter((c) => c.verdict === 'BUY').length,
      hasCompare: !!compareResult?.exists,
    });

    return result;
  }

  /**
   * 快速校验 LLM 输出是否为有效 JSON
   */
  validateChunk(text: string): { valid: boolean; reason?: string } {
    const cleaned = this.cleanLLMOutput(text);
    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== 'object') {
        return { valid: false, reason: '非对象' };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: 'JSON 语法错误' };
    }
  }

  // ─── 内部解析方法 ──────────────────────────────────

  /**
   * 解析市场环境部分 — 增强版
   */
  private parseMarketEnv(
    raw: LLMOutput['marketEnv'],
    fallbackLevel?: EnvLevel,
  ): MarketEnvResult {
    const defaultResult: MarketEnvResult = {
      envLevel: fallbackLevel ?? 'B',
      sentiment: '数据不足',
      suggestion: '等待数据更新',
    };

    if (!raw) return defaultResult;

    const envLevel = this.normalizeEnvLevel(raw.envLevel) ?? defaultResult.envLevel;
    const sentiment = raw.sentiment?.trim() || defaultResult.sentiment;
    const suggestion = raw.suggestion?.trim() || defaultResult.suggestion;
    const todayAction = raw.todayAction?.trim();
    const avoidType = raw.avoidType?.trim();
    const certainDirections = Array.isArray(raw.certainDirections)
      ? raw.certainDirections.filter(Boolean).map((d) => String(d))
      : undefined;

    return {
      envLevel,
      sentiment,
      suggestion,
      todayAction: todayAction || undefined,
      avoidType: avoidType || undefined,
      certainDirections: certainDirections && certainDirections.length > 0
        ? certainDirections
        : undefined,
    };
  }

  /**
   * 解析方向部分 — 增强版
   */
  private parseDirections(raw: LLMOutput['directions']): DirectionResult[] {
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    return raw
      .filter((d) => d && d.mainLine)
      .map((d) => ({
        mainLine: d.mainLine ?? '未知方向',
        subLine: d.subLine ?? '',
        logicStrength: this.normalizeLogicStrength(d.logicStrength) ?? undefined,
        suitablePlay: this.normalizeBuyMethod(d.suitablePlay) ?? undefined,
        recommendations: Array.isArray(d.recommendations) ? d.recommendations : [],
      }));
  }

  /**
   * 解析个股分析部分 — 增强版
   */
  private parseStocks(raw: LLMOutput['stocks']): StockAnalysisResult[] {
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    return raw
      .filter((s) => s && (s.stock || s.code))
      .map((s) => ({
        stock: s.stock ?? s.code ?? '未知',
        code: s.code ?? '',
        direction: s.direction?.trim() || undefined,
        directionType: s.directionType?.trim() || undefined,
        logicStrength: this.normalizeLogicStrength(s.logicStrength) ?? undefined,
        logicSummary: s.logicSummary?.trim() || undefined,
        stockStatus: this.normalizeStockStatus(s.stockStatus) ?? undefined,
        position: s.position ?? '--',
        buyPoint: this.normalizeBuyPointGrade(s.buyPoint) ?? '--',
        buyPointReason: s.buyPointReason?.trim() || undefined,
        buyMethod: this.normalizeBuyMethod(s.buyMethod) ?? undefined,
        riskReward: this.normalizeRiskReward(s.riskReward) ?? undefined,
        riskRewardDetail: s.riskRewardDetail?.trim() || undefined,
        strength: s.strength ?? '--',
        volumeAnalysis: s.volumeAnalysis ?? '--',
        logic: s.logic ?? '--',
        risk: Array.isArray(s.risk) && s.risk.length > 0
          ? s.risk.filter(Boolean).map(String)
          : ['未知风险'],
        verdict: this.normalizeVerdict(s.verdict) ?? undefined,
      }));
  }

  /**
   * 解析结论部分
   */
  private parseConclusions(
    raw: LLMOutput['conclusions'],
    stockResults?: LLMOutput['stocks'],
    stockCodes?: string[],
  ): ConclusionResult[] {
    const results: ConclusionResult[] = [];

    // 如果 LLM 直接输出了 conclusions 数组
    if (raw && Array.isArray(raw) && raw.length > 0) {
      for (const c of raw) {
        if (!c || (!c.stockCode && !c.stockName)) continue;
        const verdict = this.normalizeVerdict(c.verdict);
        if (!verdict) {
          logger.warn(`[L4] 忽略无效 verdict: ${c.verdict}`);
          continue;
        }
        results.push({
          stockCode: c.stockCode ?? c.stockName ?? '未知',
          stockName: c.stockName ?? c.stockCode ?? '未知',
          verdict,
          reason: c.reason?.trim() || '无说明',
          riskPoints: Array.isArray(c.riskPoints) && c.riskPoints.length > 0
            ? c.riskPoints
            : ['未指明风险'],
          priority: typeof c.priority === 'number' ? c.priority : 999,
        });
      }
    }

    // 如果 LLM 仅在 stocks 数组中输出了 verdict，从中提取结论
    if (results.length === 0 && stockResults && Array.isArray(stockResults)) {
      for (const s of stockResults) {
        const verdict = this.normalizeVerdict(s.verdict);
        if (!verdict || (!s.stock && !s.code)) continue;
        results.push({
          stockCode: s.code ?? s.stock ?? '未知',
          stockName: s.stock ?? s.code ?? '未知',
          verdict,
          reason: s.reason?.trim() || '无说明',
          riskPoints: Array.isArray(s.risk) && s.risk.length > 0
            ? s.risk
            : ['未指明风险'],
          priority: typeof s.priority === 'number' ? s.priority : 999,
        });
      }
    }

    return results;
  }

  /**
   * 解析比较模式结果
   */
  private parseCompareResult(raw: LLMOutput['compareResult']): CompareResult | null {
    if (!raw) return null;

    const exists = raw.exists === true;
    if (!exists) return null;

    return {
      exists: true,
      winner: raw.winner?.trim() || '未知',
      winnerReason: raw.winnerReason?.trim() || '',
      loserReason: raw.loserReason?.trim() || '',
      betterFit: raw.betterFit?.trim() || '',
      betterBuyPoint: raw.betterBuyPoint?.trim() || '',
    };
  }

  // ─── 规范化 ──────────────────────────────────────────

  private normalizeEnvLevel(value?: string): EnvLevel | null {
    if (!value) return null;
    const upper = value.toUpperCase().trim() as EnvLevel;
    return VALID_ENV_LEVELS.includes(upper) ? upper : null;
  }

  private normalizeVerdict(value?: string): Verdict | null {
    if (!value) return null;
    const upper = value.toUpperCase().trim() as Verdict;
    if (VALID_VERDICTS.includes(upper)) return upper;
    if (upper.includes('BUY') || upper.includes('买')) return 'COND_BUY';
    if (upper.includes('WATCH') || upper.includes('观') || upper.includes('察')) return 'WATCH';
    if (upper.includes('NO') || upper.includes('不') || upper.includes('放弃')) return 'NO_BUY';
    return null;
  }

  private normalizeLogicStrength(value?: string): LogicStrength | null {
    if (!value) return null;
    const trimmed = value.trim() as LogicStrength;
    return VALID_LOGIC_STRENGTHS.includes(trimmed) ? trimmed : null;
  }

  private normalizeStockStatus(value?: string): StockStatus | null {
    if (!value) return null;
    const trimmed = value.trim() as StockStatus;
    if (VALID_STOCK_STATUSES.includes(trimmed)) return trimmed;
    // 模糊匹配
    if (trimmed.includes('核心')) return '核心';
    if (trimmed.includes('前排')) return '前排';
    if (trimmed.includes('跟风')) return '跟风';
    if (trimmed.includes('补涨')) return '补涨';
    if (trimmed.includes('边缘')) return '边缘';
    return null;
  }

  private normalizeBuyMethod(value?: string): BuyMethod | null {
    if (!value) return null;
    const trimmed = value.trim() as BuyMethod;
    if (VALID_BUY_METHODS.includes(trimmed)) return trimmed;
    if (trimmed.includes('打板')) return '打板';
    if (trimmed.includes('低吸')) return '低吸';
    if (trimmed.includes('半路')) return '半路';
    if (trimmed.includes('观望')) return '观望';
    return null;
  }

  private normalizeRiskReward(value?: string): RiskRewardGrade | null {
    if (!value) return null;
    const trimmed = value.trim() as RiskRewardGrade;
    return VALID_RISK_REWARDS.includes(trimmed) ? trimmed : null;
  }

  private normalizeBuyPointGrade(value?: string): BuyPointGrade | null {
    if (!value) return null;
    const trimmed = value.trim() as BuyPointGrade;
    return VALID_BUY_POINTS.includes(trimmed) ? trimmed : null;
  }

  private normalizePriorities(conclusions: ConclusionResult[]): void {
    const prioritized = conclusions.sort((a, b) => {
      const aWeight = this.verdictWeight(a.verdict);
      const bWeight = this.verdictWeight(b.verdict);
      if (aWeight !== bWeight) return aWeight - bWeight;
      return (a.priority ?? 999) - (b.priority ?? 999);
    });
    prioritized.forEach((c, i) => {
      c.priority = i + 1;
    });
  }

  private verdictWeight(verdict: Verdict): number {
    switch (verdict) {
      case 'BUY': return 1;
      case 'COND_BUY': return 2;
      case 'WATCH': return 3;
      case 'NO_BUY': return 4;
    }
  }

  // ─── 清理 & 修复 ──────────────────────────────────

  private cleanLLMOutput(text: string): string {
    let cleaned = text.trim();
    if (cleaned.charCodeAt(0) === 0xFEFF) {
      cleaned = cleaned.slice(1);
    }
    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    }
    cleaned = cleaned.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '');
    return cleaned.trim();
  }

  private attemptJSONRepair(text: string): LLMOutput | null {
    let repaired = text;
    repaired = repaired.replace(/\/\/.*$/gm, '');
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');
    repaired = repaired.replace(/'/g, '"');
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(repaired) as LLMOutput;
    } catch {
      return null;
    }
  }
}
