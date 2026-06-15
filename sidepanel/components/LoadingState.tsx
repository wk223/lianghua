/**
 * LoadingState — 加载状态展示
 *
 * 根据当前操作类型显示不同的加载提示
 *
 * @module sidepanel/components/LoadingState
 */

import React from 'react';
import { useAppStore } from '../stores/useAppStore';

/** 加载文案映射 */
const LOADING_TEXTS: Record<string, string> = {
  'env-check': '正在诊断市场环境...',
  analyze: '正在执行四层过滤分析...',
};

const LoadingState: React.FC = () => {
  const { currentAction } = useAppStore();

  const text = LOADING_TEXTS[currentAction] ?? '正在处理...';

  return (
    <section className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        {/* 旋转动画 */}
        <div className="relative mx-auto w-16 h-16">
          {/* 外圈 */}
          <svg
            className="animate-spin w-16 h-16 text-blue-500"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {/* 内圈图标 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xl">🔍</span>
          </div>
        </div>

        {/* 文案 */}
        <div className="space-y-1">
          <p className="text-sm text-gray-300 font-medium">{text}</p>
          <p className="text-xs text-gray-600">
            正在获取市场数据并执行多维度分析...
          </p>
        </div>

        {/* 进度指示 */}
        <div className="flex justify-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0s' }} />
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0.15s' }} />
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0.3s' }} />
        </div>
      </div>
    </section>
  );
};

export default LoadingState;
