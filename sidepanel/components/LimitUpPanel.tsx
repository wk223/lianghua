/**
 * LimitUpPanel — 涨停板复盘面板
 * 今日涨停股全景 + 连板天梯 + 炸板率统计
 *
 * @module sidepanel/components/LimitUpPanel
 */

import React, { useCallback, useEffect, useState } from 'react';
import { limitUpAdapter, type LimitUpOverview, type LimitUpStock, type BoardTier } from '../../data/limitup';

// ═══════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════

const LimitUpPanel: React.FC = () => {
  const [data, setData] = useState<LimitUpOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'tiers' | 'breakdown'>('overview');

  // ─── 加载数据 ─────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await limitUpAdapter.getOverview();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取涨停板数据失败');
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
        <span className="text-lg">📈</span>
        <span className="text-sm font-bold text-red-400">涨停板复盘</span>
        <span className="text-[10px] text-gray-600 ml-auto">
          {data ? `数据源: ${data.source}` : ''}
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
          <div className="animate-spin w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full mx-auto mb-2" />
          获取涨停板数据中...
        </div>
      )}

      {/* ═══ 错误提示 ═══ */}
      {error && (
        <div className="text-xs text-orange-400 bg-orange-900/10 border border-orange-800/30 rounded-lg p-3">
          ⚠️ {error}
        </div>
      )}

      {/* ═══ 数据展示 ═══ */}
      {data && !loading && (
        <>
          {/* 概览统计 */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="涨停" value={data.totalCount} unit="家" color="red" />
            <StatCard label="炸板" value={data.breakCount} unit="家" color="orange" />
            <StatCard label="炸板率" value={Math.round(data.breakRate * 100)} unit="%" color="yellow" />
            <StatCard label="一字板" value={data.yiZiCount} unit="家" color="rose" />
          </div>

          {/* 选项卡 */}
          <div className="flex gap-1 border-b border-gray-800 pb-1">
            {[
              { key: 'overview' as const, label: '涨停全景' },
              { key: 'tiers' as const, label: '连板天梯' },
              { key: 'breakdown' as const, label: '板块分布' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-2.5 py-1 text-xs rounded-t transition-colors ${
                  activeTab === tab.key
                    ? 'text-red-400 bg-red-900/10 border-b-2 border-red-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 内容区 */}
          {activeTab === 'overview' && <LimitUpTable stocks={data.stocks} />}
          {activeTab === 'tiers' && <BoardTiersView tiers={data.boardTiers} />}
          {activeTab === 'breakdown' && <SectorBreakdown distribution={data.sectorDistribution} />}
        </>
      )}

      {/* ═══ 空态 ═══ */}
      {!data && !loading && !error && (
        <div className="text-center py-4 text-gray-600 text-xs">
          <div className="text-xl mb-1">📊</div>
          <p>点击刷新获取最新涨停板数据</p>
          <p className="text-[10px] text-gray-700 mt-1">非交易时段可能无数据</p>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 统计卡片子组件
// ═══════════════════════════════════════════════════════════════

interface StatCardProps {
  label: string;
  value: number | string;
  unit: string;
  color: 'red' | 'orange' | 'yellow' | 'rose' | 'green';
}

const colorMap: Record<string, string> = {
  red: 'text-red-400 bg-red-900/10 border-red-800/20',
  orange: 'text-orange-400 bg-orange-900/10 border-orange-800/20',
  yellow: 'text-yellow-400 bg-yellow-900/10 border-yellow-800/20',
  rose: 'text-rose-400 bg-rose-900/10 border-rose-800/20',
  green: 'text-green-400 bg-green-900/10 border-green-800/20',
};

const StatCard: React.FC<StatCardProps> = ({ label, value, unit, color }) => (
  <div className={`text-center p-2 rounded-lg border ${colorMap[color] || colorMap.red}`}>
    <div className="text-lg font-bold">{value}{unit}</div>
    <div className="text-[10px] opacity-70">{label}</div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 涨停全景表格
// ═══════════════════════════════════════════════════════════════

interface LimitUpTableProps {
  stocks: LimitUpStock[];
}

const LimitUpTable: React.FC<LimitUpTableProps> = ({ stocks }) => {
  if (stocks.length === 0) {
    return (
      <div className="text-center py-4 text-gray-600 text-xs">
        <div className="text-xl mb-1">🔍</div>
        <p>暂无涨停股数据</p>
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-gray-900">
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-1.5 pr-1">代码</th>
            <th className="text-left py-1.5 pr-1">名称</th>
            <th className="text-right py-1.5 pr-1">涨幅</th>
            <th className="text-right py-1.5 pr-1">封板</th>
            <th className="text-right py-1.5 pr-1">封单</th>
            <th className="text-left py-1.5">板块</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock, i) => (
            <tr
              key={stock.code || i}
              className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors"
            >
              <td className="py-1.5 pr-1 font-mono text-gray-500">{stock.code}</td>
              <td className="py-1.5 pr-1 font-medium text-gray-200">{stock.name}</td>
              <td className={`py-1.5 pr-1 text-right font-mono ${stock.changePercent >= 9.8 ? 'text-red-400' : 'text-orange-400'}`}>
                {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
              </td>
              <td className="py-1.5 pr-1 text-right text-gray-400 font-mono">
                {stock.boardTime || '-'}
              </td>
              <td className="py-1.5 pr-1 text-right text-gray-400 font-mono">
                {stock.sealAmount > 0 ? `${(stock.sealAmount / 10000).toFixed(1)}万` : '-'}
              </td>
              <td className="py-1.5 text-gray-500 truncate max-w-[100px]" title={stock.sector}>
                {stock.sector}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 连板天梯视图
// ═══════════════════════════════════════════════════════════════

interface BoardTiersViewProps {
  tiers: BoardTier[];
}

const BoardTiersView: React.FC<BoardTiersViewProps> = ({ tiers }) => {
  if (tiers.length === 0) {
    return (
      <div className="text-center py-4 text-gray-600 text-xs">
        <div className="text-xl mb-1">🏗️</div>
        <p>暂无法获取连板数据</p>
        <p className="text-[10px] text-gray-700 mt-1">需额外连板数据源</p>
      </div>
    );
  }

  const tierColors: Record<number, string> = {
    4: 'bg-red-900/20 border-red-700/40 text-red-300',
    3: 'bg-orange-900/20 border-orange-700/40 text-orange-300',
    2: 'bg-yellow-900/20 border-yellow-700/40 text-yellow-300',
    1: 'bg-gray-800/50 border-gray-700/40 text-gray-300',
  };

  const tierBadgeColors: Record<number, string> = {
    4: 'bg-red-600 text-white',
    3: 'bg-orange-600 text-white',
    2: 'bg-yellow-600 text-black',
    1: 'bg-gray-700 text-gray-300',
  };

  return (
    <div className="space-y-2">
      {tiers.map((tier) => (
        <div
          key={tier.count}
          className={`rounded-lg border p-2 ${tierColors[tier.count] || tierColors[1]}`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${tierBadgeColors[tier.count] || tierBadgeColors[1]}`}>
              {tier.label}
            </span>
            <span className="text-[10px] opacity-60">{tier.stocks.length}只</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {tier.stocks.map((stock) => (
              <span
                key={stock.code}
                className="px-1.5 py-0.5 text-[10px] bg-black/20 rounded"
                title={stock.sector}
              >
                {stock.name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 板块分布视图
// ═══════════════════════════════════════════════════════════════

interface SectorBreakdownProps {
  distribution: Array<{ sector: string; count: number }>;
}

const SectorBreakdown: React.FC<SectorBreakdownProps> = ({ distribution }) => {
  if (distribution.length === 0) {
    return (
      <div className="text-center py-4 text-gray-600 text-xs">
        <p>暂无板块分布数据</p>
      </div>
    );
  }

  const maxCount = Math.max(...distribution.map((d) => d.count));

  return (
    <div className="space-y-1.5 max-h-52 overflow-y-auto">
      {distribution.map((item) => (
        <div key={item.sector} className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 w-20 truncate" title={item.sector}>
            {item.sector}
          </span>
          <div className="flex-1 h-4 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all"
              style={{ width: `${(item.count / maxCount) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-gray-400 w-6 text-right">
            {item.count}
          </span>
        </div>
      ))}
    </div>
  );
};

export default LimitUpPanel;
