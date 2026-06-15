/**
 * StockInput — 股票输入区（增强版）
 *
 * 支持：单只分析 / 批量分析 / 二选一/三选一比较模式
 *
 * @module sidepanel/components/StockInput
 */

import React from 'react';
import { useAppStore } from '../stores/useAppStore';

const MODE_TABS: Array<{
  key: 'single' | 'batch' | 'compare';
  label: string;
  desc: string;
}> = [
  { key: 'single', label: '单只分析', desc: '输入一只股票代码' },
  { key: 'batch', label: '批量分析', desc: '输入多只股票，每行一个' },
  { key: 'compare', label: '二选一/三选一', desc: '输入2-3只进行强制比较' },
];

const StockInput: React.FC = () => {
  const {
    singleInput,
    batchInput,
    compareInput,
    inputMode,
    setSingleInput,
    setBatchInput,
    setCompareInput,
    setInputMode,
    status,
  } = useAppStore();

  const isLoading = status === 'loading';

  return (
    <section className="space-y-2">
      {/* 模式切换标签 */}
      <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              // 切换到比较模式时自动清空旧结果
              if (tab.key === 'compare' && inputMode !== 'compare') {
                useAppStore.getState().clearResults();
              }
              setInputMode(tab.key);
            }}
            disabled={isLoading}
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              inputMode === tab.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 输入框 */}
      {inputMode === 'single' && (
        <div className="relative">
          <input
            type="text"
            value={singleInput}
            onChange={(e) => setSingleInput(e.target.value)}
            placeholder="输入股票代码或名称，如 000063 或 中兴通讯"
            disabled={isLoading}
            className="w-full px-3 py-2.5 text-sm bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-gray-500 disabled:opacity-50 transition-colors"
          />
          {!singleInput && !isLoading && (
            <p className="mt-1 text-xs text-gray-600 px-1">
              支持代码（000063）或名称（中兴通讯）
            </p>
          )}
        </div>
      )}

      {inputMode === 'batch' && (
        <div className="relative">
          <textarea
            value={batchInput}
            onChange={(e) => setBatchInput(e.target.value)}
            placeholder={`输入股票代码或名称，每行一个

例如:
000063 中兴通讯
贵州茅台 600519
宁德时代 300750`}
            disabled={isLoading}
            rows={4}
            className="w-full px-3 py-2.5 text-sm bg-gray-900 border border-gray-700 rounded-lg resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-gray-500 disabled:opacity-50 transition-colors"
          />
          {batchInput.trim() && (
            <div className="mt-1 flex justify-between text-xs text-gray-500 px-1">
              <span>
                {batchInput.split('\n').filter((l) => l.trim().length > 0).length} 只股票
              </span>
              <button
                type="button"
                onClick={() => setBatchInput('')}
                className="text-gray-600 hover:text-gray-400 transition-colors"
              >
                清空
              </button>
            </div>
          )}
        </div>
      )}

      {inputMode === 'compare' && (
        <div className="relative">
          <textarea
            value={compareInput}
            onChange={(e) => setCompareInput(e.target.value)}
            placeholder={`输入2-3只股票进行强制比较和排序

例如:
中兴通讯 000063
贵州茅台 600519
宁德时代 300750`}
            disabled={isLoading}
            rows={4}
            className="w-full px-3 py-2.5 text-sm bg-gray-900 border border-yellow-700/50 rounded-lg resize-none focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/30 placeholder-gray-500 disabled:opacity-50 transition-colors"
          />
          {compareInput.trim() && (
            <div className="mt-1 flex justify-between text-xs text-gray-500 px-1">
              <span className="text-yellow-600">
                {compareInput.split('\n').filter((l) => l.trim().length > 0).length} 只股票 · 将强制比较并排序
              </span>
              <button
                type="button"
                onClick={() => setCompareInput('')}
                className="text-gray-600 hover:text-gray-400 transition-colors"
              >
                清空
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default StockInput;
