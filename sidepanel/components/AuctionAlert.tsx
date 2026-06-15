/**
 * AuctionAlert — 竞价异动面板
 * 显示当日集合竞价异常信号
 *
 * ⚠️ 设计说明:
 * 同花顺/东方财富 公开 API 未提供集合竞价实时数据接口
 * 集合竞价数据通常在 9:15-9:25 之间通过 Level-2 行情提供
 * 本组件实现框架 + 模拟数据 + 接口预留
 *
 * 未来接入方式:
 *   1. Level-2 行情接口 (需付费)
 *   2. 通过同花顺/东方财富 WebSocket 订阅
 *   3. 爬取交易日历 + 竞价页面
 *
 * @module sidepanel/components/AuctionAlert
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { AuctionAlertItem } from '../../utils/types';

// ═══════════════════════════════════════════════════════════════
// 模拟数据（用于展示框架）
// ═══════════════════════════════════════════════════════════════

const MOCK_ALERTS: AuctionAlertItem[] = [
  {
    code: '600519',
    name: '贵州茅台',
    type: '高开',
    description: '竞价阶段高开 +3.2%，高于昨日收盘价',
    alertLevel: 'important',
    auctionChange: 3.2,
    auctionVolume: 12500,
    time: '09:20',
  },
  {
    code: '000858',
    name: '五粮液',
    type: '竞价量异常',
    description: '竞价量达到昨日日均量的 4.5 倍',
    alertLevel: 'important',
    auctionChange: 2.1,
    auctionVolume: 23800,
    time: '09:22',
  },
  {
    code: '002415',
    name: '海康威视',
    type: '大单试盘',
    description: '竞价阶段出现单笔 5000 手以上大单',
    alertLevel: 'warning',
    auctionChange: 1.5,
    auctionVolume: 8900,
    time: '09:18',
  },
];

// ═══════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════

const AuctionAlert: React.FC = () => {
  const [alerts, setAlerts] = useState<AuctionAlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingMock, setUsingMock] = useState(false);
  const [filter, setFilter] = useState<'all' | 'critical' | 'important'>('all');

  // ─── 加载数据 ─────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);

    try {
      // ── 预留: 真实数据源接入点 ──
      //  const data = await auctionDataAdapter.getAlerts();
      //  setAlerts(data);
      //  setUsingMock(false);

      // 目前使用模拟数据展示框架
      await new Promise((r) => setTimeout(r, 800));
      setAlerts(MOCK_ALERTS);
      setUsingMock(true);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── 过滤 ────────────────────────────────

  const filteredAlerts =
    filter === 'all' ? alerts : alerts.filter((a) => a.alertLevel === filter);

  // ─── 渲染 ─────────────────────────────────

  return (
    <div className="card space-y-3 animate-fade-in">
      {/* ═══ 标题 ═══ */}
      <div className="flex items-center gap-2">
        <span className="text-lg">⏰</span>
        <span className="text-sm font-bold text-purple-400">竞价异动</span>
        <span className="text-[10px] text-gray-600 ml-auto">
          {usingMock ? '📐 框架展示' : '实时'}
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

      {/* ═══ 数据源说明 ═══ */}
      <div className="bg-yellow-900/10 border border-yellow-800/20 rounded-lg p-2">
        <div className="text-[10px] text-yellow-400 font-medium mb-1">⚠️ 数据源说明</div>
        <p className="text-[9px] text-yellow-600/80 leading-relaxed">
          集合竞价实时数据需 Level-2 行情接口支持。
          目前展示模拟数据说明框架结构。
          真实数据接入方式:
        </p>
        <ul className="text-[9px] text-yellow-600/60 mt-1 space-y-0.5 list-disc list-inside">
          <li>Level-2 行情 WebSocket (推荐)</li>
          <li>同花顺/东方财富竞价页面爬取</li>
          <li>付费数据 API</li>
        </ul>
      </div>

      {/* ═══ 加载中 ═══ */}
      {loading && (
        <div className="text-center py-4 text-gray-500 text-xs">
          <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2" />
          加载竞价数据...
        </div>
      )}

      {/* ═══ 过滤 ═══ */}
      {alerts.length > 0 && (
        <div className="flex gap-1">
          {[
            { key: 'all' as const, label: '全部' },
            { key: 'important' as const, label: '重要' },
            { key: 'critical' as const, label: '紧急' },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`text-[10px] px-2 py-0.5 rounded ${
                filter === f.key ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-gray-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* ═══ 告警列表 ═══ */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {filteredAlerts.length > 0 ? (
          filteredAlerts.map((alert, i) => (
            <AlertCard key={i} alert={alert} />
          ))
        ) : (
          <div className="text-center py-4 text-gray-600 text-xs">
            <div className="text-xl mb-1">🔍</div>
            <p>暂无匹配的竞价异动信号</p>
            <p className="text-[10px] text-gray-700 mt-1">竞价时间段: 9:15 - 9:25</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 告警卡片子组件
// ═══════════════════════════════════════════════════════════════

interface AlertCardProps {
  alert: AuctionAlertItem;
}

const levelConfig: Record<string, { border: string; bg: string; dot: string; label: string }> = {
  critical: {
    border: 'border-red-800/40',
    bg: 'bg-red-900/10',
    dot: 'bg-red-500',
    label: '紧急',
  },
  important: {
    border: 'border-orange-800/40',
    bg: 'bg-orange-900/10',
    dot: 'bg-orange-500',
    label: '重要',
  },
  warning: {
    border: 'border-yellow-800/40',
    bg: 'bg-yellow-900/10',
    dot: 'bg-yellow-500',
    label: '关注',
  },
};

const typeIcons: Record<string, string> = {
  '高开': '🚀',
  '竞价量异常': '📊',
  '大单试盘': '💎',
  '跌停开': '💀',
  '其他': '📌',
};

const AlertCard: React.FC<AlertCardProps> = ({ alert }) => {
  const cfg = levelConfig[alert.alertLevel] || levelConfig.warning;

  return (
    <div className={`rounded-lg border p-2.5 ${cfg.border} ${cfg.bg}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} flex-shrink-0`} />
        <span className="text-xs font-medium text-gray-200">{alert.name}</span>
        <span className="text-[10px] text-gray-500 font-mono">{alert.code}</span>
        <span className="ml-auto text-[9px] text-gray-600">{alert.time}</span>
      </div>

      <div className="mt-1 flex items-center gap-1">
        <span className="text-[11px]">{typeIcons[alert.type] || '📌'}</span>
        <span className="text-[11px] font-medium text-purple-400">{alert.type}</span>
        <span className={`text-[11px] font-mono ${alert.auctionChange >= 0 ? 'text-red-400' : 'text-green-400'}`}>
          {alert.auctionChange >= 0 ? '+' : ''}{alert.auctionChange.toFixed(1)}%
        </span>
        <span className="text-[10px] text-gray-600 ml-auto">
          量: {alert.auctionVolume > 10000 ? `${(alert.auctionVolume / 10000).toFixed(1)}万` : alert.auctionVolume}手
        </span>
      </div>

      <div className="mt-1 text-[10px] text-gray-500">{alert.description}</div>
    </div>
  );
};

export default AuctionAlert;
