/**
 * EnvBadge — 市场环境级别标签（增强版）
 *
 * 展示当前市场环境级别（S/A/B/C/D），用颜色区分
 * S=绿灯(强), A=浅绿(良好), B=黄(中性), C=橙(偏弱), D=红(弱势)
 *
 * 增强功能：
 *   - 集成方向优先级展示（L2 主线/次线）
 *   - 环境级别图例说明
 *   - 仓位建议始终可见
 *
 * @module sidepanel/components/EnvBadge
 */

import React, { useState } from 'react';
import { useAppStore, envLevelToColor } from '../stores/useAppStore';

const EnvBadge: React.FC = () => {
  const { envLevel, envSentiment, envSuggestion, directions } = useAppStore();
  const [showDirections, setShowDirections] = useState(true);

  if (!envLevel) return null;

  return (
    <div className="card space-y-3">
      {/* ═══ 环境级别标签 + 情绪 ═══ */}
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center px-2.5 py-1 text-xs font-bold rounded-md border ${envLevelToColor(envLevel)}`}
        >
          {envLevel} 级
        </span>
        <span className="text-sm text-gray-300 flex-1 truncate">
          {envSentiment || '市场环境判断'}
        </span>
      </div>

      {/* ═══ 仓位建议 ═══ */}
      {envSuggestion && (
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-900/50 rounded px-2.5 py-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{envSuggestion}</span>
        </div>
      )}

      {/* ═══ L2 方向优先级（折叠/展开） ═══ */}
      {directions.length > 0 && (
        <div className="space-y-2">
          {/* 方向标题 — 可折叠 */}
          <button
            type="button"
            onClick={() => setShowDirections((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 transition-colors w-full text-left"
          >
            <svg
              className={`w-3 h-3 transition-transform duration-150 ${showDirections ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>方向判断</span>
            <span className="text-gray-700">({directions.length} 条)</span>
          </button>

          {/* 方向内容 */}
          <div
            className={`overflow-hidden transition-all duration-200 ${
              showDirections ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <div className="space-y-1.5 pl-4 border-l-2 border-gray-800">
              {directions.map((dir, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  {/* 主线 */}
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-medium flex-shrink-0">主线</span>
                    <span className="text-gray-300">{dir.mainLine}</span>
                  </div>
                  {/* 次线 */}
                  {dir.subLine && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 flex-shrink-0">次线</span>
                      <span className="text-gray-400">{dir.subLine}</span>
                    </div>
                  )}
                  {/* 推荐个股 */}
                  {dir.recommendations.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {dir.recommendations.map((rec, ri) => (
                        <span
                          key={ri}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-blue-900/20 text-blue-400 border border-blue-800/30"
                        >
                          {rec}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ 环境级别图例说明 ═══ */}
      <details className="group">
        <summary className="text-[10px] text-gray-700 cursor-pointer hover:text-gray-600 transition-colors select-none">
          环境级别说明
          <span className="ml-1 group-open:hidden">▶</span>
          <span className="ml-1 hidden group-open:inline">▼</span>
        </summary>
        <div className="flex gap-2 pt-1.5 text-[10px] text-gray-600">
          {(['S', 'A', 'B', 'C', 'D'] as const).map((level) => (
            <span key={level} className={`px-1.5 py-0.5 rounded ${envLevelToColor(level)}`}>
              {level}
            </span>
          ))}
        </div>
      </details>
    </div>
  );
};

export default EnvBadge;