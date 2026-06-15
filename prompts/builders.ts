/**
 * Prompt 构建器
 * 构建完整的 System Prompt + User Prompt 用于各层分析
 *
 * 职责:
 *   1. 接收结构化数据 → 合成自然语言上下文 text
 *   2. 根据分析场景选择对应的 System Prompt 模板
 *   3. 组装最终 LLM 请求的 messages 数组
 *
 * @module prompts/builders
 */

import {
  buildFullSystemPrompt,
  buildEnvOnlyPrompt,
  buildSingleStockPrompt,
} from './system-prompt';
import type {
  MarketIndex,
  StockQuote,
  SectorData,
  HotTopic,
  SectorDetail,
} from '../utils/types';

// ═══════════════════════════════════════════════════════════════
// 上下文构建器 — 将结构化数据 → 自然语言描述
// ═══════════════════════════════════════════════════════════════

/**
 * 将大盘指数数据转为自然语言上下文
 */
export function formatMarketIndex(indices: MarketIndex[]): string {
  if (indices.length === 0) return '暂无大盘指数数据';

  return indices
    .map((idx) => {
      const direction = idx.changePercent >= 0 ? '📈' : '📉';
      return `${direction} ${idx.name}(${idx.code}): ${idx.price}点 ${idx.changePercent >= 0 ? '+' : ''}${idx.changePercent.toFixed(2)}% | 成交额 ${formatAmount(idx.amount)}`;
    })
    .join('\n');
}

/**
 * 将板块数据转为自然语言上下文
 */
export function formatSectors(sectors: SectorData[]): string {
  if (sectors.length === 0) return '暂无板块数据';

  const top5 = sectors.slice(0, 5);
  const lines = top5.map((s, i) => {
    const dir = s.changePercent >= 0 ? '📈' : '📉';
    return `  ${i + 1}. ${s.name}(${s.code}) ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}% | 领涨:${s.leadingStock}(${s.leadingChange >= 0 ? '+' : ''}${s.leadingChange.toFixed(2)}%) | 涨${s.upCount}/跌${s.downCount} | 资金流:${formatFundFlow(s.capitalFlow)}`;
  });

  return `【板块表现 Top ${top5.length}】\n${lines.join('\n')}`;
}

/**
 * 将热门题材转为自然语言上下文
 */
export function formatHotTopics(topics: HotTopic[]): string {
  if (topics.length === 0) return '暂无题材数据';

  const top5 = topics.slice(0, 5);
  const lines = top5.map((t, i) => {
    const dir = t.changePercent >= 0 ? '📈' : '📉';
    return `  ${i + 1}. ${t.name}(${t.code}) ${t.changePercent >= 0 ? '+' : ''}${t.changePercent.toFixed(2)}% | 领涨:${t.leadingStock} | 涨${t.upCount}/跌${t.downCount}`;
  });

  return `【热门题材 Top ${top5.length}】\n${lines.join('\n')}`;
}

/**
 * 将个股行情数据转为自然语言上下文
 */
export function formatStockQuotes(quotes: StockQuote[]): string {
  if (quotes.length === 0) return '暂无个股数据';

  return quotes
    .map((q) => {
      const dir = q.changePercent >= 0 ? '📈' : '📉';
      return `${dir} ${q.name}(${q.code}): ¥${q.price} ${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}% | 量:${(q.volume / 10000).toFixed(1)}万手 | 额:${formatAmount(q.turnover)} | 换手:${q.turnoverRate.toFixed(1)}% | 振幅:${q.amplitude.toFixed(1)}% | 高低:${q.high}/${q.low}`;
    })
    .join('\n');
}

/**
 * 将板块明细转为自然语言上下文
 */
