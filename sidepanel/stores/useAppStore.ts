/**
 * xvqiu 侧边栏全局状态管理
 *
 * 管理：输入、加载状态、分析结果、设置
 *
 * @module sidepanel/stores/useAppStore
 */

import { create } from 'zustand';
import type { AnalysisResult, DirectionResult, EnvLevel, Verdict } from '../../utils/types';

// ─── 状态类型 ──────────────────────────────────────────

/** 单只股票输入 */
export interface StockInput {
  code: string;
  name: string;
}

/** 分析状态 */
export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error';

/** 单只股票的分析结论展示 */
export interface StockResult {
  code: string;
  name: string;
  verdict: Verdict;
  reason: string;
  riskPoints: string[];
  priority: number;
}

/** 快捷操作按钮状态 */
export type ActionType = 'none' | 'env-check' | 'analyze';

// ─── Store 类型 ────────────────────────────────────────

interface AppState {
  // ─── 输入 ─────────────────────────────────
  /** 单只股票输入 */
  singleInput: string;
  /** 批量股票池输入（多行文本） */
  batchInput: string;
  /** 当前激活的输入模式 */
  inputMode: 'single' | 'batch';

  // ─── 连接状态 ─────────────────────────────
  /** 是否与 Service Worker 连接 */
  connected: boolean;

  // ─── 分析状态 ─────────────────────────────
  /** 整体分析状态 */
  status: AnalysisStatus;
  /** 当前执行的操作类型 */
  currentAction: ActionType;
  /** 错误信息 */
  errorMessage: string | null;

  // ─── 流式输出 ────────────────────────────
  /** 流式文本（LLM 逐字输出） */
  streamingText: string;
  /** 是否正在进行流式分析 */
  isStreaming: boolean;

  // ─── 分析结果 ─────────────────────────────
  /** 市场环境级别 */
  envLevel: EnvLevel | null;
  /** 市场情绪描述 */
  envSentiment: string;
  /** 仓位建议 */
  envSuggestion: string;
  /** L2 方向判断结果列表 */
  directions: DirectionResult[];
  /** 个股分析结果列表 */
  stockResults: StockResult[];
  /** 原始完整分析结果（用于调试/历史） */
  rawResult: AnalysisResult | null;

  // ─── 设置 ─────────────────────────────────
  /** API Key 是否已配置 */
  hasApiKey: boolean;
  /** 设置面板是否展开 */
  settingsOpen: boolean;

  // ─── 操作 ─────────────────────────────────

  // 输入操作
  setSingleInput: (value: string) => void;
  setBatchInput: (value: string) => void;
  setInputMode: (mode: 'single' | 'batch') => void;

  // 连接操作
  setConnected: (connected: boolean) => void;

  // 分析操作
  setStatus: (status: AnalysisStatus) => void;
  setCurrentAction: (action: ActionType) => void;
  setError: (message: string | null) => void;

  // 流式操作
  setStreamingText: (text: string) => void;
  appendStreamingText: (chunk: string) => void;
  setIsStreaming: (streaming: boolean) => void;

  // 结果操作
  setEnvResult: (level: EnvLevel, sentiment: string, suggestion: string) => void;
  setDirections: (directions: DirectionResult[]) => void;
  appendDirection: (direction: DirectionResult) => void;
  setStockResults: (results: StockResult[]) => void;
  appendStockResult: (result: StockResult) => void;
  setRawResult: (result: AnalysisResult | null) => void;
  setAnalysisResult: (result: AnalysisResult) => void;

  // 清空
  clearResults: () => void;
  reset: () => void;

  // 设置操作
  setHasApiKey: (has: boolean) => void;
  toggleSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
}

// ─── 初始值 ────────────────────────────────────────────

const initialStates: Pick<
  AppState,
  | 'singleInput'
  | 'batchInput'
  | 'inputMode'
  | 'connected'
  | 'status'
  | 'currentAction'
  | 'errorMessage'
  | 'streamingText'
  | 'isStreaming'
  | 'envLevel'
  | 'envSentiment'
  | 'envSuggestion'
  | 'directions'
  | 'stockResults'
  | 'rawResult'
  | 'hasApiKey'
  | 'settingsOpen'
> = {
  singleInput: '',
  batchInput: '',
  inputMode: 'single',
  connected: false,
  status: 'idle',
  currentAction: 'none',
  errorMessage: null,
  streamingText: '',
  isStreaming: false,
  envLevel: null,
  envSentiment: '',
  envSuggestion: '',
  directions: [],
  stockResults: [],
  rawResult: null,
  hasApiKey: false,
  settingsOpen: false,
};

// ─── Store ─────────────────────────────────────────────

