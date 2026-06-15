/**
 * ResultCard — 单只股票分析结论卡片
 *
 * 根据 verdict 类型显示不同颜色：
 *   BUY     → 绿 (#22c55e)  「可直接买入」
 *   COND_BUY→ 黄 (#eab308)  「条件买入」
 *   WATCH   → 橙 (#f97316)  「只可观察」
 *   NO_BUY  → 红 (#ef4444)  「明确不买」
 *
 * @module sidepanel/components/ResultCard
 */

import React from 'react';
import type { StockResult } from '../stores/useAppStore';
import { verdictToColor, verdictToLabel, verdictToIcon } from '../stores/useAppStore';

interface ResultCardProps {
  result: StockResult;
  /** 排名序号 */
  index: number;
}

const ResultCard: React.FC<ResultCardProps> = ({ result, index }) => {
  const colorClass = verdictToColor(result.verdict);

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 transition-colors ${colorClass}`}
    >
      {/* 头部：代码 + 名称 + 结论标签 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-500 font-mono">#{index + 1}</span>
          <span className="text-sm font-semibold text-gray-100 truncate">
            {result.name}
          </span>
          <span className="text-xs text-gray-500 font-mono">{result.code}</span>
        </div>
        <span
          className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full border ${colorClass}`}
        >
          {verdictToIcon(result.verdict)} {verdictToLabel(result.verdict)}
        </span>
      </div>

      {/* 分析理由 */}
      {result.reason && (
        <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">
          {result.reason}
        </p>
      )}

      {/* 风险点 */}
      {result.riskPoints.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-gray-500 font-medium">⚠️ 风险提示</p>
          <ul className="space-y-0.5">
            {result.riskPoints.slice(0, 3).map((point, i) => (
              <li
                key={i}
                className="text-[11px] text-gray-500 flex items-start gap-1"
              >
                <span className="mt-0.5 flex-shrink-0">·</span>
                <span className="line-clamp-2">{point}</span>
              </li>
            ))}
            {result.riskPoints.length > 3 && (
              <li className="text-[11px] text-gray-600">
                +{result.riskPoints.length - 3} 项更多风险
              </li>
            )}
          </ul>
        </div>
      )}

      {/* 优先级标记 */}
      {result.priority > 0 && (
        <div className="flex justify-end">
          <span className="text-[10px] text-gray-600">
            优先级: {result.priority}
          </span>
        </div>
      )}
    </div>
  );
};

export default ResultCard;
