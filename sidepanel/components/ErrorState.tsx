/**
 * ErrorState — 错误状态展示
 *
 * 显示错误信息，提供重试和清除按钮
 *
 * @module sidepanel/components/ErrorState
 */

import React from 'react';
import { useAppStore } from '../stores/useAppStore';

const ErrorState: React.FC = () => {
  const { errorMessage, status, setError, clearResults } = useAppStore();

  if (status !== 'error' || !errorMessage) return null;

  return (
    <section className="space-y-3">
      {/* 错误卡片 */}
      <div className="bg-no-buy/10 border border-no-buy/20 rounded-lg p-4 space-y-2">
        {/* 头部 */}
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-no-buy flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <span className="text-sm font-medium text-no-buy">分析出错</span>
        </div>

        {/* 错误详情 */}
        <p className="text-xs text-gray-400 bg-gray-900/50 rounded p-2 font-mono leading-relaxed">
          {errorMessage}
        </p>

        {/* 常见原因 */}
        <div className="text-[11px] text-gray-500 space-y-1">
          <p className="font-medium text-gray-600">常见原因：</p>
          <ul className="space-y-0.5 pl-4 list-disc">
            <li>网络连接异常，请检查网络状态</li>
            <li>API Key 未配置或已过期</li>
            <li>股票代码格式不正确</li>
            <li>服务暂时不可用，请稍后重试</li>
          </ul>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setError(null)}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={clearResults}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800/50 rounded-lg hover:bg-gray-700 transition-colors"
          >
            清除结果
          </button>
        </div>
      </div>
    </section>
  );
};

export default ErrorState;
