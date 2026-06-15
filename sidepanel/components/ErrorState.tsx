/**
 * ErrorState — 错误状态展示
 *
 * 增强版本 —— 按错误类型分类展示，提供针对性的处理建议和重试/降级操作
 * 支持的错误类型: network(网络) / auth(认证) / rate-limit(限流) / parse(解析) / timeout(超时) / unknown(未知)
 *
 * @module sidepanel/components/ErrorState
 */

import React, { useMemo, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';

// ═══════════════════════════════════════════════════════════════
// 错误类型分类 & 提示
// ═══════════════════════════════════════════════════════════════

type ErrorCategory = 'network' | 'auth' | 'rate-limit' | 'parse' | 'timeout' | 'empty' | 'unknown';

interface ErrorCategoryInfo {
  category: ErrorCategory;
  icon: string;
  title: string;
  suggestions: string[];
  /** 是否可重试 */
  retryable: boolean;
  /** 是否可降级 */
  degradable: boolean;
}

/** 根据错误消息分类 */
function categorizeError(message: string): ErrorCategoryInfo {
  const m = message.toLowerCase();

  // 网络错误
  if (m.includes('network') || m.includes('fetch') || m.includes('网络') || m.includes('econnrefused') || m.includes('enotfound') || m.includes('failed to fetch') || m.includes('网络连接')) {
    return {
      category: 'network',
      icon: '🌐',
      title: '网络连接异常',
      suggestions: ['检查网络连接状态', '确认东方财富/DeepSeek 服务可用', '切换网络环境(如从 WiFi 切到 4G)', '稍后重试'],
      retryable: true,
      degradable: true,
    };
  }

  // 认证错误
  if (m.includes('api key') || m.includes('auth') || m.includes('401') || m.includes('认证') || m.includes('key') || m.includes('未配置') || m.includes('Incorrect API key')) {
    return {
      category: 'auth',
      icon: '🔑',
      title: 'API Key 问题',
      suggestions: ['在设置中配置有效的 DeepSeek API Key', '检查 API Key 是否过期', '确认 API Key 有余额', '重新输入 API Key 后保存'],
      retryable: true,
      degradable: false,
    };
  }

  // 速率限制
  if (m.includes('rate') || m.includes('429') || m.includes('限流') || m.includes('too many') || m.includes('频率')) {
    return {
      category: 'rate-limit',
      icon: '⏳',
      title: '请求频率过高',
      suggestions: ['等待 30 秒后重试', '减少同时分析的股票数量', '降低使用频率'],
      retryable: true,
      degradable: true,
    };
  }

  // 超时
  if (m.includes('timeout') || m.includes('超时') || m.includes('timed out')) {
    return {
      category: 'timeout',
      icon: '⏰',
      title: '请求超时',
      suggestions: ['网络状态不稳定，请检查连接', '减少单次分析的股票数量', '稍后重试'],
      retryable: true,
      degradable: true,
    };
  }

  // 解析错误
  if (m.includes('parse') || m.includes('json') || m.includes('解析') || m.includes('格式')) {
    return {
      category: 'parse',
      icon: '📄',
      title: '数据解析异常',
      suggestions: ['刷新数据后重试', '检查股票代码格式是否正确', '确认输入内容无误'],
      retryable: true,
      degradable: true,
    };
  }

  // 空数据
  if (m.includes('empty') || m.includes('为空') || m.includes('no data') || m.includes('未找到') || m.includes('无数据')) {
    return {
      category: 'empty',
      icon: '📭',
      title: '数据为空',
      suggestions: ['确认股票代码是否正确(如 000063)', '检查股票是否存在', '确认输入不为空'],
      retryable: false,
      degradable: false,
    };
  }

  // 未知
  return {
    category: 'unknown',
    icon: '⚠️',
    title: '分析出错',
    suggestions: ['请稍后重试', '如果问题持续，尝试刷新 Side Panel', '检查 Service Worker 是否正常运行'],
    retryable: true,
    degradable: true,
  };
}

// ═══════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════

const ErrorState: React.FC = () => {
  const { errorMessage, status, setError, clearResults, setStatus, setCurrentAction } = useAppStore();

  const errorInfo = useMemo(() => {
    if (!errorMessage) return null;
    return categorizeError(errorMessage);
  }, [errorMessage]);

  // ─── 重试操作 ─────────────────────────────

  const handleRetry = useCallback(() => {
    if (!errorInfo?.retryable) return;
    // 清除错误，切换回 idle 让用户重新操作
    setError(null);
    setStatus('idle');
    setCurrentAction('none');
  }, [errorInfo, setError, setStatus, setCurrentAction]);

  // ─── 降级操作（使用离线模式/缓存数据） ────

  const handleDegrade = useCallback(() => {
    if (!errorInfo?.degradable) return;
    // 设置一个降级提示，显示为警告而非错误
    setError(null);
    setStatus('idle');
    setCurrentAction('none');
    // 后续可在此触发缓存模式分析
  }, [errorInfo, setError, setStatus, setCurrentAction]);

  // ─── 渲染 ─────────────────────────────────

  if (status !== 'error' || !errorMessage || !errorInfo) return null;

  const { icon, title, suggestions, retryable, degradable } = errorInfo;

  return (
    <section className="space-y-3 animate-fade-in">
      {/* 错误卡片 */}
      <div className="bg-no-buy/10 border border-no-buy/20 rounded-lg p-4 space-y-3">
        {/* 头部 — 图标 + 标题 */}
        <div className="flex items-center gap-2">
          <span className="text-lg flex-shrink-0">{icon}</span>
          <span className="text-sm font-medium text-no-buy">{title}</span>
          {/* 错误分类标签 */}
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
            {errorInfo.category}
          </span>
        </div>

        {/* 错误详情 — 可收缩 */}
        <details className="group">
          <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 transition-colors select-none">
            错误详情
            <span className="ml-1 text-gray-700 group-open:hidden">▶</span>
            <span className="ml-1 text-gray-700 hidden group-open:inline">▼</span>
          </summary>
          <p className="mt-2 text-xs text-gray-400 bg-gray-900/50 rounded p-2 font-mono leading-relaxed break-all select-text">
            {errorMessage}
          </p>
        </details>

        {/* 针对性建议 */}
        <div className="text-[11px] text-gray-500 space-y-1">
          <p className="font-medium text-gray-600">💡 建议：</p>
          <ul className="space-y-0.5 pl-4">
            {suggestions.map((s, i) => (
              <li key={i} className="list-disc">{s}</li>
            ))}
          </ul>
        </div>

        {/* 操作按钮 — 根据错误类型定制 */}
        <div className="flex gap-2 pt-1">
          {/* 关闭按钮（始终显示） */}
          <button
            type="button"
            onClick={() => setError(null)}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
          >
            关闭
          </button>

          {/* 重试按钮（可重试的错误显示） */}
          {retryable && (
            <button
              type="button"
              onClick={handleRetry}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              重试
            </button>
          )}

          {/* 降级按钮（可降级的错误显示） */}
          {degradable && (
            <button
              type="button"
              onClick={handleDegrade}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-yellow-600 border border-yellow-600/30 rounded-lg hover:bg-yellow-900/20 transition-colors"
            >
              使用本地数据
            </button>
          )}

          {/* 清除结果按钮 */}
          <button
            type="button"
            onClick={clearResults}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors"
            title="清除结果并重置"
          >
            清除
          </button>
        </div>
      </div>

      {/* 友情提示 — 如果是 API Key 问题，提醒配置 */}
      {errorInfo.category === 'auth' && (
        <div className="bg-yellow-900/20 border border-yellow-600/20 rounded-lg p-3 text-xs text-yellow-600">
          <p className="flex items-center gap-1.5">
            <span>💡</span>
            <span>点击右上角齿轮图标 ⚙️ 配置 API Key 后重试</span>
          </p>
        </div>
      )}
    </section>
  );
};

export default ErrorState;
