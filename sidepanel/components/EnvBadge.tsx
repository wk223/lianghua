/**
 * EnvBadge — 市场环境级别标签（增强版）
 *
 * 新增：
 * - "今天能不能做" 一键诊断结论展示
 * - todayAction：今天值不值得做 / 适合进攻还是防守
 * - avoidType：什么类型最好别碰
 * - certainDirections：有确定性的方向
 * - 方向逻辑强度 / 适合打法展示
 *
 * @module sidepanel/components/EnvBadge
 */

import React, { useState } from 'react';
import { useAppStore, envLevelToColor } from '../stores/useAppStore';

const EnvBadge: React.FC = () => {
  const {
    envLevel,
    envSentiment,
    envSuggestion,
    todayAction,
    avoidType,
    certainDirections,
    directions,
  } = useAppStore();

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

      {/* ═══ 「今天能不能做」区块 ═══ */}
      {todayAction && (
        <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg px-3 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-400 font-medium">📋 今天能不能做</span>
          </div>
          <p className="text-sm text-gray-200 font-medium">{todayAction}</p>

          {/* 仓位建议 */}
          {envSuggestion && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{envSuggestion}</span>
            </div>
          )}
        </div>
      )}

      {/* 如果没有 todayAction，显示仓位建议 */}
      {!todayAction && envSuggestion && (
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-900/50 rounded px-2.5 py-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{envSuggestion}</span>
        </div>
      )}

      {/* ═══ 哪些方向有确定性 ═══ */}
      {certainDirections && certainDirections.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 font-medium">🎯 有确定性的方向</p>
          <div className="flex flex-wrap gap-1.5">
            {certainDirections.map((dir, i) => (
              <span
                key={i}
                className="px-2 py-0.5 text-xs rounded-full bg-green-900/20 text-green-400 border border-green-800/30"
              >
                {dir}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 什么类型最好别碰 ═══ */}
      {avoidType && (
        <div className="flex items-center gap-2 text-xs text-orange-400 bg-orange-900/10 rounded px-2.5 py-1.5 border border-orange-800/20">
          <span>🚫 别碰：</span>
          <span>{avoidType}</span>
        </div>
      )}

      {/* ═══ L2 方向优先级（增强版 — 含逻辑强度+适合打法） ═══ */}
      {directions.length > 0 && (
        <div className="space-y-2">
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

          <div
            className={`overflow-hidden transition-all duration-200 ${
              showDirections ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <div className="space-y-1.5 pl-4 border-l-2 border-gray-800">
              {directions.map((dir, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-400 font-medium flex-shrink-0">主线</span>
                    <span className="text-gray-300">{dir.mainLine}</span>
                    {/* 逻辑强度 */}
                    {dir.logicStrength && (
                      <span className={`text-[10px] px-1 py-0.5 rounded ${
                        dir.logicStrength === '强'
                          ? 'bg-green-900/30 text-green-400'
                          : dir.logicStrength === '中'
                            ? 'bg-yellow-900/30 text-yellow-400'
                            : 'bg-gray-800 text-gray-400'
                      }`}>
                        {dir.logicStrength}
                      </span>
                    )}
                  </div>
                  {dir.subLine && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 flex-shrink-0">次线</span>
                      <span className="text-gray-400">{dir.subLine}</span>
                    </div>
                  )}
                  {/* 适合打法 */}
                  {dir.suitablePlay && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-gray-600 flex-shrink-0">打法</span>
                      <span className="text-purple-400 text-[10px]">{dir.suitablePlay}</span>
                    </div>
                  )}
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

      {/* ═══ 环境级别图例 ═══ */}
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
