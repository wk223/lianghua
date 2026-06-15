/**
 * HistoryPanel — 历史记录面板
 *
 * 展示历史分析记录，支持回看和删除
 * 数据持久化到 localStorage
 *
 * @module sidepanel/components/HistoryPanel
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAppStore, type HistoryRecord } from '../stores/useAppStore';
import { storageManager } from '../../storage/manager';

const HistoryPanel: React.FC = () => {
  const {
    history,
    historyOpen,
    setHistory,
    addHistory,
    removeHistory,
    clearHistory,
    setHistoryOpen,
    toggleHistory,
    setAnalysisResult,
  } = useAppStore();

  // ─── 加载历史记录 ─────────────────────────

  useEffect(() => {
    if (historyOpen && history.length === 0) {
      const stored = storageManager.getHistory({ limit: 100 });
      if (stored && stored.length > 0) {
        setHistory(
          stored.map((r) => ({
            id: r.id,
            createdAt: r.createdAt,
            note: r.note,
            result: r.result,
          })),
        );
      }
    }
  }, [historyOpen, history.length, setHistory]);

  // ─── 回看历史记录 ─────────────────────────

  const handleRecall = useCallback(
    (record: HistoryRecord) => {
      setAnalysisResult(record.result);
      setHistoryOpen(false);
    },
    [setAnalysisResult, setHistoryOpen],
  );

  // ─── 删除单条 ─────────────────────────────

  const handleRemove = useCallback(
    (id: string) => {
      storageManager.removeHistory(id);
      removeHistory(id);
    },
    [removeHistory],
  );

  // ─── 清空全部 ─────────────────────────────

  const handleClear = useCallback(() => {
    storageManager.clearHistory();
    clearHistory();
  }, [clearHistory]);

  // ─── 格式化时间 ───────────────────────────

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // ─── 渲染 ─────────────────────────────────

  return (
    <>
      {/* 入口按钮 */}
      <button
        type="button"
        onClick={toggleHistory}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-800"
        title="历史记录"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="hidden sm:inline">历史</span>
        {history.length > 0 && (
          <span className="text-[10px] text-gray-600">({history.length})</span>
        )}
      </button>

      {/* 面板 */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl mx-4 mb-0 sm:mb-4 max-h-[75vh] flex flex-col animate-slide-up">
            {/* 标题 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-100">
                历史分析记录
                <span className="text-xs text-gray-500 ml-2">({history.length} 条)</span>
              </h2>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="text-[11px] text-gray-600 hover:text-no-buy transition-colors"
                  >
                    清空全部
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-800"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 列表 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {history.length === 0 ? (
                <div className="text-center py-8 text-gray-600 text-sm">
                  <div className="text-3xl mb-2">📭</div>
                  <p>暂无分析记录</p>
                  <p className="text-xs mt-1">完成分析后自动保存</p>
                </div>
              ) : (
                history.map((record) => {
                  const env = record.result.marketEnv;
                  const conclusions = record.result.conclusions || [];
                  const buyCount = conclusions.filter((c) => c.verdict === 'BUY').length;
                  const totalCount = conclusions.length;

                  return (
                    <div
                      key={record.id}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 transition-colors cursor-pointer border border-gray-800/50"
                      onClick={() => handleRecall(record)}
                    >
                      {/* 环境级别 */}
                      <span className={`inline-flex items-center justify-center w-8 h-8 text-xs font-bold rounded-md border flex-shrink-0 ${
                        env.envLevel === 'S' || env.envLevel === 'A'
                          ? 'bg-green-900/20 text-green-400 border-green-800/30'
                          : env.envLevel === 'B'
                            ? 'bg-yellow-900/20 text-yellow-400 border-yellow-800/30'
                            : 'bg-red-900/20 text-red-400 border-red-800/30'
                      }`}>
                        {env.envLevel}
                      </span>

                      {/* 信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-300 truncate">
                            {env.sentiment || '环境诊断'}
                          </span>
                          <span className="text-[10px] text-gray-600">
                            {formatTime(record.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-500">
                            {env.suggestion || ''}
                          </span>
                          {totalCount > 0 && (
                            <span className="text-[10px] text-gray-600">
                              · {totalCount} 只分析
                              {buyCount > 0 && (
                                <span className="text-green-500 ml-1">({buyCount} 可买)</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRecall(record);
                          }}
                          className="px-2 py-0.5 text-[10px] font-medium text-blue-400 bg-blue-900/20 rounded hover:bg-blue-900/40 transition-colors"
                        >
                          回看
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(record.id);
                          }}
                          className="px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-no-buy hover:bg-no-buy/10 rounded transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 底部提示 */}
            <div className="px-5 py-2 text-[10px] text-gray-700 text-center border-t border-gray-800 flex-shrink-0">
              点击记录可回看完整分析结果 | 分析结果自动保存 (最多 500 条)
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HistoryPanel;
