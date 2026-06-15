/**
 * Watchlist — 自选股管理组件 (Web 版)
 * 使用 localStorage 持久化
 *
 * @module sidepanel/components/Watchlist
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { analysisEngine } from '../../engine';

// ═══════════════════════════════════════════════════════════════
// 自选股条目接口
// ═══════════════════════════════════════════════════════════════

export interface WatchlistItem {
  code: string;
  name: string;
  addedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// Storage 工具函数 (localStorage)
// ═══════════════════════════════════════════════════════════════

const WATCHLIST_KEY = 'xvqiu_watchlist';

function loadWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list: WatchlistItem[]): void {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  } catch {
    // 存储失败静默处理
  }
}

/** 解析用户输入的股票代码/名称 */
function parseStockInput(input: string): { code: string; name: string } {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0];
    const second = parts[1];
    if (/^\d{6}$/.test(first) || /^(sh|sz|SH|SZ|bj|BJ)\d{6}$/.test(first)) {
      return { code: first, name: second };
    }
    return { code: second, name: first };
  }
  if (/^\d{6}$/.test(trimmed)) {
    return { code: trimmed, name: trimmed };
  }
  return { code: trimmed, name: trimmed };
}

// ═══════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════

const Watchlist: React.FC = () => {
  const { singleInput, setSingleInput, setStatus, setError, setCurrentAction } = useAppStore();

  const [list, setList] = useState<WatchlistItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [addInput, setAddInput] = useState('');

  // ─── 首次加载 ─────────────────────────────

  useEffect(() => {
    setList(loadWatchlist());
  }, []);

  // ─── 添加自选股 ──────────────────────────

  const handleAdd = useCallback(async () => {
    if (!addInput.trim()) return;

    const parsed = parseStockInput(addInput);
    if (!parsed.code) return;

    // 去重
    if (list.some((item) => item.code === parsed.code)) {
      setAddInput('');
      return;
    }

    const newItem: WatchlistItem = {
      code: parsed.code,
      name: parsed.name || parsed.code,
      addedAt: Date.now(),
    };

    const newList = [...list, newItem];
    setList(newList);
    saveWatchlist(newList);
    setAddInput('');
  }, [addInput, list]);

  // ─── 删除自选股 ──────────────────────────

  const handleRemove = useCallback(
    async (code: string) => {
      const newList = list.filter((item) => item.code !== code);
      setList(newList);
      saveWatchlist(newList);
    },
    [list],
  );

  // ─── 快捷分析 ────────────────────────────

  const handleQuickAnalyze = useCallback(
    async (item: WatchlistItem) => {
      setSingleInput(item.code);
      setStatus('loading');
      setCurrentAction('analyze');
      setError(null);

      try {
        const result = await analysisEngine.analyzePool({
          stocks: [item.code],
        });
        useAppStore.getState().setAnalysisResult(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : '分析请求失败');
      } finally {
        setCurrentAction('none');
      }
    },
    [setSingleInput, setStatus, setCurrentAction, setError],
  );

  // ─── 键盘事件 ────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAdd();
      }
      if (e.key === 'Escape') {
        setExpanded(false);
      }
    },
    [handleAdd],
  );

  // ─── 渲染 ─────────────────────────────────

  return (
    <section className="space-y-2">
      {/* 折叠标题 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-xs text-gray-500 hover:text-gray-400 transition-colors px-1"
      >
        <svg
          className={`w-3 h-3 transition-transform duration-150 ${
            expanded ? 'rotate-90' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>自选股</span>
        <span className="text-gray-700">({list.length})</span>
      </button>

      {/* 展开内容 */}
      <div
        className={`overflow-hidden transition-all duration-200 ${
          expanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-2 pl-3 border-l-2 border-gray-800">
          {/* 添加输入区 */}
          <div className="flex gap-2">
            <input
              type="text"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入代码或名称添加"
              className="flex-1 px-2.5 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-gray-600"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!addInput.trim()}
              className="px-2.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              添加
            </button>
          </div>

          {/* 自选股列表 */}
          {list.length === 0 ? (
            <p className="text-[11px] text-gray-600 text-center py-2">
              暂无自选股，在上方输入代码添加
            </p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {list.map((item) => (
                <div
                  key={item.code}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-800/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-gray-300">{item.name}</span>
                    <span className="text-[10px] text-gray-600 ml-1.5 font-mono">
                      {item.code}
                    </span>
                  </div>

                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleQuickAnalyze(item)}
                      className="px-2 py-0.5 text-[10px] font-medium text-blue-400 bg-blue-900/20 rounded hover:bg-blue-900/40 transition-colors"
                      title="快速分析"
                    >
                      分析
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(item.code)}
                      className="px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-no-buy hover:bg-no-buy/10 rounded transition-colors"
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default Watchlist;
