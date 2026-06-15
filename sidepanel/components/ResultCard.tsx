/**
 * ResultCard — 单只股票分析结论卡片（增强版）
 *
 * 根据 verdict 类型显示不同颜色：
 *   BUY     → 绿 (#22c55e)  「可直接买入」
 *   COND_BUY→ 黄 (#eab308)  「条件买入」
 *   WATCH   → 橙 (#f97316)  「只可观察」
 *   NO_BUY  → 红 (#ef4444)  「明确不买」
 *
 * 增强功能：
 *   - 折叠/展开能力（默认展开 BUY/COND_BUY，折叠 WATCH/NO_BUY）
 *   - 完整理由展示（展开时无截断）
 *   - 风险点完整列表（展开时显示全部）
 *   - 动画过渡
 *
 * @module sidepanel/components/ResultCard
 */

import React, { useState } from 'react';
import type { StockResult } from '../stores/useAppStore';
import { verdictToColor, verdictToLabel, verdictToIcon } from '../stores/useAppStore';

interface ResultCardProps {
  result: StockResult;
  /** 排名序号 */
  index: number;
}

/** 判断 verdict 默认是否展开 */
function defaultExpanded(verdict: string): boolean {
  return verdict === 'BUY' || verdict === 'COND_BUY';
}

const ResultCard: React.FC<ResultCardProps> = ({ result, index }) => {
  const [expanded, setExpanded] = useState(() => defaultExpanded(result.verdict));
  const colorClass = verdictToColor(result.verdict);

  const toggleExpanded = () => setExpanded((v) => !v);

  return (
    <div
      className={`rounded-lg border transition-all duration-200 ${colorClass} ${
        expanded ? 'shadow-sm' : ''
      }`}
    >
      {/* ═══ 头部（始终可见）═══ */}
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
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 结论标签 */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full border ${colorClass}`}
          >
            {verdictToIcon(result.verdict)} {verdictToLabel(result.verdict)}
          </span>
          {/* 展开/折叠箭头 */}
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
          expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 pb-3 space-y-2 border-t border-gray-800/50 pt-2">
          {/* ── 分析理由（展开时完整展示） ── */}
          {result.reason && (
            <div className="space-y-1">
              <p className="text-[11px] text-gray-500 font-medium">📋 分析理由</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                {result.reason}
              </p>
            </div>
          )}

          {/* ── 风险点（展开时显示全部） ── */}
          {result.riskPoints.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-gray-500 font-medium">⚠️ 风险提示</p>
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
            {result.priority > 0 && (
              <span>优先级: #{result.priority}</span>
            )}
            <span className="text-gray-700">
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
