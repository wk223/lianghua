/**
 * xvqiu 公共类型定义
 */

// ─── 消息通信 ──────────────────────────────────────────

/** 表示一条从 UI 发往 Service Worker 的消息 */
export interface ChromeMessage<T = any> {
  type: MessageType;
  payload?: T;
  requestId?: string;
}

/** Service Worker 返回给 UI 的响应 */
export interface ChromeResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  requestId?: string;
}

/** 消息类型枚举 */
export type MessageType =
  | 'PING'
  | 'ANALYZE_POOL'
  | 'ANALYZE_POOL_STREAM'   // 流式股票池分析
  | 'ANALYZE_SINGLE'
  | 'ANALYZE_SINGLE_STREAM' // 流式单票分析
  | 'ENV_CHECK'
  | 'COMPARE'
  | 'GET_QUOTE'
  | 'GET_MARKET'
  | 'GET_SECTOR'
  | 'ANALYSIS_RESULT';

/** 流式事件类型（通过 Port 推送） */
export type StreamEventType =
  | 'stream:chunk'       // LLM 输出片段
  | 'stream:progress'    // 进度更新（如"L1分析完成"）
  | 'stream:done'        // 分析完成
  | 'stream:error'       // 分析错误
  | 'stream:env-level'   // L1 环境评级结果
  | 'stream:directions'  // L2 方向结果
  | 'stream:conclusion'  // 单只股票结论
  | 'stream:abort';      // 中止信号

/** 流式事件负载 */
export interface StreamEvent {
  event: StreamEventType;
  data?: unknown;
  requestId?: string;
}

/** 流式进度更新数据类型 */
export interface StreamProgress {
  stage: string;         // 'fetching' | 'l1' | 'l2' | 'l3' | 'llm' | 'l4'
  message: string;
  percent: number;       // 0-100
}

/** 流式结论增量数据 */
export interface StreamConclusionData {
  stockCode: string;
  stockName: string;
  verdict: Verdict;
  reason: string;
  riskPoints: string[];
  priority: number;
}

// ─── 股票/市场数据 ────────────────────────────────────

/** 大盘指数快照 */
export interface MarketIndex {
  code: string;       // 指数代码，如 000001（上证）
  name: string;       // 指数名称
  price: number;      // 当前点位
  change: number;     // 涨跌额
  changePercent: number; // 涨跌幅 %
  volume: number;     // 成交量（手）
  amount: number;     // 成交额（元）
}

/** 个股行情快照 */
export interface StockQuote {
  code: string;       // 股票代码
  name: string;       // 股票名称
  price: number;      // 当前价格
  change: number;     // 涨跌额
  changePercent: number; // 涨跌幅 %
  volume: number;     // 成交量（手）
  turnover: number;   // 成交额（元）
  high: number;       // 最高价
  low: number;        // 最低价
  open: number;       // 开盘价
  amplitude: number;  // 振幅 %
  turnoverRate: number; // 换手率 %
}

/** 板块行情数据 */
export interface SectorData {
  code: string;            // 板块代码 (BKxxxx)
  name: string;            // 板块名称
  changePercent: number;   // 涨跌幅 %
  change: number;          // 涨跌额
  indexValue: number;      // 板块指数值
  leadingStock: string;    // 领涨股名称
  leadingStockCode: string;// 领涨股代码
  leadingChange: number;   // 领涨股涨幅 %
  upCount: number;         // 上涨家数
  downCount: number;       // 下跌家数
  capitalFlow: number;     // 资金净流入（万元）
}

/** 板块成分股 */
export interface SectorStock {
  code: string;            // 股票代码
  name: string;            // 股票名称
  price: number;           // 最新价
  changePercent: number;   // 涨跌幅 %
  change: number;          // 涨跌额
  volume: number;          // 成交量（手）
  turnover: number;        // 成交额（元）
}

/** 板块详情（含成分股列表） */
export interface SectorDetail {
  sector: SectorData;
  stocks: SectorStock[];
}

/** 热门题材/概念 */
export interface HotTopic {
  code: string;            // 概念代码 (BKxxxx)
  name: string;            // 概念名称
  changePercent: number;   // 涨跌幅 %
  change: number;          // 涨跌额
  leadingStock: string;    // 领涨股名称
  leadingStockCode: string;// 领涨股代码
  leadingChange: number;   // 领涨股涨幅 %
  upCount: number;         // 上涨家数
  downCount: number;       // 下跌家数
  capitalFlow: number;     // 资金净流入（万元）
}

// ─── 分析引擎 ──────────────────────────────────────────

/** 市场环境级别 */
export type EnvLevel = 'S' | 'A' | 'B' | 'C' | 'D';

/** L1 市场环境输出 */
export interface MarketEnvResult {
  envLevel: EnvLevel;
  sentiment: string;
  suggestion: string;
}

/** L2 方向判断输出 */
export interface DirectionResult {
  mainLine: string;
  subLine: string;
  recommendations: string[];
}

/** L3 个股分析输出 */
export interface StockAnalysisResult {
  stock: string;
  code: string;
  position: string;
  strength: string;
  volumeAnalysis: string;
  logic: string;
  risk: string[];
  buyPoint: string;
}

/** 四类结论 */
export type Verdict = 'BUY' | 'COND_BUY' | 'WATCH' | 'NO_BUY';

/** L4 结论输出 */
export interface ConclusionResult {
  /** 股票代码 */
  stockCode: string;
  /** 股票名称 */
  stockName: string;
  verdict: Verdict;
  reason: string;
  riskPoints: string[];
  priority: number;
}

/** 完整分析结果 */
export interface AnalysisResult {
  marketEnv: MarketEnvResult;
  directions: DirectionResult[];
  stocks: StockAnalysisResult[];
  conclusions: ConclusionResult[];
  timestamp: number;
}
