/**
 * ResultCard — 单只股票分析结论卡片（增强版）
 *
 * 展示 Section 5 完整字段：
 * - 方向归属 / 方向类型
 * - 逻辑强度 / 核心逻辑
 * - 个股地位
 * - 当前位置
 * - 当前买点判断 + 原因
 * - 买入方式建议
 * - 盈亏比评估
 * - 风险点 (2-4条)
 * - 操作结论 (四选一)
 *
 * @module sidepanel/components/ResultCard
 */

import React, { useState } from 'react';
import type { StockResult } from '../stores/useAppStore';
import {
  verdictToColor,
  verdictToLabel,
  verdictToIcon,
} from '../stores/useAppStore';
import type { StockAnalysisResult } from '../../utils/types';

interface ResultCardProps {
  result: StockResult;
  /** 对应的详细分析（含增强字段） */
  detail?: StockAnalysisResult;
  /** 排名序号 */
  index: number;
}

function defaultExpanded(verdict: string): boolean {
  return verdict === 'BUY' || verdict === 'COND_BUY';
}

const ResultCard: React.FC<ResultCardProps> = ({ result, detail, index }) => {
  const [expanded, setExpanded] = useState(() => defaultExpanded(result.verdict));
  const colorClass = verdictToColor(result.verdict);

  const toggleExpanded = () => setExpanded((v) => !v);

  // 逻辑强度颜色
  const strengthColor = (s?: string) => {
    if (s === '强') return 'bg-green-900/30 text-green-400';
    if (s === '中') return 'bg-yellow-900/30 text-yellow-400';
    if (s === '弱') return 'bg-red-900/30 text-red-400';
    return 'bg-gray-800 text-gray-400';
  };

  // 个股地位颜色
  const statusColor = (s?: string) => {
    if (s === '核心' || s === '前排') return 'text-blue-400';
    if (s === '跟风' || s === '补涨') return 'text-gray-400';
    return 'text-gray-600';
  };

  // 买点评级
  const buyPointColor = (bp?: string) => {
    if (bp === '好') return 'text-green-400';
    if (bp === '一般') return 'text-yellow-400';
    if (bp === '差') return 'text-red-400';
    return 'text-gray-400';
  };

  return (
    <div
      className={`rounded-lg border transition-all duration-200 ${colorClass} ${
        expanded ? 'shadow-sm' : ''
      }`}
    >
      {/* ═══ 头部 ═══ */}
      <button
        type="button"
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between p-3 text-left cursor-pointer hover:opacity-90 transition-opacity"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-500 font-mono flex-shrink-0">#{index + 1}</span>
          <span className="text-sm font-semibold text-gray-100 truncate">
            {result.name}
          </span>
          <span className="text-xs text-gray-500 font-mono">{result.code}</span>
          {/* 逻辑强度标签 */}
          {detail?.logicStrength && (
            <span className={`text-[10px] px-1 py-0.5 rounded ${strengthColor(detail.logicStrength)}`}>
              {detail.logicStrength}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 买点评级 */}
          {detail?.buyPoint && (
            <span className={`text-[10px] ${buyPointColor(detail.buyPoint)}`}>
              {detail.buyPoint === '好' ? '🟢' : detail.buyPoint === '一般' ? '🟡' : '🔴'}
              买点{detail.buyPoint}
            </span>
          )}
          {/* 结论标签 */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full border ${colorClass}`}
          >
            {verdictToIcon(result.verdict)} {verdictToLabel(result.verdict)}
          </span>
          <svg
            className={`w-3.5 h-3.5 text-gray-600 transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* ═══ 展开内容 ═══ */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          expanded ? 'max-h-[1200px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 pb-3 space-y-2.5 border-t border-gray-800/50 pt-2.5">
          {/* ── Section 5 完整字段表 ── */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {/* 方向归属 */}
            {detail?.direction && (
              <>
                <span className="text-gray-500">方向归属</span>
                <span className="text-gray-300">
                  {detail.direction}
                  {detail.directionType && (
                    <span className="text-gray-600 ml-1">({detail.directionType})</span>
                  )}
                </span>
              </>
            )}

            {/* 个股地位 */}
            {detail?.stockStatus && (
              <>
                <span className="text-gray-500">个股地位</span>
                <span className={`${statusColor(detail.stockStatus)}`}>
                  {detail.stockStatus}
                </span>
              </>
            )}

            {/* 当前位置 */}
            {detail?.position && detail.position !== '--' && (
              <>
                <span className="text-gray-500">当前位置</span>
                <span className="text-gray-300">{detail.position}</span>
              </>
            )}

            {/* 买入方式 */}
            {detail?.buyMethod && (
              <>
                <span className="text-gray-500">买入方式</span>
                <span className="text-purple-400">{detail.buyMethod}</span>
              </>
            )}

            {/* 盈亏比 */}
            {detail?.riskReward && (
              <>
                <span className="text-gray-500">盈亏比</span>
                <span className={`${buyPointColor(detail.riskReward)}`}>
                  {detail.riskReward}
                </span>
              </>
            )}
          </div>

          {/* ── 核心逻辑 ── */}
          {detail?.logicSummary && (
            <div className="space-y-0.5">
              <p className="text-[11px] text-gray-500 font-medium">📌 核心逻辑</p>
              <p className="text-xs text-gray-400 bg-gray-900/50 rounded px-2 py-1">
                {detail.logicSummary}
              </p>
            </div>
          )}

          {/* ── 买点原因 ── */}
          {detail?.buyPointReason && (
            <div className="space-y-0.5">
              <p className="text-[11px] text-gray-500 font-medium">
                {detail.buyPoint === '好' ? '✅' : detail.buyPoint === '一般' ? '⚠️' : '❌'} 买点原因
              </p>
              <p className="text-xs text-gray-400">{detail.buyPointReason}</p>
            </div>
          )}

          {/* ── 盈亏比详情 ── */}
          {detail?.riskRewardDetail && (
            <div className="space-y-0.5">
              <p className="text-[11px] text-gray-500 font-medium">💰 盈亏比详情</p>
              <p className="text-xs text-gray-400">{detail.riskRewardDetail}</p>
            </div>
          )}

          {/* ── 分析理由 ── */}
          {result.reason && (
            <div className="space-y-0.5">
              <p className="text-[11px] text-gray-500 font-medium">📋 分析理由</p>
              <p className="text-xs text-gray-400 leading-relaxed">{result.reason}</p>
            </div>
          )}

          {/* ── 风险点 (2-4条) ── */}
          {result.riskPoints.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-gray-500 font-medium">⚠️ 风险提示 ({result.riskPoints.length} 条)</p>
              <ul className="space-y-0.5">
                {result.riskPoints.map((point, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-gray-500 flex items-start gap-1"
                  >
                    <span className="mt-0.5 flex-shrink-0">·</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── 底部信息行 ── */}
          <div className="flex items-center justify-between pt-1 text-[10px] text-gray-600">
            {result.priority > 0 && <span>优先级: #{result.priority}</span>}
            <span>
              {result.riskPoints.length > 0
                ? `${result.riskPoints.length} 项风险`
                : '无风险提示'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResultCard;
