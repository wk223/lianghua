/**
 * EnvBadge — 市场环境级别标签
 *
 * 展示当前市场环境级别（S/A/B/C/D），用颜色区分
 * S=绿灯(强), A=浅绿(良好), B=黄(中性), C=橙(偏弱), D=红(弱势)
 *
 * @module sidepanel/components/EnvBadge
 */

import React from 'react';
import { useAppStore, envLevelToColor } from '../stores/useAppStore';

const EnvBadge: React.FC = () => {
  const { envLevel, envSentiment, envSuggestion } = useAppStore();

  if (!envLevel) return null;

  return (
    <div className="card space-y-2">
      {/* 环境级别标签 + 情绪 */}
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

      {/* 仓位建议 */}
      {envSuggestion && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{envSuggestion}</span>
        </div>
      )}

      {/* 环境级别图例说明 */}
      <div className="flex gap-2 pt-1 text-[10px] text-gray-600">
        {(['S', 'A', 'B', 'C', 'D'] as const).map((level) => (
          <span key={level} className={`px-1.5 py-0.5 rounded ${envLevelToColor(level)}`}>
            {level}
          </span>
        ))}
      </div>
    </div>
  );
};

export default EnvBadge;
