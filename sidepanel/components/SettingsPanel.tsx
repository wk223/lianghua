/**
 * SettingsPanel — 设置面板 (Web 版)
 *
 * API Key 已内置在代码中，无需用户配置。
 * 分析逻辑在浏览器端直接执行。
 *
 * @module sidepanel/components/SettingsPanel
 */

import React from 'react';
import { useAppStore } from '../stores/useAppStore';

const SettingsPanel: React.FC = () => {
  const { settingsOpen, toggleSettings } = useAppStore();

  return (
    <>
      {/* 设置入口按钮 */}
      <button
        type="button"
        onClick={toggleSettings}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-800"
        title="关于"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        关于
      </button>

      {/* 设置面板 */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={toggleSettings}
          />

          {/* 面板 */}
          <div className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl mx-4 mb-0 sm:mb-4 p-5 space-y-4 animate-slide-up">
            {/* 标题 */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-100">关于 xvqiu</h2>
              <button
                type="button"
                onClick={toggleSettings}
                className="p-1 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-800"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 应用信息 */}
            <div className="space-y-3 text-sm">
              <div className="bg-gray-950 rounded-lg p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">版本</span>
                  <span className="text-gray-300">1.0.0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">引擎</span>
                  <span className="text-gray-300">DeepSeek Chat</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">数据源</span>
                  <span className="text-gray-300">东方财富</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">平台</span>
                  <span className="text-gray-300">Web 应用 (Vite + React)</span>
                </div>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed">
                xvqiu 是一款 A 股短线交易决策助手，采用四层过滤分析框架（L1 市场环境 → L2 方向判断 → L3 个股分析 → L4 结论输出），帮助投资者少做垃圾机会。
              </p>
            </div>

            {/* 底部提示 */}
            <p className="text-[11px] text-gray-700 text-center">
              按 Esc 关闭
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default SettingsPanel;
