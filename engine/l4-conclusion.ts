/**
 * L4 结论输出模块
 * 解析 LLM 输出 + 后处理 → 结构化 AnalysisResult
 *
 * 职责:
 *   1. 接收 LLM 返回的 JSON 字符串
 *   2. 解析并校验 JSON 结构
 *   3. 校验结论枚举值、优先级排序
 *   4. 补充默认值、处理部分失败的场景
 *   5. 输出完整的 AnalysisResult
 *
 * @module engine/l4-conclusion
 */

import type {
  AnalysisResult,
  ConclusionResult,
  DirectionResult,
  MarketEnvResult,
  StockAnalysisResult,
  Verdict,
  EnvLevel,
} from '../utils/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 解析错误
// ═══════════════════════════════════════════════════════════════

/** L4 解析错误 */
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
// LLM 输出接口（JSON 结构定义）
// ═══════════════════════════════════════════════════════════════

/** LLM 输出的原始 JSON（用户端使用的 snake_case 或 camelCase） */
interface LLMOutput {
  marketEnv?: {
    envLevel?: string;
    sentiment?: string;
    suggestion?: string;
  };
  directions?: Array<{
    mainLine?: string;
    subLine?: string;
    recommendations?: string[];
  }>;
  stocks?: Array<{
    stock?: string;
    code?: string;
    position?: string;
    strength?: string;
    volumeAnalysis?: string;
    logic?: string;
    risk?: string[];
    buyPoint?: string;
  }>;
  conclusions?: Array<{
    stockCode?: string;
    stockName?: string;
    verdict?: string;
    reason?: string;
    riskPoints?: string[];
    priority?: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// 有效值范围
// ═══════════════════════════════════════════════════════════════

const VALID_ENV_LEVELS: EnvLevel[] = ['S', 'A', 'B', 'C', 'D'];
const VALID_VERDICTS: Verdict[] = ['BUY', 'COND_BUY', 'WATCH', 'NO_BUY'];

// ═══════════════════════════════════════════════════════════════
// L4ConclusionEngine
// ═══════════════════════════════════════════════════════════════

export class L4ConclusionEngine {
  /**
   * 解析并处理 LLM 输出
   *
   * @param llmOutput - DeepSeek 返回的 content 字符串（预期为 JSON）
   * @param fallback  - 可选 fallback 数据（用于 LLM 部分失败时的降级）
   * @returns 完整的 AnalysisResult
   * @throws L4ParseError 当 JSON 解析完全失败时
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

    // ── 1. 清理输出（去掉可能的 markdown 代码块标记） ──
    const cleaned = this.cleanLLMOutput(llmOutput);

    // ── 2. 解析 JSON ──
    let parsed: LLMOutput;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      // 尝试修复常见 JSON 错误
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

    // ── 3. 逐部分校验 ──
    const marketEnv = this.parseMarketEnv(parsed.marketEnv, fallback?.envLevel);
    const directions = this.parseDirections(parsed.directions);
    const stocks = this.parseStocks(parsed.stocks);
    const conclusions = this.parseConclusions(
      parsed.conclusions,
      fallback?.stockCodes,
    );

    // ── 4. 完整性检查 ──
    // 如果某些部分缺失，用 fallback 补充
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

    // ── 5. 优先级排序 ──
    conclusions.sort((a, b) => a.priority - b.priority);

    // ── 6. 补充优先级（如果未设置或重复） ──
    this.normalizePriorities(conclusions);

    const result: AnalysisResult = {
      marketEnv,
      directions,
      stocks,
      conclusions,
      timestamp: Date.now(),
    };

    logger.debug('[L4] 结论处理完成:', {
      envLevel: marketEnv.envLevel,
      directions: directions.length,
      stocks: stocks.length,
      conclusions: conclusions.length,
      buyCount: conclusions.filter((c) => c.verdict === 'BUY').length,
    });

    return result;
  }

  /**
   * 快速校验 LLM 输出是否为有效 JSON
   * 用于流式场景下的实时校验
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
   * 解析市场环境部分
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

    return { envLevel, sentiment, suggestion };
  }

  /**
   * 解析方向部分
   */
  private parseDirections(
    raw: LLMOutput['directions'],
  ): DirectionResult[] {
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    return raw
      .filter((d) => d && d.mainLine)
      .map((d) => ({
        mainLine: d.mainLine ?? '未知方向',
        subLine: d.subLine ?? '',
        recommendations: Array.isArray(d.recommendations) ? d.recommendations : [],
      }));
  }

  /**
   * 解析个股分析部分
   */
  private parseStocks(
    raw: LLMOutput['stocks'],
  ): StockAnalysisResult[] {
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    return raw
      .filter((s) => s && (s.stock || s.code))
      .map((s) => ({
        stock: s.stock ?? s.code ?? '未知',
        code: s.code ?? '',
        position: s.position ?? '--',
        strength: s.strength ?? '--',
        volumeAnalysis: s.volumeAnalysis ?? '--',
        logic: s.logic ?? '--',
        risk: Array.isArray(s.risk) ? s.risk : ['未知风险'],
        buyPoint: s.buyPoint ?? '--',
      }));
  }

  /**
   * 解析结论部分
   */
  private parseConclusions(
    raw: LLMOutput['conclusions'],
    stockCodes?: string[],
  ): ConclusionResult[] {
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    const results: ConclusionResult[] = [];

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

    return results;
  }

  // ─── 规范化 ──────────────────────────────────────────

  /** 规范化环境评级 */
  private normalizeEnvLevel(value?: string): EnvLevel | null {
    if (!value) return null;
    const upper = value.toUpperCase().trim() as EnvLevel;
    return VALID_ENV_LEVELS.includes(upper) ? upper : null;
  }

  /** 规范化结论 */
  private normalizeVerdict(value?: string): Verdict | null {
    if (!value) return null;
    const upper = value.toUpperCase().trim() as Verdict;
    if (VALID_VERDICTS.includes(upper)) return upper;

    // 尝试模糊匹配
    if (upper.includes('BUY') || upper.includes('买')) return 'COND_BUY';
    if (upper.includes('WATCH') || upper.includes('观') || upper.includes('察')) return 'WATCH';
    if (upper.includes('NO') || upper.includes('不') || upper.includes('放弃')) return 'NO_BUY';

    return null;
  }

  /**
   * 规范化结论优先级
   * 确保：1) 连续无断档 2) BUY 最高优先级
   */
  private normalizePriorities(conclusions: ConclusionResult[]): void {
    // BUY 类的优先
    const prioritized = conclusions.sort((a, b) => {
      const aWeight = this.verdictWeight(a.verdict);
      const bWeight = this.verdictWeight(b.verdict);
      if (aWeight !== bWeight) return aWeight - bWeight;
      return (a.priority ?? 999) - (b.priority ?? 999);
    });

    // 重新编号
    prioritized.forEach((c, i) => {
      c.priority = i + 1;
    });
  }

  /** 结论类型权重（用于排序） */
  private verdictWeight(verdict: Verdict): number {
    switch (verdict) {
      case 'BUY': return 1;
      case 'COND_BUY': return 2;
      case 'WATCH': return 3;
      case 'NO_BUY': return 4;
    }
  }

  // ─── 清理 & 修复 ──────────────────────────────────

  /**
   * 清理 LLM 输出
   * - 去除 markdown 代码块标记: ```json ... ```
   * - 去除首尾空白
   * - 去除 BOM
   */
  private cleanLLMOutput(text: string): string {
    let cleaned = text.trim();

    // 去除 BOM
    if (cleaned.charCodeAt(0) === 0xFEFF) {
      cleaned = cleaned.slice(1);
    }

    // 去除 ```json ... ``` 包裹
    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    }

    // 去除 ``` 单独标记
    cleaned = cleaned.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '');

    return cleaned.trim();
  }

  /**
   * 尝试修复常见 JSON 错误
   * - 末尾多余的逗号
   * - 单引号代替双引号
   * - 缺少引号的键名
   * - 注释
   */
  private attemptJSONRepair(text: string): LLMOutput | null {
    let repaired = text;

    // 1. 移除注释 (// ... 和 /* ... */)
    repaired = repaired.replace(/\/\/.*$/gm, '');
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');

    // 2. 单引号 → 双引号（键名和字符串值）
    repaired = repaired.replace(/'/g, '"');

    // 3. 修复未加引号的键名（如 {key: "value"} → {"key": "value"}）
    // 匹配 { 或 , 后的字母数字键
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');

    // 4. 移除末尾多余的逗号（在 } 或 ] 前）
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    // 尝试解析修复后的文本
    try {
      return JSON.parse(repaired) as LLMOutput;
    } catch {
      return null;
    }
  }
}
