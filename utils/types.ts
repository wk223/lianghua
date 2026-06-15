/**
 * xvqiu 公共类型定义 — 增强版
 *
 * 对齐 xvqiu-requirements.md Section 5 全部字段
 * 增加：方向归属、逻辑强度、个股地位、当前位置、买点判断、风险点、操作结论
 * 增加：比较模式、环境诊断增强字段
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
  | 'ANALYZE_POOL_STREAM'
  | 'ANALYZE_SINGLE'
  | 'ANALYZE_SINGLE_STREAM'
  | 'ENV_CHECK'
  | 'COMPARE'
  | 'GET_QUOTE'
  | 'GET_MARKET'
  | 'GET_SECTOR'
  | 'ANALYSIS_RESULT'
  | 'OPEN_SIDE_PANEL'
  | 'CONTENT_SCRIPT_PING'
  | 'CONTENT_SCRIPT_REFRESH'
  | 'CONTENT_SCRIPT_REMOVE';

/** 流式事件类型（通过 Port 推送） */
export type StreamEventType =
  | 'stream:chunk'
  | 'stream:progress'
  | 'stream:done'
  | 'stream:error'
  | 'stream:env-level'
  | 'stream:directions'
  | 'stream:conclusion'
  | 'stream:abort';

/** 流式事件负载 */
export interface StreamEvent {
  event: StreamEventType;
  data?: unknown;
  requestId?: string;
}

/** 流式进度更新数据类型 */
export interface StreamProgress {
  stage: string;
  message: string;
  percent: number;
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
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
}

/** 个股行情快照 */
export interface StockQuote {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  turnover: number;
  high: number;
  low: number;
  open: number;
  amplitude: number;
  turnoverRate: number;
}

/** 板块行情数据 */
export interface SectorData {
  code: string;
  name: string;
  changePercent: number;
  change: number;
  indexValue: number;
  leadingStock: string;
  leadingStockCode: string;
  leadingChange: number;
  upCount: number;
  downCount: number;
  capitalFlow: number;
}

/** 板块成分股 */
export interface SectorStock {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  change: number;
  volume: number;
  turnover: number;
}

/** 板块详情（含成分股列表） */
export interface SectorDetail {
  sector: SectorData;
  stocks: SectorStock[];
}

/** 热门题材/概念 */
export interface HotTopic {
  code: string;
  name: string;
  changePercent: number;
  change: number;
  leadingStock: string;
  leadingStockCode: string;
  leadingChange: number;
  upCount: number;
  downCount: number;
  capitalFlow: number;
}

// ─── 分析引擎 — 增强版 ────────────────────────────────

/** 市场环境级别 */
export type EnvLevel = 'S' | 'A' | 'B' | 'C' | 'D';

/** 逻辑强度 */
export type LogicStrength = '强' | '中' | '弱';

/** 个股地位 */
export type StockStatus = '核心' | '前排' | '跟风' | '补涨' | '边缘';

/** 位置阶段 */
export type PositionStage = '低位启动' | '中位强化' | '高位博弈' | '明显透支';

/** 买点评级 */
export type BuyPointGrade = '好' | '一般' | '差';

/** 盈亏比评级 */
export type RiskRewardGrade = '好' | '一般' | '差';

/** 买入方式 */
export type BuyMethod = '打板' | '低吸' | '半路' | '观望';

/** 四类结论 */
export type Verdict = 'BUY' | 'COND_BUY' | 'WATCH' | 'NO_BUY';

/**
 * L1 市场环境输出 — 增强版
 *
 * 对齐 Section 8 (环境级别与仓位建议) + Section 11 (今天能不能做)
 */
export interface MarketEnvResult {
  envLevel: EnvLevel;
  sentiment: string;
  suggestion: string;
  /** 今天整体值不值得做 / 适合进攻还是防守 */
  todayAction?: string;
  /** 今天什么类型最好别碰 */
  avoidType?: string;
  /** 有确定性的方向 */
  certainDirections?: string[];
}

/**
 * L2 方向判断输出 — 增强版
 *
 * 对齐 Section 5 方向归属/逻辑强度
 */
export interface DirectionResult {
  mainLine: string;
  subLine: string;
  /** 逻辑强度 强/中/弱 */
  logicStrength?: LogicStrength;
  /** 适合什么打法 */
  suitablePlay?: BuyMethod;
  recommendations: string[];
}

/**
 * L3 个股分析输出 — 增强版
 *
 * 对齐 Section 5 完整9项
 */
export interface StockAnalysisResult {
  stock: string;
  code: string;

