/**
 * xvqiu 分析引擎主入口
 * AnalysisEngine Orchestrator — 四层过滤编排
 *
 * 编排流程:
 *   1. 接收分析请求（股票列表）
 *   2. 并行获取数据（指数、板块、个股行情）
 *   3. L1 → 运行市场环境分析 (纯数据驱动)
 *   4. L2 → 运行方向分析 (纯数据驱动)
 *   5. L3 → 运行个股分析 (纯数据驱动)
 *   6. 构建 LLM Prompt (PromptBuilder)
 *   7. 调用 DeepSeek API
 *   8. L4 → 解析结论并后处理
 *   9. 返回 AnalysisResult
 *
 * @module engine
 */

export { L1MarketAnalyzer } from './l1-market';
export { L2DirectionAnalyzer } from './l2-direction';
export { L3StockAnalyzer } from './l3-stock';
export { L4ConclusionEngine, L4ParseError } from './l4-conclusion';

import { L1MarketAnalyzer } from './l1-market';
import { L2DirectionAnalyzer } from './l2-direction';
import { L3StockAnalyzer } from './l3-stock';
import { L4ConclusionEngine } from './l4-conclusion';

import { PromptBuilder } from '../prompts/builders';
import { DeepSeekClient } from '../llm/client';
import { ThsAdapter } from '../data/ths';
import { ClsAdapter } from '../data/cls';
import { CacheManager, cacheManager } from '../data/cache';

import type {
  AnalysisResult,
  MarketIndex,
  StockQuote,
  SectorData,
  HotTopic,
  SectorDetail,
  MarketEnvResult,
  DirectionResult,
  StockAnalysisResult,
  EnvLevel,
  SentimentData,
} from '../utils/types';

import type { StreamCallbacks, StreamResult } from '../llm/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 分析引擎配置
// ═══════════════════════════════════════════════════════════════

export interface AnalysisConfig {
  /** 最大并发分析股票数 */
  maxConcurrent: number;
  /** 是否启用本地预处理（L1/L2/L3 纯数据） */
  enableLocalPreAnalysis: boolean;
  /** 是否使用缓存 */
  useCache: boolean;
  /** DeepSeek 模型 */
  model: string;
  /** 温度 */
  temperature: number;
  /** 最大 tokens */
  maxTokens: number;
}

const DEFAULT_CONFIG: AnalysisConfig = {
  maxConcurrent: 10,
  enableLocalPreAnalysis: true,
  useCache: true,
  model: 'deepseek-chat',
  temperature: 0.7,
  maxTokens: 4096,
};

// ═══════════════════════════════════════════════════════════════
// 引擎选项
// ═══════════════════════════════════════════════════════════════

export interface AnalyzePoolOptions {
  /** 股票代码列表 */
  stocks: string[];
  /** 是否强制刷新数据（跳过缓存） */
  forceRefresh?: boolean;
  /** 流式回调（可选） */
  streamCallbacks?: StreamCallbacks;
  /** AbortSignal */
  signal?: AbortSignal;
}

export interface EnvCheckOptions {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export interface SingleStockOptions {
  code: string;
  forceRefresh?: boolean;
  streamCallbacks?: StreamCallbacks;
  signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════
// 引擎编排
// ═══════════════════════════════════════════════════════════════

export class AnalysisEngine {
  private config: AnalysisConfig;
  private marketAnalyzer: L1MarketAnalyzer;
  private directionAnalyzer: L2DirectionAnalyzer;
  private stockAnalyzer: L3StockAnalyzer;
  private conclusionEngine: L4ConclusionEngine;
  private promptBuilder: PromptBuilder;
  private dataSource: ThsAdapter;
  private clsAdapter: ClsAdapter;
  private llmClient: DeepSeekClient;
  private cache: CacheManager;

  constructor(
    config?: Partial<AnalysisConfig>,
    deps?: {
      marketAnalyzer?: L1MarketAnalyzer;
      directionAnalyzer?: L2DirectionAnalyzer;
      stockAnalyzer?: L3StockAnalyzer;
      conclusionEngine?: L4ConclusionEngine;
      promptBuilder?: PromptBuilder;
      dataSource?: ThsAdapter;
      clsAdapter?: ClsAdapter;
      llmClient?: DeepSeekClient;
      cache?: CacheManager;
    },
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.marketAnalyzer = deps?.marketAnalyzer ?? new L1MarketAnalyzer();
    this.directionAnalyzer = deps?.directionAnalyzer ?? new L2DirectionAnalyzer();
    this.stockAnalyzer = deps?.stockAnalyzer ?? new L3StockAnalyzer();
    this.conclusionEngine = deps?.conclusionEngine ?? new L4ConclusionEngine();
    this.promptBuilder = deps?.promptBuilder ?? new PromptBuilder();
    this.dataSource = deps?.dataSource ?? new ThsAdapter();
    this.clsAdapter = deps?.clsAdapter ?? new ClsAdapter();
    this.llmClient = deps?.llmClient ?? new DeepSeekClient();
    this.cache = deps?.cache ?? cacheManager;
  }

