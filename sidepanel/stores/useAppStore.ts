/**
 * xvqiu 全局状态管理 — 增强版
 *
 * 支持:
 * - 环境诊断增强 (todayAction, avoidType, certainDirections)
 * - 比较模式 (compareMode, compareResult)
 * - 历史记录面板
 * - 自动轮询
 * - 单票8项必答
 * - 11条排除规则
 *
 * @module sidepanel/stores/useAppStore
 */

import { create } from 'zustand';
import type {
  AnalysisResult,
  DirectionResult,
  EnvLevel,
  Verdict,
  CompareResult,
  StockAnalysisResult,
  DailyPicksResult,
} from '../../utils/types';

// ─── 状态类型 ──────────────────────────────────────────

export interface StockInput {
  code: string;
  name: string;
}

export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error';

export interface StockResult {
  code: string;
  name: string;
  verdict: Verdict;
  reason: string;
  riskPoints: string[];
  priority: number;
}

export type ActionType = 'none' | 'env-check' | 'analyze' | 'compare' | 'daily-picks';

export interface HistoryRecord {
  id: string;
  createdAt: number;
  note?: string;
  result: AnalysisResult;
}

// ─── Store 类型 ────────────────────────────────────────

interface AppState {
  singleInput: string;
  batchInput: string;
  compareInput: string;
  inputMode: 'single' | 'batch' | 'compare';

  connected: boolean;

  status: AnalysisStatus;
  currentAction: ActionType;
  errorMessage: string | null;

  streamingText: string;
  isStreaming: boolean;

  envLevel: EnvLevel | null;
  envSentiment: string;
  envSuggestion: string;
  /** 今天值不值得做 / 适合进攻还是防守 */
  todayAction: string;
  /** 今天什么类型最好别碰 */
  avoidType: string;
  /** 有确定性的方向 */
  certainDirections: string[];
  directions: DirectionResult[];
  stockResults: StockResult[];
  stockDetails: StockAnalysisResult[];
  compareResult: CompareResult | null;
  rawResult: AnalysisResult | null;

  hasApiKey: boolean;
  settingsOpen: boolean;

  // 历史记录
  history: HistoryRecord[];
  historyOpen: boolean;

  // 今天买什么
  dailyPicksResult: DailyPicksResult | null;
  dailyPicksLoading: boolean;

  // 自动轮询
  autoPolling: boolean;
  lastPollTime: number | null;

  // 操作
  setSingleInput: (value: string) => void;
  setBatchInput: (value: string) => void;
  setCompareInput: (value: string) => void;
  setInputMode: (mode: 'single' | 'batch' | 'compare') => void;

  setConnected: (connected: boolean) => void;

  setStatus: (status: AnalysisStatus) => void;
  setCurrentAction: (action: ActionType) => void;
  setError: (message: string | null) => void;

  setStreamingText: (text: string) => void;
  appendStreamingText: (chunk: string) => void;
  setIsStreaming: (streaming: boolean) => void;

  setEnvResult: (level: EnvLevel, sentiment: string, suggestion: string) => void;
  setTodayAction: (action: string) => void;
  setAvoidType: (type: string) => void;
  setCertainDirections: (directions: string[]) => void;
  setDirections: (directions: DirectionResult[]) => void;
  appendDirection: (direction: DirectionResult) => void;
  setStockResults: (results: StockResult[]) => void;
  setStockDetails: (details: StockAnalysisResult[]) => void;
  appendStockResult: (result: StockResult) => void;
  setCompareResult: (result: CompareResult | null) => void;
  setRawResult: (result: AnalysisResult | null) => void;
  setAnalysisResult: (result: AnalysisResult) => void;

  clearResults: () => void;
  reset: () => void;

  setHasApiKey: (has: boolean) => void;
  toggleSettings: () => void;
  setSettingsOpen: (open: boolean) => void;

  // 历史记录操作
  setHistory: (history: HistoryRecord[]) => void;
  addHistory: (record: HistoryRecord) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;
  setHistoryOpen: (open: boolean) => void;
  toggleHistory: () => void;

  // 今天买什么
  setDailyPicksResult: (result: DailyPicksResult | null) => void;
  setDailyPicksLoading: (loading: boolean) => void;

  // 自动轮询
  setAutoPolling: (polling: boolean) => void;
  setLastPollTime: (time: number | null) => void;
}

// ─── 初始值 ────────────────────────────────────────────

const initialStates: Pick<
  AppState,
  | 'singleInput'
  | 'batchInput'
  | 'compareInput'
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
  | 'todayAction'
  | 'avoidType'
  | 'certainDirections'
  | 'directions'
  | 'stockResults'
  | 'stockDetails'
  | 'compareResult'
  | 'rawResult'
  | 'hasApiKey'
  | 'settingsOpen'
  | 'history'
  | 'historyOpen'
  | 'dailyPicksResult'
  | 'dailyPicksLoading'
  | 'autoPolling'
  | 'lastPollTime'
