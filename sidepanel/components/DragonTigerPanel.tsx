/**
 * DragonTigerPanel — 龙虎榜分析面板
 * 当日龙虎榜上榜股票 + 净买入额排名 + 知名游资标记
 *
 * @module sidepanel/components/DragonTigerPanel
 */

import React, { useCallback, useEffect, useState } from 'react';
import { dragonTigerAdapter, type DragonTigerOverview, type DragonTigerStock } from '../../data/dragontiger';

// ═══════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════

const DragonTigerPanel: React.FC = () => {
  const [data, setData] = useState<DragonTigerOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'netBuy' | 'changePercent'>('netBuy');

  // ─── 加载数据 ─────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await dragonTigerAdapter.getOverview();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取龙虎榜数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── 排序 ────────────────────────────────

  const sortedStocks = data
    ? [...data.stocks].sort((a, b) =>
        sortBy === 'netBuy' ? b.netBuyAmount - a.netBuyAmount : Math.abs(b.changePercent) - Math.abs(a.changePercent),
      )
    : [];

  // ─── 渲染 ─────────────────────────────────

  return (
    <div className="card space-y-3 animate-fade-in">
      {/* ═══ 标题 ═══ */}
      <div className="flex items-center gap-2">
        <span className="text-lg">🐉</span>
        <span className="text-sm font-bold text-yellow-400">龙虎榜分析</span>
        <span className="text-[10px] text-gray-600 ml-auto">
          {data ? `${data.totalCount}只 · ${data.source}` : ''}
        </span>
        <button
          type="button"
          onClick={fetchData}
          disabled={loading}
          className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 bg-gray-800 rounded disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {/* ═══ 加载中 ═══ */}
      {loading && (
        <div className="text-center py-4 text-gray-500 text-xs">
          <div className="animate-spin w-5 h-5 border-2 border-yellow-500 border-t-transparent rounded-full mx-auto mb-2" />
          获取龙虎榜数据中...
        </div>
      )}

      {/* ═══ 错误提示 ═══ */}
      {error && (
        <div className="text-xs text-orange-400 bg-orange-900/10 border border-orange-800/30 rounded-lg p-3">
          ⚠️ {error}
        </div>
      )}

      {/* ═══ 知名游资统计 ═══ */}
      {data && data.famousStats.length > 0 && (
        <div className="bg-purple-900/10 border border-purple-800/20 rounded-lg p-2">
          <div className="text-[10px] text-purple-400 mb-1 font-medium">🏦 知名游资动态</div>
          <div className="flex flex-wrap gap-1">
            {data.famousStats.map((stat) => (
              <span
                key={stat.name}
                className="px-1.5 py-0.5 text-[10px] bg-purple-900/20 text-purple-300 rounded"
                title={`净买入 ${(stat.totalNetBuy / 10000).toFixed(1)}亿`}
              >
                {stat.name} ✕{stat.appearCount}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 净买入/卖出 TOP5 ═══ */}
      {data && data.topBuy.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-green-900/10 border border-green-800/20 rounded-lg p-2">
            <div className="text-[10px] text-green-400 mb-1 font-medium">💰 净买入 TOP5</div>
            {data.topBuy.map((stock, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                <span className="text-gray-300 truncate max-w-[80px]">{stock.name}</span>
                <span className="text-green-400 font-mono">+{(stock.netBuyAmount / 10000).toFixed(1)}亿</span>
              </div>
            ))}
          </div>
          <div className="bg-red-900/10 border border-red-800/20 rounded-lg p-2">
            <div className="text-[10px] text-red-400 mb-1 font-medium">💸 净卖出 TOP5</div>
            {data.topSell.map((stock, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                <span className="text-gray-300 truncate max-w-[80px]">{stock.name}</span>
                <span className="text-red-400 font-mono">{(stock.netBuyAmount / 10000).toFixed(1)}亿</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 排序切换 ═══ */}
      {data && data.stocks.length > 0 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSortBy('netBuy')}
            className={`text-[10px] px-2 py-0.5 rounded ${
              sortBy === 'netBuy' ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-gray-500'
            }`}
          >
            按净买入
          </button>
          <button
            type="button"
            onClick={() => setSortBy('changePercent')}
            className={`text-[10px] px-2 py-0.5 rounded ${
              sortBy === 'changePercent' ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-gray-500'
            }`}
          >
            按涨幅
          </button>
        </div>
      )}

      {/* ═══ 上榜股票列表 ═══ */}
      {data && data.stocks.length > 0 ? (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-1.5 pr-1">名称</th>
                <th className="text-right py-1.5 pr-1">涨幅</th>
                <th className="text-right py-1.5 pr-1">净买入</th>
                <th className="text-left py-1.5">原因</th>
              </tr>
            </thead>
            <tbody>
              {sortedStocks.map((stock, i) => (
                <StockRow key={stock.code || i} stock={stock} />
              ))}
            </tbody>
          </table>
        </div>
      ) : data && !loading ? (
        <div className="text-center py-4 text-gray-600 text-xs">
          <div className="text-xl mb-1">🔍</div>
          <p>暂无龙虎榜数据</p>
          <p className="text-[10px] text-gray-700 mt-1">盘后更新</p>
        </div>
      ) : null}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 股票行子组件
// ═══════════════════════════════════════════════════════════════

interface StockRowProps {
  stock: DragonTigerStock;
}

const StockRow: React.FC<StockRowProps> = ({ stock }) => {
  const changeColor =
    stock.changePercent >= 9.8
      ? 'text-red-400'
      : stock.changePercent >= 5
        ? 'text-orange-400'
        : stock.changePercent >= 0
          ? 'text-green-400'
          : 'text-green-600';

  const buyColor = stock.netBuyAmount >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <tr className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
      <td className="py-1.5 pr-1">
        <div className="flex items-center gap-1">
          <span className="font-medium text-gray-200">{stock.name}</span>
          {stock.famousCapital.length > 0 && (
            <span className="text-[8px] px-1 py-0.5 bg-purple-900/30 text-purple-400 rounded" title={stock.famousCapital.join(', ')}>
              游资
            </span>
          )}
        </div>
        <div className="text-[9px] text-gray-600 font-mono">{stock.code}</div>
      </td>
      <td className={`py-1.5 pr-1 text-right font-mono ${changeColor}`}>
        {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
      </td>
      <td className={`py-1.5 pr-1 text-right font-mono ${buyColor}`}>
        {stock.netBuyAmount >= 0 ? '+' : ''}{(stock.netBuyAmount / 10000).toFixed(2)}亿
      </td>
      <td className="py-1.5 text-[9px] text-gray-500 truncate max-w-[100px]" title={stock.reasonCategory}>
        {stock.reasonCategory || '-'}
      </td>
    </tr>
  );
};

export default DragonTigerPanel;
