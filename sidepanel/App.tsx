/**
 * xvqiu 主应用组件 (Electron 版)
 * 替换 chrome.runtime.sendMessage 为 IPC invoke
 * 移除 chrome.storage 依赖
 *
 * @module sidepanel/App
 */

import React, { useEffect } from 'react';
import { useAppStore } from './stores/useAppStore';
import { sendMessage } from '../src/shared/ipc-bridge';

// 子组件
import StockInput from './components/StockInput';
import QuickActions from './components/QuickActions';
import EnvBadge from './components/EnvBadge';
import ResultsList from './components/ResultsList';
import EmptyState from './components/EmptyState';
import LoadingState from './components/LoadingState';
import ErrorState from './components/ErrorState';
import SettingsPanel from './components/SettingsPanel';
import Watchlist from './components/Watchlist';

const App: React.FC = () => {
  const {
    connected,
    setConnected,
    status,
    envLevel,
    stockResults,
    hasApiKey,
  } = useAppStore();

  // 启动时检测与主进程的连接
  useEffect(() => {
    sendMessage({ type: 'PING' }).then((response) => {
      if (response?.success) {
        setConnected(true);
        console.log('[xvqiu] 已连接 Electron 主进程');
      } else {
        console.warn('[xvqiu] 连接主进程失败');
      }
    });
  }, [setConnected]);

  // ─── 判断展示区域内容 ──────────────────

  const renderContent = () => {
    // 加载中 → 加载状态
    if (status === 'loading') {
      return <LoadingState />;
    }

    // 有分析结果 → 展示结果（含环境标签 + 股票列表）
    if (status === 'success' && stockResults.length > 0) {
      return (
        <div className="space-y-4">
          {envLevel && <EnvBadge />}
          <ResultsList />
        </div>
      );
    }

    // 环境检查成功但无个股结果
    if (status === 'success' && envLevel && stockResults.length === 0) {
      return (
        <div className="space-y-4">
          <EnvBadge />
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            <div className="text-center space-y-2">
              <div className="text-3xl">✅</div>
              <p>环境诊断完成，可输入股票开始分析</p>
            </div>
          </div>
        </div>
      );
    }

    // 错误状态
    if (status === 'error') {
      return (
        <div className="space-y-4">
          <ErrorState />
        </div>
      );
    }

    // 默认 → 空状态引导
    return <EmptyState />;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* ═══ 头部 ═══ */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 flex-shrink-0">
        {/* Logo + 标题 */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent flex-shrink-0">
            🎯 xvqiu
          </span>
          <span className="text-xs text-gray-500 hidden sm:inline truncate">
            A股短线交易决策助手
          </span>
        </div>

        {/* 右侧状态 */}
        <div className="ml-auto flex items-center gap-3">
          {/* 设置 */}
          <SettingsPanel />

          {/* 连接状态灯 */}
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-green-500' : 'bg-red-500'
              }`}
              title={connected ? '主进程已连接' : '主进程未连接'}
            />
            <span className="text-[10px] text-gray-600 hidden sm:inline">
              {connected ? '已连接' : '断开'}
            </span>
          </div>
        </div>
      </header>

      {/* ═══ 主体区域（可滚动）═══ */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 输入区域 */}
        <StockInput />

        {/* 快捷操作按钮 */}
        <QuickActions />

        {/* 自选股管理 */}
        <Watchlist />

        {/* 错误提示 */}
        {status === 'error' && <ErrorState />}

        {/* 结果内容区 */}
        {renderContent()}
      </main>

      {/* ═══ 底部状态栏 ═══ */}
      <footer className="flex items-center justify-between px-4 py-2 text-xs text-gray-600 border-t border-gray-800 flex-shrink-0">
        <span>v1.0.0</span>
        <span>数据: 东方财富 · 引擎: DeepSeek</span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] ${
            hasApiKey
              ? 'bg-green-900/30 text-green-500'
              : 'bg-yellow-900/30 text-yellow-600'
          }`}
        >
          {hasApiKey ? 'API 已配置' : '未配置 API'}
        </span>
      </footer>
    </div>
  );
};

export default App;