  // ═════════════════════════════════════════════════════════════
  // 入口方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 股票池批量分析（完整四层）
   *
   * 流程:
   *   1. 获取市场数据
   *   2. L1 → 市场环境
   *   3. L2 → 方向判断
   *   4. L3 → 个股分析
   *   5. 构建 Prompt → 调用 DeepSeek
   *   6. L4 → 解析结论
   *
   * @param options - 分析参数
   * @returns 完整分析结果
   */
  async analyzePool(options: AnalyzePoolOptions): Promise<AnalysisResult> {
    const { stocks, forceRefresh, streamCallbacks, signal } = options;

    if (!stocks || stocks.length === 0) {
      throw new Error('股票列表为空');
    }

    if (stocks.length > 50) {
      throw new Error('单次分析最多支持 50 只股票');
    }

    logger.info(`[Engine] 开始分析股票池: ${stocks.length} 只`, stocks);

    // ═══ Step 1: 获取市场数据（并行） ═══
    const marketData = await this.fetchMarketData(forceRefresh);
    signal?.throwIfAborted();

    // ═══ Step 2: L1 — 市场环境（含舆情情绪评分） ═══
    const envResult = await this.runL1(
      marketData.indices,
      marketData.sectors,
      marketData.sentiment,
    );
    signal?.throwIfAborted();

    // ═══ Step 3: L2 — 方向判断 ═══
    const directions = await this.runL2(marketData.sectors, marketData.topics);
    signal?.throwIfAborted();

    // ═══ Step 4: L3 — 个股分析 ═══
    const stockAnalyses = await this.runL3(
      stocks,
      marketData.indices,
      marketData.sectors,
    );
    signal?.throwIfAborted();

    // ═══ Step 5: 构建 Prompt → 调用 LLM ═══
    const llmResult = await this.callLLM(
      {
        indices: marketData.indices,
        sectors: marketData.sectors,
        topics: marketData.topics,
        quotes: marketData.quotes,
        stocksToAnalyze: stocks.map((c) => ({
          code: c,
          name: this.findStockName(c, marketData.quotes),
        })),
        envResult,
        directions,
        stockAnalyses,
      },
      { streamCallbacks, signal },
    );

    // ═══ Step 6: L4 — 解析结论 ═══
    const result = await this.runL4(llmResult, {
      envLevel: envResult.envLevel,
      stockCodes: stocks,
    });

    logger.info('[Engine] 分析完成:', {
      stocks: stocks.length,
      envLevel: result.marketEnv.envLevel,
      conclusions: result.conclusions.length,
      buyCount: result.conclusions.filter((c) => c.verdict === 'BUY').length,
    });

    return result;
  }

  /**
   * 环境诊断（仅 L1）
   *
   * 快速获取市场环境评级，不分析个股
   */
  async envCheck(options?: EnvCheckOptions): Promise<MarketEnvResult & {
    indices: MarketIndex[];
    sectors: SectorData[];
    topics: HotTopic[];
    sentiment: SentimentData | null;
  }> {
    logger.info('[Engine] 环境诊断');

    const marketData = await this.fetchMarketData(options?.forceRefresh);
    options?.signal?.throwIfAborted();

    const envResult = await this.runL1(
      marketData.indices,
      marketData.sectors,
      marketData.sentiment,
    );

    return {
      ...envResult,
      indices: marketData.indices,
      sectors: marketData.sectors,
      topics: marketData.topics,
      sentiment: marketData.sentiment,
    };
  }