export function formatSectorDetail(detail: SectorDetail): string {
  const { sector, stocks } = detail;
  const topStocks = stocks.slice(0, 5);

  const stockLines = topStocks.map(
    (s, i) =>
      `  ${i + 1}. ${s.name}(${s.code}): ¥${s.price} ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%`,
  );

  return [
    `板块: ${sector.name}(${sector.code}) | 涨幅:${sector.changePercent >= 0 ? '+' : ''}${sector.changePercent.toFixed(2)}% | 涨${sector.upCount}/跌${sector.downCount} | 资金流:${formatFundFlow(sector.capitalFlow)}`,
    `领涨: ${sector.leadingStock}(${sector.leadingStockCode}) ${sector.leadingChange >= 0 ? '+' : ''}${sector.leadingChange.toFixed(2)}%`,
    `成分股 Top ${topStocks.length}:`,
    ...stockLines,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════
// PromptBuilder
// ═══════════════════════════════════════════════════════════════

export class PromptBuilder {
  /**
   * 组装完整分析 Prompt（四层全量分析）
   *
   * @param data - 当前市场数据
   * @returns messages 数组，可直接传给 DeepSeekClient.chat()
   */
  buildAnalysisPrompt(data: {
    indices?: MarketIndex[];
    sectors?: SectorData[];
    topics?: HotTopic[];
    quotes?: StockQuote[];
    stocksToAnalyze?: { name: string; code: string }[];
  }): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    // ── 构建动态上下文 ──
    const contextParts: string[] = [];

    if (data.indices && data.indices.length > 0) {
      contextParts.push(formatMarketIndex(data.indices));
    }

    if (data.sectors && data.sectors.length > 0) {
      contextParts.push(formatSectors(data.sectors));
    }

    if (data.topics && data.topics.length > 0) {
      contextParts.push(formatHotTopics(data.topics));
    }

    if (data.quotes && data.quotes.length > 0) {
      contextParts.push(`【个股行情】\n${formatStockQuotes(data.quotes)}`);
    }

    const dynamicContext = contextParts.join('\n\n');

    // ── 构建股票列表 ──
    const stockListStr = data.stocksToAnalyze
      ? data.stocksToAnalyze.map((s) => `${s.name}(${s.code})`).join('、')
      : '';

    const selectedStocks = stockListStr
      ? `请分析以下股票：${stockListStr}`
      : undefined;

    // ── 构建 System Prompt ──
    const systemPrompt = buildFullSystemPrompt({
      dynamicContext: dynamicContext || undefined,
      selectedStocks,
    });

    // ── 构建 User Prompt ──
    const userPrompt = this.buildUserAnalysisPrompt(
      data.stocksToAnalyze ?? [],
      data.indices?.length ? '已有市场数据' : '无市场数据',
    );

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * 构建环境诊断 Prompt（仅 L1 层面）
   */
  buildEnvCheckPrompt(data: {
    indices?: MarketIndex[];
    sectors?: SectorData[];
    topics?: HotTopic[];
  }): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const contextParts: string[] = [];

    if (data.indices && data.indices.length > 0) {
      contextParts.push(formatMarketIndex(data.indices));
    }

    if (data.sectors && data.sectors.length > 0) {
      contextParts.push(formatSectors(data.sectors));
    }

    if (data.topics && data.topics.length > 0) {
      contextParts.push(formatHotTopics(data.topics));
    }

    const dynamicContext = contextParts.join('\n\n');
    const systemPrompt = buildEnvOnlyPrompt({
      dynamicContext: dynamicContext || undefined,
    });

    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          '请基于以上市场数据分析当前市场环境，输出环境评级、情绪描述和仓位建议。',
      },
    ];
  }

  /**
   * 构建单票快速分析 Prompt
   */
  buildSingleStockPrompt(data: {
    quote: StockQuote;
    indices?: MarketIndex[];
    sectors?: SectorData[];
  }): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const contextParts: string[] = [];

    if (data.indices && data.indices.length > 0) {
      contextParts.push(formatMarketIndex(data.indices));
    }

    if (data.sectors && data.sectors.length > 0) {
      contextParts.push(formatSectors(data.sectors));
    }

    contextParts.push(
      `【目标个股】\n${formatStockQuotes([data.quote])}`,
    );

    const dynamicContext = contextParts.join('\n\n');
    const systemPrompt = buildSingleStockPrompt({
      dynamicContext,
    });

    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请详细分析 ${data.quote.name}(${data.quote.code})，输出完整的五维评估和交易结论。`,
      },
    ];
  }

  /**
   * 内部：构建 User Prompt（分析指令部分）
   */
  private buildUserAnalysisPrompt(
    stocksToAnalyze: { name: string; code: string }[],
    marketDataStatus: string,
  ): string {
    const stockLines = stocksToAnalyze.map(
      (s, i) => `  ${i + 1}. ${s.name}(${s.code})`,
    );

    if (stocksToAnalyze.length === 0) {
      return '请分析当前市场环境，并给出交易建议。';
    }

    return [
      `请严格按照四层分析框架，分析以下股票池中的 ${stocksToAnalyze.length} 只股票：`,
      '',
      stockLines.join('\n'),
      '',
      `市场数据状态: ${marketDataStatus}`,
      '',
      '要求:',
      '- 先分析市场环境 (L1)',
      '- 再判断主线方向 (L2)',
      '- 再逐只个股五维评估 (L3)',
      '- 最后输出四类结论并排序 (L4)',
    ].join('\n');
  }

  // ─── 工具方法 ──────────────────────────────────────

  /**
   * 组合多段 context 文本
   */
  static joinContext(...parts: (string | undefined | null)[]): string {
    return parts.filter(Boolean).join('\n\n');
  }

  /**
   * 从用户输入文本中提取股票代码
   * 支持格式: "600519"、"贵州茅台"、"600519贵州茅台"、"600519,000858"
   */
  static extractStocks(input: string): string[] {
    // 匹配 6 位数字代码
    const codePattern = /\b\d{6}\b/g;
    const codes = input.match(codePattern);

    if (codes) {
      return [...new Set(codes)];
    }

    // 如果没有数字代码，返回空（调用方可以按名称搜索）
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 格式化金额（元 → 亿/万）
 */
function formatAmount(yuan: number): string {
  if (yuan >= 1_0000_0000) {
    return `${(yuan / 1_0000_0000).toFixed(1)}亿`;
  }
  if (yuan >= 1_0000) {
    return `${(yuan / 1_0000).toFixed(1)}万`;
  }
  return `${yuan.toFixed(0)}元`;
}

/**
 * 格式化资金流向
 */
function formatFundFlow(wanYuan: number): string {
  const abs = Math.abs(wanYuan);
  const prefix = wanYuan >= 0 ? '+' : '-';
  if (abs >= 1_0000) {
    return `${prefix}${(abs / 1_0000).toFixed(2)}亿`;
  }
  return `${prefix}${abs.toFixed(0)}万`;
}
