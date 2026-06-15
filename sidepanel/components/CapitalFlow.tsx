/**
 * CapitalFlow — 资金流向面板
 * 北向资金净流入 + 板块资金排名 + 主力净流入 TOP20
 *
 * @module sidepanel/components/CapitalFlow
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ThsAdapter } from '../../data/ths';
import type { StockFlow } from '../../utils/types';

// ═══════════════════════════════════════════════════════════════
// 北向资金数据类型
// ═══════════════════════════════════════════════════════════════

interface NorthboundFlow {
  northAmount: number;
  southAmount: number;
  totalAmount: number;
  updatedAt: number;
}

/** 板块资金流 */
interface SectorFlowItem {
  name: string;
  capitalFlow: number;
  changePercent: number;
  leadingStock: string;
}

// ═══════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════

const thsAdapter = new ThsAdapter();

const CapitalFlow: React.FC = () => {
  const [northbound, setNorthbound] = useState<NorthboundFlow | null>(null);
  const [sectorRanks, setSectorRanks] = useState<SectorFlowItem[]>([]);
  const [topStocks, setTopStocks] = useState<StockFlow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'north' | 'sector' | 'stock'>('north');

  // ─── 加载数据 ─────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [nb, sectorData, stockData] = await Promise.all([
        thsAdapter.getNorthboundFlow().catch(() => null),
        thsAdapter.getSectorCapitalFlowRanking().catch(() => []),
        thsAdapter.getTopCapitalInflowStocks().catch(() => []),
      ]);

      if (nb) setNorthbound(nb);
      setSectorRanks(
        sectorData.map((s) => ({
          name: s.name,
          capitalFlow: s.capitalFlow || 0,
          changePercent: s.changePercent,
          leadingStock: s.leadingStock,
        })),
      );
      setTopStocks(stockData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取资金流向数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── 渲染 ─────────────────────────────────

  return (
    <div className="card space-y-3 animate-fade-in">
      {/* ═══ 标题 ═══ */}
      <div className="flex items-center gap-2">
        <span className="text-lg">💧</span>
        <span className="text-sm font-bold text-cyan-400">资金流向</span>
        <button
          type="button"
          onClick={fetchData}
          disabled={loading}
          className="ml-auto px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 bg-gray-800 rounded disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {/* ═══ 加载中 ═══ */}
      {loading && (
        <div className="text-center py-4 text-gray-500 text-xs">
          <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-2" />
          获取资金流向数据中...
        </div>
      )}

      {/* ═══ 错误提示 ═══ */}
      {error && (
        <div className="text-xs text-orange-400 bg-orange-900/10 border border-orange-800/30 rounded-lg p-3">
          ⚠️ {error}
        </div>
      )}

      {/* ═══ 北向资金概览 ═══ */}
      {northbound && (
        <div className="bg-blue-900/10 border border-blue-800/20 rounded-lg p-3">
          <div className="text-[11px] text-blue-400 font-medium mb-2">🏦 北向资金</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className={`text-lg font-bold ${northbound.northAmount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {northbound.northAmount >= 0 ? '+' : ''}{northbound.northAmount.toFixed(1)}亿
              </div>
              <div className="text-[9px] text-gray-500">沪股通</div>
            </div>
            <div>
              <div className={`text-lg font-bold ${northbound.southAmount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {northbound.southAmount >= 0 ? '+' : ''}{northbound.southAmount.toFixed(1)}亿
              </div>
              <div className="text-[9px] text-gray-500">深股通</div>
            </div>
            <div>
              <div className={`text-lg font-bold ${northbound.totalAmount >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {northbound.totalAmount >= 0 ? '+' : ''}{northbound.totalAmount.toFixed(1)}亿
              </div>
              <div className="text-[9px] text-gray-500">合计</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 选项卡 ═══ */}
      <div className="flex gap-1 border-b border-gray-800 pb-1">
        {[
          { key: 'north' as const, label: '北向资金' },
          { key: 'sector' as const, label: '板块排行' },
          { key: 'stock' as const, label: '个股TOP20' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-2.5 py-1 text-xs rounded-t transition-colors ${
              activeTab === tab.key
                ? 'text-cyan-400 bg-cyan-900/10 border-b-2 border-cyan-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ 北向资金详细 ═══ */}
      {activeTab === 'north' && (
        <div className="text-[11px] text-gray-500 text-center py-2">
          {northbound ? (
            <div>
              <p>更新时间: {new Date(northbound.updatedAt).toLocaleTimeString('zh-CN')}</p>
              <p className="text-[10px] text-gray-700 mt-1">
                北向资金 = 通过沪港通/深港通北上买入A股的境外资金
              </p>
            </div>
          ) : (
            <p>暂无数据</p>
          )}
        </div>
      )}

      {/* ═══ 板块资金排名 ═══ */}
      {activeTab === 'sector' && (
        <div className="max-h-52 overflow-y-auto">
          {sectorRanks.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-1 pr-1">#</th>
                  <th className="text-left py-1 pr-1">板块</th>
                  <th className="text-right py-1 pr-1">涨幅</th>
                  <th className="text-right py-1">净流入</th>
                </tr>
              </thead>
              <tbody>
                {sectorRanks.slice(0, 15).map((item, i) => (
                  <tr key={item.name} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                    <td className="py-1 pr-1 text-gray-600">{i + 1}</td>
                    <td className="py-1 pr-1 text-gray-300 truncate max-w-[80px]">{item.name}</td>
                    <td className={`py-1 pr-1 text-right font-mono ${item.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(1)}%
                    </td>
                    <td className={`py-1 text-right font-mono ${item.capitalFlow >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {item.capitalFlow >= 0 ? '+' : ''}{(item.capitalFlow / 10000).toFixed(1)}亿
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-4 text-gray-600 text-xs">
              <p>暂无板块资金流数据</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ 个股主力净流入 TOP20 ═══ */}
      {activeTab === 'stock' && (
        <div className="max-h-52 overflow-y-auto">
          {topStocks.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-1 pr-1">#</th>
                  <th className="text-left py-1 pr-1">名称</th>
                  <th className="text-right py-1 pr-1">涨幅</th>
                  <th className="text-right py-1">净流入</th>
                </tr>
              </thead>
              <tbody>
                {topStocks.slice(0, 20).map((item, i) => (
                  <tr key={item.code || i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                    <td className="py-1 pr-1 text-gray-600">{i + 1}</td>
                    <td className="py-1 pr-1">
                      <span className="text-gray-200">{item.name}</span>
                      <span className="text-[9px] text-gray-600 ml-1 font-mono">{item.code}</span>
                    </td>
                    <td className={`py-1 pr-1 text-right font-mono ${item.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(1)}%
                    </td>
                    <td className={`py-1 text-right font-mono ${item.netInflow >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {item.netInflow >= 0 ? '+' : ''}{(item.netInflow / 10000).toFixed(1)}亿
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-4 text-gray-600 text-xs">
              <div className="text-xl mb-1">🔍</div>
              <p>暂无个股资金流数据</p>
              <p className="text-[10px] text-gray-700 mt-1">数据源不可用时展示板块领涨股替代</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CapitalFlow;