  /**
   * 单只股票快速分析
   *
   * 流程:
   *   1. 获取市场数据 + 目标个股行情
   *   2. L1 → 环境判断
   *   3. L2 → 方向判断
   *   4. 构建单票 Prompt → LLM
   *   5. L4 → 解析结论
   */
  async analyzeSingle(options: SingleStockOptions): Promise<AnalysisResult> {
    const { code, forceRefresh, streamCallbacks, signal } = options;

    if (!code) {
      throw new Error('请提供股票代码');
    }

    logger.info(`[Engine] 单票分析: ${code}`);

    // 获取数据
    const [marketData, quote] = await Promise.all([
      this.fetchMarketData(forceRefresh),
      this.dataSource.getQuote(code),
    ]);
    signal?.throwIfAborted();

    // L1 + L2
    const [envResult, directions] = await Promise.all([
      this.runL1(marketData.indices, marketData.sectors, marketData.sentiment),
      this.runL2(marketData.sectors, marketData.topics),
    ]);
    signal?.throwIfAborted();

    // 构建单票 Prompt
    const messages = this.promptBuilder.buildSingleStockPrompt({
      quote,
      indices: marketData.indices,
      sectors: marketData.sectors,
    });

    // 调用 LLM
    let llmOutput: string;
    if (streamCallbacks) {
      const streamResult = await this.llmClient.chatStream(
        messages,
        streamCallbacks,
        { signal },
      );
      llmOutput = streamResult.fullContent;
    } else {
      const response = await this.llmClient.chat(messages, { signal });
      llmOutput = response.choices?.[0]?.message?.content ?? '';
    }

    // 解析结论
    const result = await this.runL4(llmOutput, {
      envLevel: envResult.envLevel,
      stockCodes: [code],
    });

    logger.info(`[Engine] 单票分析完成: ${quote.name}(${code})`);
    return result;
  }

  // ═════════════════════════════════════════════════════════════
  // 数据获取
  // ═════════════════════════════════════════════════════════════

  /**
   * 获取所有市场数据（并行）
   */
  private async fetchMarketData(forceRefresh?: boolean): Promise<{
    indices: MarketIndex[];
    sectors: SectorData[];
    topics: HotTopic[];
    quotes: StockQuote[];
    sentiment: SentimentData | null;
  }> {
    const cacheOpts = forceRefresh ? { useCache: false } : { useCache: this.config.useCache };

    const [indices, sectors, topics, sentiment] = await Promise.all([
      this.dataSource.getMarketIndex(cacheOpts),
      this.dataSource.getSectors(cacheOpts),
      this.dataSource.getHotTopics(cacheOpts),
      this.clsAdapter.getSentiment(cacheOpts).catch((err) => {
        logger.warn('[Engine] CLS 情绪数据获取失败，跳过:', (err as Error).message);
        return null;
      }),
    ]);

    return {
      indices,
      sectors,
      topics,
      sentiment,
      quotes: [], // 个股行情在 L3 阶段按需获取
    };
  }

  /**
   * 获取个股行情（缓存）
   */
  private async fetchQuotes(
    codes: string[],
    forceRefresh?: boolean,
  ): Promise<StockQuote[]> {
    const cacheOpts = forceRefresh ? { useCache: false } : { useCache: this.config.useCache };

    if (codes.length <= 50) {
      return await this.dataSource.getQuotes(codes, cacheOpts);
    }

    // 超过 50 只分批次
    const results: StockQuote[] = [];
    for (let i = 0; i < codes.length; i += 50) {
      const batch = codes.slice(i, i + 50);
      const batchResults = await this.dataSource.getQuotes(batch, cacheOpts);
      results.push(...batchResults);
    }
    return results;
  }

  // ═════════════════════════════════════════════════════════════
  // 引擎层执行
  // ═════════════════════════════════════════════════════════════

  /** L1: 市场环境（含舆情情绪） */
  private async runL1(
    indices: MarketIndex[],
    sectors: SectorData[],
    sentiment?: SentimentData | null,
  ): Promise<MarketEnvResult> {
    return this.marketAnalyzer.analyze(indices, sectors, sentiment ?? undefined);
  }

  /** L2: 方向判断 */
  private async runL2(
    sectors: SectorData[],
    topics: HotTopic[],
  ): Promise<DirectionResult[]> {
    return this.directionAnalyzer.analyze(sectors, topics);
  }

  /** L3: 个股分析 */
  private async runL3(
    stockCodes: string[],
    indices: MarketIndex[],
    sectors: SectorData[],
  ): Promise<StockAnalysisResult[]> {
    // 获取个股行情
    const quotes = await this.fetchQuotes(stockCodes);

    if (quotes.length === 0) {
      logger.warn('[Engine] 无法获取个股行情');
      return [];
    }

    // 并行限制
    const maxBatch = this.config.maxConcurrent;
    const results: StockAnalysisResult[] = [];

    for (let i = 0; i < quotes.length; i += maxBatch) {
      const batch = quotes.slice(i, i + maxBatch);
      const batchResults = await this.stockAnalyzer.analyze(batch, indices, sectors);
      results.push(...batchResults);
    }

    return results;
  }

