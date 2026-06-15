/**
 * xvqiu 主应用组件 — 增强版
 *
 * @module sidepanel/App
 */

import React, { useEffect } from 'react';
import { useAppStore } from './stores/useAppStore';
import { useAutoPolling } from './hooks/useAutoPolling';

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
import HistoryPanel from './components/HistoryPanel';
import DailyPicks from './components/DailyPicks';

const App: React.FC = () => {
  const {
    connected,
    status,
    envLevel,
    stockResults,
    todayAction,
    autoPolling,
    lastPollTime,
    hasApiKey,
    dailyPicksResult,
    dailyPicksLoading,
  } = useAppStore();

  const { startPolling, stopPolling, togglePolling, isPolling } = useAutoPolling();

  // 组件挂载后启动自动轮询
  useEffect(() => {
    console.log('[xvqiu] Web 版已启动');
    startPolling();
    return () => {
      stopPolling();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 判断展示区域内容 ──────────────────

  const renderContent = () => {
    if (status === 'loading') {
      return <LoadingState />;
    }

    if (status === 'success' && stockResults.length > 0) {
      return (
        <div className="space-y-4">
          {envLevel && <EnvBadge />}
          <ResultsList />
        </div>
      );
    }

    if (status === 'success' && envLevel && stockResults.length === 0) {
      return (
        <div className="space-y-4">
          <EnvBadge />
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            <div className="text-center space-y-2">
              <div className="text-3xl">✅</div>
              {todayAction ? (
                <div className="space-y-1">
                  <p className="text-gray-400 font-medium">环境诊断完成</p>
                  <p className="text-xs text-gray-600">{todayAction}</p>
                </div>
              ) : (
                <p>环境诊断完成，可输入股票开始分析</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="space-y-4">
          <ErrorState />
        </div>
      );
    }

    return <EmptyState />;
  };

  const formatPollTime = (ts: number | null) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* ═══ 头部 ═══ */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent flex-shrink-0">
            🎯 xvqiu
          </span>
          <span className="text-xs text-gray-500 hidden sm:inline truncate">
            A股短线交易决策助手
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* 自动轮询切换 */}
          <button
            type="button"
            onClick={togglePolling}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
              isPolling
                ? 'text-green-400 bg-green-900/20 hover:bg-green-900/40'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
            title={isPolling ? '自动刷新已开启' : '开启自动刷新（每30秒）'}
          >
            <span className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
            <span className="hidden sm:inline">
              {isPolling ? '刷新中' : '自动刷新'}
            </span>
            {lastPollTime && isPolling && (
              <span className="text-[10px] text-gray-600 hidden sm:inline">
                {formatPollTime(lastPollTime)}
              </span>
            )}
          </button>

          {/* 历史记录 */}
          <HistoryPanel />

          {/* 设置 */}
          <SettingsPanel />

          {/* 连接状态 */}
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
              title={connected ? '已连接' : '断开'}
            />
            <span className="text-[10px] text-gray-600 hidden sm:inline">
              {connected ? '已连接' : '断开'}
            </span>
          </div>
        </div>
      </header>

      {/* ═══ 主体 ═══ */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        <StockInput />
        <QuickActions />
        <Watchlist />

        {(dailyPicksResult || dailyPicksLoading) && <DailyPicks />}

        {status === 'error' && <ErrorState />}
        {renderContent()}
      </main>

      {/* ═══ 底部 ═══ */}
      <footer className="flex items-center justify-between px-4 py-2 text-xs text-gray-600 border-t border-gray-800 flex-shrink-0">
        <span>v1.0.0</span>
        <span className="text-[10px] text-gray-700">
          {isPolling ? '🔄 数据每30秒自动刷新' : '⏸ 自动刷新已暂停'}
        </span>
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