  // ── Section 5 字段 ──
  /** 1. 方向归属 */
  direction?: string;
  /** 方向类型：主线/次主线/跟风 */
  directionType?: string;
  /** 2. 逻辑强度 强/中/弱 */
  logicStrength?: LogicStrength;
  /** 核心逻辑一句话 */
  logicSummary?: string;
  /** 3. 个股地位 */
  stockStatus?: StockStatus;
  /** 4. 当前位置判断 */
  position: string;
  /** 5. 当前买点判断 */
  buyPoint: string;
  buyPointReason?: string;
  /** 6. 买入方式建议 */
  buyMethod?: BuyMethod;
  /** 盈亏比评估 */
  riskReward?: RiskRewardGrade;
  riskRewardDetail?: string;

  // ── 原字段 ──
  strength: string;
  volumeAnalysis: string;
  logic: string;
  risk: string[];
  /** 7. 操作结论（直接集成在 stockAnalysis 中） */
  verdict?: Verdict;
}

/** L4 结论输出 */
export interface ConclusionResult {
  stockCode: string;
  stockName: string;
  verdict: Verdict;
  reason: string;
  riskPoints: string[];
  priority: number;
}

/**
 * 比较模式结果
 */
/**
 * 「今天买什么」结果类型
 *
 * 由 LLM 基于大盘环境 + 板块排名 + 领涨股分析得出
 * 用于 DailyPicks 组件展示
 */
export interface DailyPickStock {
  /** 股票名称 */
  name: string;
  /** 股票代码 */
  code: string;
  /** 推荐理由 */
  reason: string;
  /** 建议买入方式/点位说明 */
  entryPoint: string;
  /** 风险提示 (1-2条) */
  riskPoints: string[];
}

export interface DailyPickSector {
  /** 板块名称 */
  name: string;
  /** 逻辑强度 强/中/弱 */
  logicStrength: LogicStrength;
  /** 推荐理由 */
  reason: string;
  /** 该板块推荐的个股 */
  stocks: DailyPickStock[];
}

export interface DailyPicksResult {
  /** 大盘环境概括 */
  envSummary: string;
  /** 环境级别 (S/A/B/C/D) */
  envLevel: EnvLevel;
  /** 总体操作建议 */
  overallSuggestion: string;
  /** 推荐板块列表 */
  sectors: DailyPickSector[];
  /** 生成时间戳 */
  createdAt: number;
}

export interface CompareResult {
  exists: boolean;
  /** 胜出者 */
  winner: string;
  /** 为什么胜出 */
  winnerReason: string;
  /** 另一个/其他为什么不如它 */
  loserReason: string;
  /** 哪个更符合我的模式 */
  betterFit: string;
  /** 哪个当前买点更合理 */
  betterBuyPoint: string;
}

/**
 * 完整分析结果 — 增强版
 */
export interface AnalysisResult {
  marketEnv: MarketEnvResult;
  directions: DirectionResult[];
  stocks: StockAnalysisResult[];
  conclusions: ConclusionResult[];
  /** 比较模式结果（可选） */
  compareResult?: CompareResult;
  timestamp: number;
}

// ─── 排除规则引擎 ────────────────────────────────────

/** 排除规则枚举 */
export type ExclusionRule =
  | '高位接力风险大'
  | '逻辑不清'
  | '买点差'
  | '盈亏比差'
  | '题材透支'
  | '承接差'
  | '缩量'
  | '冲高回落'
  | '逻辑不连续'
  | '模式不匹配'
  | '市场不配合';

/** 排除规则命中结果 */
export interface ExclusionResult {
  /** 是否被排除 */
  excluded: boolean;
  /** 命中的规则列表 */
  hitRules: ExclusionRule[];
  /** 每条命中的详细说明 */
  details: Array<{
    rule: ExclusionRule;
    reason: string;
    severity: 'high' | 'medium' | 'low';
  }>;
  /** 综合评分 0-100（越高越好） */
  compositeScore: number;
}

// ─── 财联社 (cls.cn) ─────────────────────────────────

export interface FlashNews {
  id: number;
  title: string;
  content: string;
  time: string;
  source: string;
  isImportant: boolean;
  stocks: string[];
  category: string;
}

export interface Announcement {
  id: number;
  title: string;
  summary: string;
  stockCode: string;
  stockName: string;
  time: string;
  type: string;
  url: string;
}

export interface ClsTopic {
  id: number;
  name: string;
  hotValue: number;
  stockCount: number;
  changePercent: number;
  description: string;
  leadStock: string;
  leadChange: number;
}

export interface SentimentData {
  score: number;
  label: SentimentLabel;
  hotTopics: string[];
  policyCues: string[];
  riskCues: string[];
  flashCount: number;
  importantCount: number;
  analyzedAt: number;
}

export type SentimentLabel =
  | '极度乐观'
  | '乐观'
  | '偏多'
  | '中性'
  | '偏空'
  | '悲观'
  | '极度悲观';