  /** L4: 结论解析 */
  private async runL4(
    llmOutput: string,
    fallback?: { envLevel?: EnvLevel; stockCodes?: string[] },
  ): Promise<AnalysisResult> {
    return this.conclusionEngine.process(llmOutput, fallback);
  }

  // ═════════════════════════════════════════════════════════════
  // LLM 调用
  // ═════════════════════════════════════════════════════════════

  /**
   * 构建 Prompt 并调用 LLM
   */
  private async callLLM(
    data: {
      indices: MarketIndex[];
      sectors: SectorData[];
      topics: HotTopic[];
      quotes: StockQuote[];
      stocksToAnalyze: { code: string; name: string }[];
      envResult: MarketEnvResult;
      directions: DirectionResult[];
      stockAnalyses: StockAnalysisResult[];
    },
    options?: {
      streamCallbacks?: StreamCallbacks;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    // ── 构建 System + User Prompt ──
    const messages = this.promptBuilder.buildAnalysisPrompt({
      indices: data.indices,
      sectors: data.sectors,
      topics: data.topics,
      quotes: data.quotes,
      stocksToAnalyze: data.stocksToAnalyze,
    });

    // ── 追加本地预处理结果作为上下文 ──
    if (this.config.enableLocalPreAnalysis) {
      const localContext = this.buildLocalAnalysisContext(
        data.envResult,
        data.directions,
        data.stockAnalyses,
      );
      // 追加到最后一条 user message
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content += `\n\n【本地预处理结果（仅供参考）】\n${localContext}\n\n请基于以上信息进行完整四层分析，并输出最终 JSON 结论。`;
      }
    }

    // ── 调用 LLM ──
    let llmOutput: string;

    const signal = options?.signal;

    if (options?.streamCallbacks) {
      // 流式调用
      const streamResult = await this.llmClient.chatStream(
        messages,
        options.streamCallbacks,
        { signal },
      );
      llmOutput = streamResult.fullContent;
    } else {
      // 非流式调用
      const response = await this.llmClient.chat(messages, {
        signal,
      });
      llmOutput = response.choices?.[0]?.message?.content ?? '';
    }

    return llmOutput;
  }

  /**
   * 构建设本地预处理分析上下文
   * 将 L1/L2/L3 的分析结果转为自然语言，注入 LLM prompt
   */
  private buildLocalAnalysisContext(
    envResult: MarketEnvResult,
    directions: DirectionResult[],
    stockAnalyses: StockAnalysisResult[],
  ): string {
    const parts: string[] = [];

    // L1 结果
    parts.push(
      `[L1 市场环境] 评级: ${envResult.envLevel} | 情绪: ${envResult.sentiment} | 建议: ${envResult.suggestion}`,
    );

    // L2 结果
    if (directions.length > 0) {
      const dirLines = directions.map(
        (d, i) => `  ${i + 1}. 主线: ${d.mainLine} | 次线: ${d.subLine}`,
      );
      parts.push(`[L2 方向判断]\n${dirLines.join('\n')}`);
    }

    // L3 结果
    if (stockAnalyses.length > 0) {
      const stockLines = stockAnalyses.map(
        (s) =>
          `  ${s.stock}(${s.code}): 位置=${s.position} | 强度=${s.strength} | 量价=${s.volumeAnalysis}`,
      );
      parts.push(`[L3 个股技术面]\n${stockLines.join('\n')}`);
    }

    return parts.join('\n\n');
  }

  // ═════════════════════════════════════════════════════════════
  // 辅助方法
  // ═════════════════════════════════════════════════════════════

  /** 从行情列表中查找股票名称 */
  private findStockName(code: string, quotes: StockQuote[]): string {
    const quote = quotes.find((q) => q.code === code);
    return quote?.name ?? code;
  }

  /**
   * 更新引擎配置
   */
  setConfig(partial: Partial<AnalysisConfig>): void {
    this.config = { ...this.config, ...partial };

    // 同步到 LLM 客户端
    this.llmClient.setConfig({
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<AnalysisConfig> {
    return { ...this.config };
  }
}

// ─── 单例 ──────────────────────────────────────────────

/** 全局单例分析引擎 */
export const analysisEngine = new AnalysisEngine();
