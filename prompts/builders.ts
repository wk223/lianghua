/**
 * Prompt 构建器 — 增强版
 *
 * 对齐 xvqiu-requirements.md 全部字段
 * 支持增强的数据格式化 + 完整分析/环境诊断/单票/比较模式
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
// 上下文构建器
// ═══════════════════════════════════════════════════════════════

export function formatMarketIndex(indices: MarketIndex[]): string {
  if (indices.length === 0) return '暂无大盘指数数据';
  return indices
    .map((idx) => {
      const direction = idx.changePercent >= 0 ? '📈' : '📉';
      return `${direction} ${idx.name}(${idx.code}): ${idx.price}点 ${idx.changePercent >= 0 ? '+' : ''}${idx.changePercent.toFixed(2)}% | 成交额 ${formatAmount(idx.amount)}`;
    })
    .join('\n');
}

export function formatSectors(sectors: SectorData[]): string {
  if (sectors.length === 0) return '暂无板块数据';
  const top8 = sectors.slice(0, 8);
  const lines = top8.map((s, i) => {
    const dir = s.changePercent >= 0 ? '📈' : '📉';
    return `  ${i + 1}. ${s.name}(${s.code}) ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}% | 领涨:${s.leadingStock}(${s.leadingChange >= 0 ? '+' : ''}${s.leadingChange.toFixed(2)}%) | 涨${s.upCount}/跌${s.downCount} | 资金流:${formatFundFlow(s.capitalFlow)}`;
  });
  return `【板块表现 Top ${top8.length}】\n${lines.join('\n')}`;
}

export function formatHotTopics(topics: HotTopic[]): string {
  if (topics.length === 0) return '暂无题材数据';
  const top8 = topics.slice(0, 8);
  const lines = top8.map((t, i) => {
    const dir = t.changePercent >= 0 ? '📈' : '📉';
    return `  ${i + 1}. ${t.name}(${t.code}) ${t.changePercent >= 0 ? '+' : ''}${t.changePercent.toFixed(2)}% | 领涨:${t.leadingStock} | 涨${t.upCount}/跌${t.downCount}`;
  });
  return `【热门题材 Top ${top8.length}】\n${lines.join('\n')}`;
}

export function formatStockQuotes(quotes: StockQuote[]): string {
  if (quotes.length === 0) return '暂无个股数据';
  return quotes
    .map((q) => {
      const dir = q.changePercent >= 0 ? '📈' : '📉';
      return `${dir} ${q.name}(${q.code}): ¥${q.price} ${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}% | 量:${(q.volume / 10000).toFixed(1)}万手 | 额:${formatAmount(q.turnover)} | 换手:${q.turnoverRate.toFixed(1)}% | 振幅:${q.amplitude.toFixed(1)}% | 高低:${q.high}/${q.low}`;
    })
    .join('\n');
}

export function formatSectorDetail(detail: SectorDetail): string {
  const { sector, stocks } = detail;
  const topStocks = stocks.slice(0, 5);
  const stockLines = topStocks.map(
    (s, i) => `  ${i + 1}. ${s.name}(${s.code}): ¥${s.price} ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%`,
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
   */
  buildAnalysisPrompt(data: {
    indices?: MarketIndex[];
    sectors?: SectorData[];
    topics?: HotTopic[];
    quotes?: StockQuote[];
    stocksToAnalyze?: { name: string; code: string }[];
    /** 二选一/三选一比较模式的输入 */
    compareMode?: boolean;
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
    if (data.quotes && data.quotes.length > 0) {
      contextParts.push(`【个股行情】\n${formatStockQuotes(data.quotes)}`);
    }

    const dynamicContext = contextParts.join('\n\n');

    const stockListStr = data.stocksToAnalyze
      ? data.stocksToAnalyze.map((s) => `${s.name}(${s.code})`).join('、')
      : '';

    const selectedStocks = stockListStr
      ? `请分析以下股票：${stockListStr}`
      : undefined;

    const systemPrompt = buildFullSystemPrompt({
      dynamicContext: dynamicContext || undefined,
      selectedStocks,
    });

    const userPrompt = this.buildUserAnalysisPrompt(
      data.stocksToAnalyze ?? [],
      data.indices?.length ? '已有市场数据' : '无市场数据',
      data.compareMode ?? false,
    );

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * 构建环境诊断 Prompt（增强版 — 含今天能不能做）
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
        content: '请基于以上市场数据做环境诊断。必须回答：今天整体值不值得做？适合进攻还是防守？仓位建议？哪些方向有确定性？什么类型最好别碰？',
      },
    ];
  }

  /**
   * 构建单票 Prompt（8项必答）
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
    contextParts.push(`【目标个股】\n${formatStockQuotes([data.quote])}`);

    const dynamicContext = contextParts.join('\n\n');
    const systemPrompt = buildSingleStockPrompt({ dynamicContext });

    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请按8项必答要求详细分析 ${data.quote.name}(${data.quote.code})，输出完整分析。`,
      },
    ];
  }

  /**
   * 构建比较模式 Prompt（二选一/三选一）
   */
  buildComparePrompt(data: {
    quotes: StockQuote[];
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
    contextParts.push(`【待比较个股】\n${formatStockQuotes(data.quotes)}`);

    const dynamicContext = contextParts.join('\n\n');

    const stocksList = data.quotes.map((q) => `${q.name}(${q.code})`).join('、');

    const systemPrompt = buildFullSystemPrompt({
      dynamicContext,
      selectedStocks: `请比较以下 ${data.quotes.length} 只股票：${stocksList}`,
    });

    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请对以下 ${data.quotes.length} 只股票进行强制比较并排序：${stocksList}。要求：
1. 必须分出胜负，决出最优先的那只
2. 每个股票按 Section 5 结构逐只分析
3. 输出 compareResult 说明谁更优先、为什么更优先、另一个为什么不如它
4. 哪个更符合我的短线模式
5. 哪个当前买点更合理`,
      },
    ];
  }

  // ─── 内部方法 ──────────────────────────────────────

  private buildUserAnalysisPrompt(
    stocksToAnalyze: { name: string; code: string }[],
    marketDataStatus: string,
    compareMode: boolean,
  ): string {
    if (stocksToAnalyze.length === 0) {
      return '请分析当前市场环境，并给出交易建议。';
    }

    const stockLines = stocksToAnalyze.map(
      (s, i) => `  ${i + 1}. ${s.name}(${s.code})`,
    );

    const modeInstruction = compareMode
      ? '这是比较模式，请对全部股票做排序并输出 compareResult。'
      : '';

    return [
      `请严格按照交易逻辑框架，分析以下股票池中的 ${stocksToAnalyze.length} 只股票：`,
      '',
      stockLines.join('\n'),
      '',
      `市场数据状态: ${marketDataStatus}`,
      '',
      '要求:',
      '- 先分析市场环境 (L1) — 必须含 todayAction/avoidType/certainDirections',
      '- 再判断主线方向 (L2) — 必须含 logicStrength/suitablePlay',
      '- 再逐只个股分析 (L3) — 必须按Section 5完整9项',
      '- 最后输出结论并排序',
      modeInstruction,
    ].filter(Boolean).join('\n');
  }

  /**
   * 从用户输入文本中提取股票代码
   */
  static extractStocks(input: string): string[] {
    const codePattern = /\b\d{6}\b/g;
    const codes = input.match(codePattern);
    if (codes) {
      return [...new Set(codes)];
    }
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function formatAmount(yuan: number): string {
  if (yuan >= 1_0000_0000) {
    return `${(yuan / 1_0000_0000).toFixed(1)}亿`;
  }
  if (yuan >= 1_0000) {
    return `${(yuan / 1_0000).toFixed(1)}万`;
  }
  return `${yuan.toFixed(0)}元`;
}

function formatFundFlow(wanYuan: number): string {
  const abs = Math.abs(wanYuan);
  const prefix = wanYuan >= 0 ? '+' : '-';
  if (abs >= 1_0000) {
    return `${prefix}${(abs / 1_0000).toFixed(2)}亿`;
  }
  return `${prefix}${abs.toFixed(0)}万`;
}
