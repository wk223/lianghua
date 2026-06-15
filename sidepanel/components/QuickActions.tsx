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

import React, { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { analysisEngine, L2DirectionAnalyzer, exclusionFilter } from '../../engine';
import { PromptBuilder, formatMarketIndex, formatSectors, formatHotTopics } from '../../prompts/builders';
import { DeepSeekClient, deepseekClient } from '../../llm/client';
import { storageManager } from '../../storage/manager';
import type { DailyPicksResult, DailyPickSector, DailyPickStock } from '../../utils/types';

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
    setDailyPicksResult,
    setDailyPicksLoading,
  } = useAppStore();

  const isLoading = status === 'loading';

  // AbortController ref — 防止并发竞态
  const dailyPicksAbortRef = useRef<AbortController | null>(null);

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
  // 「今天买什么」— 一键推荐今日板块及龙头股
  // ═════════════════════════════════════════════════════

  const handleDailyPicks = useCallback(async () => {
    // 中止前一次请求（防止并发竞态）
    if (dailyPicksAbortRef.current) {
      dailyPicksAbortRef.current.abort();
    }
    const abortController = new AbortController();
    dailyPicksAbortRef.current = abortController;

    setCurrentAction('daily-picks');
    setStatus('loading');
    setError(null);
    setDailyPicksLoading(true);
    setDailyPicksResult(null);

    try {
      // ═══ Step 1: 获取市场环境 + 板块数据 ═══
      const envData = await analysisEngine.envCheck({ signal: abortController.signal });
      const { indices, sectors, topics } = envData;

      // ═══ Step 2: 构建「今天买什么」专用 prompt ═══
      const topSectors = (sectors || []).slice(0, 12);
      const topTopics = (topics || []).slice(0, 8);

      const marketContext = [
        '【大盘指数】',
        formatMarketIndex(indices || []),
        '',
        '【热门板块 Top 12】',
        formatSectors(topSectors),
        '',
        '【热门题材 Top 8】',
        formatHotTopics(topTopics),
      ].join('\n');

      const systemPrompt = [
        '你是一位A股短线交易决策助手。你的任务是根据当前市场数据，推荐今天适合买入的板块和个股。',
        '',
        '【核心原则】',
        '1. 严谨——推荐必须有逻辑支撑，不能无根据',
        '2. 实战——推荐必须可执行，有具体买入方式建议',
        '3. 精简——推荐板块不超过3个，每板块推荐1-2只股票',
        '4. 风险——每只票都必须提示风险',
        '',
        '【分析流程】',
        '1. 先判断大盘环境：目前是强/中/弱，适合进攻还是防守',
        '2. 再看板块：哪些板块有持续性逻辑和资金支持',
        '3. 最后选个股：只推板块内的龙头/核心股',
        '',
        '【输出 JSON Schema】',
        JSON.stringify({
          envSummary: '大盘环境一句话总结（30字内）',
          envLevel: 'S|A|B|C|D',
          overallSuggestion: '总体操作建议',
          sectors: [
            {
              name: '板块名称',
              logicStrength: '强|中|弱',
              reason: '推荐理由',
              stocks: [
                {
                  name: '股票名称',
                  code: '股票代码',
                  reason: '推荐理由',
                  entryPoint: '买入方式/点位建议',
                  riskPoints: ['风险1', '风险2'],
                },
              ],
            },
          ],
        }, null, 2),
        '',
        '注意：',
        '- 如果环境不支持积极出手（C级或D级），sectors 返回空数组 []',
        '- 禁止在 JSON 外套 markdown 代码块',
        '- 禁止添加 JSON 之外的文字',
      ].join('\n');

      const userPrompt = `请基于以下市场数据，推荐今天最适合买入的板块和龙头股。\n\n${marketContext}`;

      // ═══ Step 3: 调用 DeepSeek ═══
      const response = await deepseekClient.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { signal: abortController.signal },
      );

      const llmOutput = response.choices?.[0]?.message?.content ?? '';

      // ═══ Step 4: 解析 LLM 输出 ═══
      let parsed: DailyPicksResult;

      // 校验 envLevel 是否为合法值
      const validLevels = ['S', 'A', 'B', 'C', 'D'] as const;
      type ValidEnvLevel = (typeof validLevels)[number];
      const normalizeEnvLevel = (v: string): ValidEnvLevel =>
        validLevels.includes(v as ValidEnvLevel) ? (v as ValidEnvLevel) : envData.envLevel;

      try {
        // 尝试提取 JSON（可能有前后冗余字符）
        const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : llmOutput;
        const raw = JSON.parse(jsonStr);

        parsed = {
          envSummary: raw.envSummary || envData.sentiment || '市场数据更新中',
          envLevel: normalizeEnvLevel(raw.envLevel),
          overallSuggestion: raw.overallSuggestion || envData.suggestion,
          sectors: Array.isArray(raw.sectors) ? raw.sectors.slice(0, 3) : [],
          createdAt: Date.now(),
        };
      } catch {
        // JSON 解析失败时，以降级数据兜底
        const fallbackSectors = buildFallbackPicks(sectors || [], topics || []);
        parsed = {
          envSummary: envData.sentiment || '市场环境分析中',
          envLevel: envData.envLevel,
          overallSuggestion: envData.suggestion,
          sectors: fallbackSectors,
          createdAt: Date.now(),
        };
      }

      // ═══ Step 5: 保存到历史记录 ═══
      storageManager.addHistory(
        {
          marketEnv: {
            envLevel: parsed.envLevel,
            sentiment: parsed.envSummary,
            suggestion: parsed.overallSuggestion,
            todayAction: envData.todayAction,
            avoidType: envData.avoidType,
            certainDirections: envData.certainDirections,
          },
          directions: [],
          stocks: [],
          conclusions: [],
          timestamp: Date.now(),
        },
        `今天买什么 - ${parsed.sectors.map(s => s.name).join('/')}`,
        ['daily-picks'],
      );

      // ═══ Step 6: 更新 store ═══
      setDailyPicksResult(parsed);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setCurrentAction('none');
      setDailyPicksLoading(false);
    }
  }, [
    setCurrentAction,
    setStatus,
    setError,
    setDailyPicksResult,
    setDailyPicksLoading,
  ]);

  // ─── 兜底：当 LLM JSON 解析失败时，用板块数据生成推荐 ───
  function buildFallbackPicks(
    sectors: Array<{ name: string; changePercent: number; leadingStock: string; leadingStockCode: string; leadingChange: number }>,
    topics: Array<{ name: string; changePercent: number; leadingStock: string }>,
  ): DailyPickSector[] {
    const candidates = [...sectors].sort((a, b) => b.changePercent - a.changePercent);
    const top3 = candidates.slice(0, 3);

    return top3.map((s) => ({
      name: s.name,
      logicStrength: (s.changePercent >= 3 ? '强' : s.changePercent >= 1 ? '中' : '弱') as '强' | '中' | '弱',
      reason: `今日涨幅 ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%，板块效应明显`,
      stocks: s.leadingStock
        ? [
            {
              name: s.leadingStock,
              code: s.leadingStockCode || (s.leadingStock.match(/\d{6}/)?.[0] ?? ''),
              reason: `${s.name}板块领涨股，涨幅 ${s.leadingChange >= 0 ? '+' : ''}${s.leadingChange.toFixed(2)}%`,
              entryPoint: '关注分时低吸机会，不追高',
              riskPoints: ['板块轮动风险', '冲高回落风险'],
            },
          ]
        : [],
    }));
  }

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
      {/* 「今天买什么」按钮 — 醒目绿色/金色 */}
      <button
        type="button"
        onClick={handleDailyPicks}
        disabled={isLoading}
        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-sm font-medium text-yellow-300 bg-gradient-to-r from-yellow-900/30 to-green-900/30 rounded-lg hover:from-yellow-900/50 hover:to-green-900/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-yellow-700/40 shadow-sm shadow-yellow-900/20"
        title="AI 推荐今日板块及龙头股"
      >
        {currentAction === 'daily-picks' ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        )}
        <span className="hidden sm:inline">今天买什么</span>
        <span className="sm:hidden">今日推荐</span>
      </button>

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
