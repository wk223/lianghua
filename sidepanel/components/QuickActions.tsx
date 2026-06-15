/**
 * QuickActions — 快捷操作按钮 (Electron 版)
 * 使用 IPC invoke 替换 chrome.runtime.sendMessage
 *
 * @module sidepanel/components/QuickActions
 */

import React, { useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { sendMessage } from '../../src/shared/ipc-bridge';

const QuickActions: React.FC = () => {
  const {
    singleInput,
    batchInput,
    inputMode,
    status,
    currentAction,
    setStatus,
    setCurrentAction,
    setError,
    setEnvResult,
  } = useAppStore();

  const isLoading = status === 'loading';

  // ─── 环境检查 ─────────────────────────────

  const handleEnvCheck = useCallback(async () => {
    setCurrentAction('env-check');
    setStatus('loading');
    setError(null);

    try {
      const response = await sendMessage({ type: 'ENV_CHECK' });

      if (response?.success && response.data) {
        const data = response.data as any;
        setEnvResult(
          data.envLevel,
          data.sentiment,
          data.suggestion,
        );
        if (data.directions?.length > 0) {
          useAppStore.getState().setDirections(data.directions);
        }
        setStatus('success');
      } else {
        setError(response?.error ?? '环境检查失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '环境检查请求失败');
    } finally {
      setCurrentAction('none');
    }
  }, [setCurrentAction, setStatus, setError, setEnvResult]);

  // ─── 一键分析 ─────────────────────────────

  const handleAnalyze = useCallback(async () => {
    const input = inputMode === 'single' ? singleInput : batchInput;
    if (!input.trim()) {
      setError('请先输入股票代码或名称');
      return;
    }

    setCurrentAction('analyze');
    setStatus('loading');
    setError(null);

    try {
      // 解析输入为股票列表
      const lines = input
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const response = await sendMessage({
        type: 'ANALYZE_POOL',
        payload: { stocks: lines },
      });

      if (response?.success && response.data) {
        if (typeof response.data === 'object' && 'marketEnv' in (response.data as any)) {
          useAppStore.getState().setAnalysisResult(response.data as any);
        } else {
          setStatus('success');
        }
      } else {
        setError(response?.error ?? '分析请求失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析请求发送失败');
    } finally {
      setCurrentAction('none');
    }
  }, [singleInput, batchInput, inputMode, setCurrentAction, setStatus, setError]);

  // ─── 判断分析按钮是否可点击 ──────────────

  const canAnalyze = (() => {
    if (isLoading) return false;
    if (inputMode === 'single') return singleInput.trim().length > 0;
    return batchInput.trim().length > 0;
  })();

  return (
    <section className="flex gap-2">
      {/* 环境诊断 */}
      <button
        type="button"
        onClick={handleEnvCheck}
        disabled={isLoading}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-gray-700"
      >
        {currentAction === 'env-check' ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        )}
        环境诊断
      </button>

      {/* 一键分析 */}
      <button
        type="button"
        onClick={handleAnalyze}
        disabled={!canAnalyze}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {currentAction === 'analyze' ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        一键分析
      </button>
    </section>
  );
};

export default QuickActions;
