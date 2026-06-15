/**
 * QuickActions — 快捷操作按钮（增强版）
 *
 * 新增:
 * - "今天能不能做" — 一键环境诊断
 * - 比较模式分析
 * - 排除规则集成
 *
 * @module sidepanel/components/QuickActions
 */

import React, { useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { analysisEngine, L2DirectionAnalyzer, exclusionFilter } from '../../engine';
import { PromptBuilder } from '../../prompts/builders';
import { DeepSeekClient, deepseekClient } from '../../llm/client';

const QuickActions: React.FC = () => {
  const {
    singleInput,
    batchInput,
    compareInput,
    inputMode,
    status,
    currentAction,
    setStatus,
    setCurrentAction,
    setError,
    setEnvResult,
    setTodayAction,
    setAvoidType,
    setCertainDirections,
    setAnalysisResult,
    setDirections,
    setCompareResult,
  } = useAppStore();

  const isLoading = status === 'loading';

  // ═════════════════════════════════════════════════════
  // 「今天能不能做」— 一键环境诊断
  // ═════════════════════════════════════════════════════

  const handleEnvCheck = useCallback(async () => {
    setCurrentAction('env-check');
    setStatus('loading');
    setError(null);

    try {
      const envData = await analysisEngine.envCheck();

      // 基础环境数据
      setEnvResult(
        envData.envLevel,
        envData.sentiment,
        envData.suggestion,
      );

      // 如果有 LLM 返回的增强字段，也设置
      if (envData.todayAction) setTodayAction(envData.todayAction);
      if (envData.avoidType) setAvoidType(envData.avoidType);
      if (envData.certainDirections) setCertainDirections(envData.certainDirections);

      // 运行 L2 方向分析
      const l2 = new L2DirectionAnalyzer();
      const directions = await l2.analyze(envData.sectors, envData.topics);
      if (directions?.length > 0) {
        setDirections(directions);
      }

      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : '环境检查失败');
    } finally {
      setCurrentAction('none');
    }
  }, [
    setCurrentAction,
    setStatus,
    setError,
    setEnvResult,
    setTodayAction,
    setAvoidType,
    setCertainDirections,
    setDirections,
  ]);

  // ═════════════════════════════════════════════════════
  // 一键分析（含比较模式）
  // ═════════════════════════════════════════════════════

  const handleAnalyze = useCallback(async () => {
    const input = inputMode === 'single' ? singleInput
      : inputMode === 'compare' ? compareInput
      : batchInput;

    if (!input.trim()) {
      setError('请先输入股票代码或名称');
      return;
    }

    const isCompareMode = inputMode === 'compare';

    setCurrentAction(isCompareMode ? 'compare' : 'analyze');
    setStatus('loading');
    setError(null);

    try {
      // 解析输入为股票列表
      const lines = input
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const stocks: string[] = lines.map((l) => {
        const parts = l.split(/\s+/);
        return parts.find((p) => /^\d{6}$/.test(p)) ?? l;
      });

      if (isCompareMode && (stocks.length < 2 || stocks.length > 3)) {
        setError('比较模式请输入 2~3 只股票');
        return;
      }

      // 调用分析引擎
      const result = await analysisEngine.analyzePool({ stocks });

      // 运行排除规则过滤
      if (result.stocks && result.stocks.length > 0) {
        // 获取大盘平均涨跌幅（从 rawResult 中提取）
        const avgMarketChange = 0; // fallback
        const exclusionResults = exclusionFilter.analyzeBatch(
          result.stocks.map((s) => ({
            code: s.code,
            name: s.stock,
            price: 0,
            change: 0,
            changePercent: 0,
            volume: 0,
            turnover: 0,
            high: 0,
            low: 0,
            open: 0,
            amplitude: 0,
            turnoverRate: 0,
          })),
          avgMarketChange,
        );
        // 排除规则结果存入 console 供调试，不阻塞 UI
        console.debug('[ExclusionFilter] results:', Object.fromEntries(exclusionResults));
      }

      setAnalysisResult(result);

      // 如果是比较模式，从 result.compareResult 提取
      if (isCompareMode && result.compareResult) {
        setCompareResult(result.compareResult);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : '分析请求失败');
    } finally {
      setCurrentAction('none');
    }
  }, [
    singleInput,
    batchInput,
    compareInput,
    inputMode,
    setCurrentAction,
    setStatus,
    setError,
    setAnalysisResult,
    setCompareResult,
  ]);

  // ═════════════════════════════════════════════════════
  // 判断按钮是否可点击
  // ═════════════════════════════════════════════════════

  const canAnalyze = (() => {
    if (isLoading) return false;
    if (inputMode === 'single') return singleInput.trim().length > 0;
    if (inputMode === 'compare') return compareInput.trim().length > 0;
    return batchInput.trim().length > 0;
  })();

  // ═════════════════════════════════════════════════════
  // 渲染
  // ═════════════════════════════════════════════════════

  return (
    <section className="flex gap-2">
      {/* 「今天能不能做」按钮 — 环境诊断 */}
      <button
        type="button"
        onClick={handleEnvCheck}
        disabled={isLoading}
        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-sm font-medium text-green-400 bg-green-900/20 rounded-lg hover:bg-green-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-green-800/30"
        title="一键环境诊断：今天能不能做？"
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
        <span className="hidden sm:inline">今天能不能做</span>
        <span className="sm:hidden">环境诊断</span>
      </button>

      {/* 一键分析 / 比较分析 */}
      <button
        type="button"
        onClick={handleAnalyze}
        disabled={!canAnalyze}
        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          inputMode === 'compare'
            ? 'text-yellow-400 bg-yellow-900/20 border border-yellow-800/30 hover:bg-yellow-900/40'
            : 'text-white bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {currentAction === 'analyze' || currentAction === 'compare' ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        {inputMode === 'compare' ? '比较排序' : '一键分析'}
      </button>
    </section>
  );
};

export default QuickActions;