> = {
  singleInput: '',
  batchInput: '',
  compareInput: '',
  inputMode: 'single',
  connected: true,
  status: 'idle',
  currentAction: 'none',
  errorMessage: null,
  streamingText: '',
  isStreaming: false,
  envLevel: null,
  envSentiment: '',
  envSuggestion: '',
  todayAction: '',
  avoidType: '',
  certainDirections: [],
  directions: [],
  stockResults: [],
  stockDetails: [],
  compareResult: null,
  rawResult: null,
  hasApiKey: true,
  settingsOpen: false,
  history: [],
  historyOpen: false,
  dailyPicksResult: null,
  dailyPicksLoading: false,
  autoPolling: false,
  lastPollTime: null,
};

// ─── Store ─────────────────────────────────────────────

export const useAppStore = create<AppState>((set) => ({
  ...initialStates,

  setSingleInput: (value: string) => set({ singleInput: value }),
  setBatchInput: (value: string) => set({ batchInput: value }),
  setCompareInput: (value: string) => set({ compareInput: value }),
  setInputMode: (mode: 'single' | 'batch' | 'compare') => set({ inputMode: mode }),

  setConnected: (_connected: boolean) => {},

  setStatus: (status: AnalysisStatus) => set({ status }),
  setCurrentAction: (action: ActionType) => set({ currentAction: action }),
  setError: (message: string | null) =>
    set({ errorMessage: message, status: message ? 'error' : 'idle' }),

  setStreamingText: (text: string) => set({ streamingText: text }),
  appendStreamingText: (chunk: string) =>
    set((state) => ({ streamingText: state.streamingText + chunk })),
  setIsStreaming: (streaming: boolean) => set({ isStreaming: streaming }),

  setEnvResult: (level: EnvLevel, sentiment: string, suggestion: string) =>
    set({ envLevel: level, envSentiment: sentiment, envSuggestion: suggestion }),

  setTodayAction: (action: string) => set({ todayAction: action }),
  setAvoidType: (type: string) => set({ avoidType: type }),
  setCertainDirections: (directions: string[]) => set({ certainDirections: directions }),

  setDirections: (directions: DirectionResult[]) => set({ directions }),
  appendDirection: (direction: DirectionResult) =>
    set((state) => ({ directions: [...state.directions, direction] })),

  setStockResults: (results: StockResult[]) => set({ stockResults: results }),
  setStockDetails: (details: StockAnalysisResult[]) => set({ stockDetails: details }),
  appendStockResult: (result: StockResult) =>
    set((state) => ({ stockResults: [...state.stockResults, result] })),
  setCompareResult: (result: CompareResult | null) => set({ compareResult: result }),
  setRawResult: (result: AnalysisResult | null) => set({ rawResult: result }),

  setAnalysisResult: (result: AnalysisResult) =>
    set({
      status: 'success',
      envLevel: result.marketEnv.envLevel,
      envSentiment: result.marketEnv.sentiment,
      envSuggestion: result.marketEnv.suggestion,
      todayAction: result.marketEnv.todayAction || '',
      avoidType: result.marketEnv.avoidType || '',
      certainDirections: result.marketEnv.certainDirections || [],
      directions: result.directions,
      stockDetails: result.stocks,
      stockResults: result.conclusions.map((c) => ({
        code: c.stockCode,
        name: c.stockName,
        verdict: c.verdict,
        reason: c.reason,
        riskPoints: c.riskPoints,
        priority: c.priority,
      })),
      compareResult: result.compareResult ?? null,
      rawResult: result,
      errorMessage: null,
    }),

  clearResults: () =>
    set({
      status: 'idle',
      envLevel: null,
      envSentiment: '',
      envSuggestion: '',
      todayAction: '',
      avoidType: '',
      certainDirections: [],
      directions: [],
      stockResults: [],
      stockDetails: [],
      compareResult: null,
      rawResult: null,
      errorMessage: null,
      currentAction: 'none',
      streamingText: '',
      isStreaming: false,
      dailyPicksResult: null,
      dailyPicksLoading: false,
    }),

  reset: () => set({ ...initialStates }),

  setHasApiKey: (has: boolean) => set({ hasApiKey: has }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),

  // 历史记录
  setHistory: (history: HistoryRecord[]) => set({ history }),
  addHistory: (record: HistoryRecord) =>
    set((state) => ({
      history: [record, ...state.history].slice(0, 500),
    })),
  removeHistory: (id: string) =>
    set((state) => ({
      history: state.history.filter((h) => h.id !== id),
    })),
  clearHistory: () => set({ history: [] }),
  setHistoryOpen: (open: boolean) => set({ historyOpen: open }),
  toggleHistory: () => set((state) => ({ historyOpen: !state.historyOpen })),

  // 今天买什么
  setDailyPicksResult: (result: DailyPicksResult | null) => set({ dailyPicksResult: result }),
  setDailyPicksLoading: (loading: boolean) => set({ dailyPicksLoading: loading }),

  // 自动轮询
  setAutoPolling: (polling: boolean) => set({ autoPolling: polling }),
  setLastPollTime: (time: number | null) => set({ lastPollTime: time }),
}));

// ─── 快捷访问 ──────────────────────────────────────────

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

export const envLevelToLabel = (level: EnvLevel): string => {
  switch (level) {
    case 'S': return '可积极出手';
    case 'A': return '可以参与，需筛选';
    case 'B': return '轻仓试错';
    case 'C': return '观察为主';
    case 'D': return '原则上不主动出手';
  }
};
