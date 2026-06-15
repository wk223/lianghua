/**
 * EmptyState — 空状态占位
 *
 * 分析尚未开始时的引导展示
 *
 * @module sidepanel/components/EmptyState
 */

import React from 'react';

const EmptyState: React.FC = () => {
  return (
    <section className="flex-1 flex items-center justify-center text-gray-600 text-sm">
      <div className="text-center space-y-3 px-4">
        {/* 主图标 */}
        <div className="text-5xl mb-2">📊</div>

        {/* 标题 */}
        <p className="text-base text-gray-400 font-medium">输入股票池，开始分析</p>

        {/* 引导文案 */}
        <p className="text-xs text-gray-700 max-w-xs mx-auto leading-relaxed">
          选择「单只分析」输入一个股票代码，或切换「批量分析」输入多个股票，
          点击一键分析获取四层过滤结论
        </p>

        {/* 小提示 */}
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-center gap-2 text-[11px] text-gray-700">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-700" />
            <span>优先点击「环境诊断」了解大盘情绪</span>
          </div>
          <div className="flex items-center justify-center gap-2 text-[11px] text-gray-700">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-700" />
            <span>支持代码（000063）或名称（中兴通讯）</span>
          </div>
          <div className="flex items-center justify-center gap-2 text-[11px] text-gray-700">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-700" />
            <span>需先配置 API Key 才能分析</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default EmptyState;
