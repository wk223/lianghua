/**
 * StockInput — 股票输入区
 *
 * 支持：单只股票代码输入 + 批量股票池输入（多行）
 * 两种模式通过 Tab 切换
 *
 * @module sidepanel/components/StockInput
 */

import React from 'react';
import { useAppStore } from '../stores/useAppStore';

const StockInput: React.FC = () => {
  const {
    singleInput,
    batchInput,
    inputMode,
    setSingleInput,
    setBatchInput,
    setInputMode,
    status,
  } = useAppStore();

  const isLoading = status === 'loading';

  return (
    <section className="space-y-2">
      {/* 模式切换标签 */}
      <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
        <button
          type="button"
          onClick={() => setInputMode('single')}
          disabled={isLoading}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            inputMode === 'single'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          单只分析
        </button>
        <button
          type="button"
          onClick={() => setInputMode('batch')}
          disabled={isLoading}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            inputMode === 'batch'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          批量分析
        </button>
      </div>

      {/* 输入框 */}
      {inputMode === 'single' ? (
        <div className="relative">
          <input
            type="text"
            value={singleInput}
            onChange={(e) => setSingleInput(e.target.value)}
            placeholder="输入股票代码或名称，如 000063 或 中兴通讯"
            disabled={isLoading}
            className="w-full px-3 py-2.5 text-sm bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-gray-500 disabled:opacity-50 transition-colors"
          />
          {/* 快捷示例提示 */}
          {!singleInput && !isLoading && (
            <p className="mt-1 text-xs text-gray-600 px-1">
              支持代码（000063）或名称（中兴通讯）
            </p>
          )}
        </div>
      ) : (
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
          {/* 输入计数 */}
          {batchInput.trim() && (
            <div className="mt-1 flex justify-between text-xs text-gray-500 px-1">
              <span>
                {batchInput
                  .split('\n')
                  .filter((l) => l.trim().length > 0).length}{' '}
                只股票
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
    </section>
  );
};

export default StockInput;
