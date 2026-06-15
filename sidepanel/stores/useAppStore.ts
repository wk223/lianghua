/**
 * xvqiu 全局状态管理 (Web 版)
 *
 * 移除 chrome.runtime / Electron IPC 依赖
 * 分析逻辑在浏览器端直接调用
 *
 * @module sidepanel/stores/useAppStore
 */

import { create } from 'zustand';
import type { AnalysisResult, DirectionResult, EnvLevel, Verdict } from '../../utils/types';

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

export type ActionType = 'none' | 'env-check' | 'analyze';

// ─── Store 类型 ────────────────────────────────────────

interface AppState {
  singleInput: string;
  batchInput: string;
  inputMode: 'single' | 'batch';

  // Web 版无需连接状态，始终为 true
  connected: boolean;

  status: AnalysisStatus;
  currentAction: ActionType;
  errorMessage: string | null;

  streamingText: string;
  isStreaming: boolean;

  envLevel: EnvLevel | null;
  envSentiment: string;
  envSuggestion: string;
  directions: DirectionResult[];
  stockResults: StockResult[];
  rawResult: AnalysisResult | null;

  hasApiKey: boolean;
  settingsOpen: boolean;

  // 操作
  setSingleInput: (value: string) => void;
  setBatchInput: (value: string) => void;
  setInputMode: (mode: 'single' | 'batch') => void;

  setConnected: (connected: boolean) => void;

  setStatus: (status: AnalysisStatus) => void;
  setCurrentAction: (action: ActionType) => void;
  setError: (message: string | null) => void;

  setStreamingText: (text: string) => void;
  appendStreamingText: (chunk: string) => void;
  setIsStreaming: (streaming: boolean) => void;

  setEnvResult: (level: EnvLevel, sentiment: string, suggestion: string) => void;
  setDirections: (directions: DirectionResult[]) => void;
  appendDirection: (direction: DirectionResult) => void;
  setStockResults: (results: StockResult[]) => void;
  appendStockResult: (result: StockResult) => void;
  setRawResult: (result: AnalysisResult | null) => void;
  setAnalysisResult: (result: AnalysisResult) => void;

  clearResults: () => void;
  reset: () => void;

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
  connected: true, // Web 版始终连接
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
  hasApiKey: true, // API Key 内置在代码中
  settingsOpen: false,
};

// ─── Store ─────────────────────────────────────────────

export const useAppStore = create<AppState>((set) => ({
  ...initialStates,

  setSingleInput: (value: string) => set({ singleInput: value }),
  setBatchInput: (value: string) => set({ batchInput: value }),
  setInputMode: (mode: 'single' | 'batch') => set({ inputMode: mode }),

  setConnected: (_connected: boolean) => {
    // Web 版始终连接，不做实际设置
  },

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

  setDirections: (directions: DirectionResult[]) => set({ directions }),
  appendDirection: (direction: DirectionResult) =>
    set((state) => ({ directions: [...state.directions, direction] })),

  setStockResults: (results: StockResult[]) => set({ stockResults: results }),
  appendStockResult: (result: StockResult) =>
    set((state) => ({ stockResults: [...state.stockResults, result] })),

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

  setHasApiKey: (has: boolean) => set({ hasApiKey: has }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),
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