export const useAppStore = create<AppState>((set) => ({
  ...initialStates,

  // ─── 输入操作 ─────────────────────────────

  setSingleInput: (value: string) => set({ singleInput: value }),

  setBatchInput: (value: string) => set({ batchInput: value }),

  setInputMode: (mode: 'single' | 'batch') => set({ inputMode: mode }),

  // ─── 连接操作 ─────────────────────────────

  setConnected: (connected: boolean) => set({ connected }),

  // ─── 分析操作 ─────────────────────────────

  setStatus: (status: AnalysisStatus) => set({ status }),

  setCurrentAction: (action: ActionType) => set({ currentAction: action }),

  setError: (message: string | null) =>
    set({ errorMessage: message, status: message ? 'error' : 'idle' }),

  // ─── 流式操作 ─────────────────────────────

  setStreamingText: (text: string) => set({ streamingText: text }),

  appendStreamingText: (chunk: string) =>
    set((state) => ({ streamingText: state.streamingText + chunk })),

  setIsStreaming: (streaming: boolean) => set({ isStreaming: streaming }),

  // ─── 结果操作 ─────────────────────────────

  setEnvResult: (level: EnvLevel, sentiment: string, suggestion: string) =>
    set({ envLevel: level, envSentiment: sentiment, envSuggestion: suggestion }),

  setDirections: (directions: DirectionResult[]) => set({ directions }),

  appendDirection: (direction: DirectionResult) =>
    set((state) => ({
      directions: [...state.directions, direction],
    })),

  setStockResults: (results: StockResult[]) => set({ stockResults: results }),

  appendStockResult: (result: StockResult) =>
    set((state) => ({
      stockResults: [...state.stockResults, result],
    })),

  setRawResult: (result: AnalysisResult | null) => set({ rawResult: result }),

  setAnalysisResult: (result: AnalysisResult) =>
    set({
      status: 'success',
      envLevel: result.marketEnv.envLevel,
      envSentiment: result.marketEnv.sentiment,
      envSuggestion: result.marketEnv.suggestion,
      directions: result.directions,
      stockResults: result.conclusions.map((c) => ({
        code: c.stockCode,
        name: c.stockName,
        verdict: c.verdict,
        reason: c.reason,
        riskPoints: c.riskPoints,
        priority: c.priority,
      })),
      rawResult: result,
      errorMessage: null,
    }),

  // ─── 清空 ─────────────────────────────────

  clearResults: () =>
    set({
      status: 'idle',
      envLevel: null,
      envSentiment: '',
      envSuggestion: '',
      directions: [],
      stockResults: [],
      rawResult: null,
      errorMessage: null,
      currentAction: 'none',
      streamingText: '',
      isStreaming: false,
    }),

  reset: () => set({ ...initialStates }),

  // ─── 设置操作 ─────────────────────────────

  setHasApiKey: (has: boolean) => set({ hasApiKey: has }),

  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),

  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),
}));

// ─── 快捷访问 ──────────────────────────────────────────

/** 获取 verdict 对应的颜色类名 (Tailwind) */
export const verdictToColor = (verdict: Verdict): string => {
  switch (verdict) {
    case 'BUY':
      return 'text-buy border-buy/30 bg-buy/10';
    case 'COND_BUY':
      return 'text-cond-buy border-cond-buy/30 bg-cond-buy/10';
    case 'WATCH':
      return 'text-watch border-watch/30 bg-watch/10';
    case 'NO_BUY':
      return 'text-no-buy border-no-buy/30 bg-no-buy/10';
  }
};

/** 获取 verdict 对应的标签文字 */
export const verdictToLabel = (verdict: Verdict): string => {
  switch (verdict) {
    case 'BUY':
      return '可直接买入';
    case 'COND_BUY':
      return '条件买入';
    case 'WATCH':
      return '只可观察';
    case 'NO_BUY':
      return '明确不买';
  }
};

/** 获取 verdict 对应的图标 */
export const verdictToIcon = (verdict: Verdict): string => {
  switch (verdict) {
    case 'BUY':
      return '🟢';
    case 'COND_BUY':
      return '🟡';
    case 'WATCH':
      return '🟠';
    case 'NO_BUY':
      return '🔴';
  }
};

/** 获取 env level 对应的颜色类名 */
export const envLevelToColor = (level: EnvLevel): string => {
  switch (level) {
    case 'S':
      return 'bg-env-s/20 text-env-s border-env-s/40';
    case 'A':
      return 'bg-env-a/20 text-env-a border-env-a/40';
    case 'B':
      return 'bg-env-b/20 text-env-b border-env-b/40';
    case 'C':
      return 'bg-env-c/20 text-env-c border-env-c/40';
    case 'D':
      return 'bg-env-d/20 text-env-d border-env-d/40';
  }
};
