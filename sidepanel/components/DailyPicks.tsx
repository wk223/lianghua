/**
 * DailyPicks — 「今天买什么」推荐面板
 *
 * 展示 LLM 基于大盘环境 + 板块排名 + 领涨股分析得出的
 * 今日推荐板块及龙头股票
 *
 * @module sidepanel/components/DailyPicks
 */

import React from 'react';
import { useAppStore, envLevelToColor } from '../stores/useAppStore';
import type { DailyPickSector, DailyPickStock } from '../../utils/types';

const DailyPicks: React.FC = () => {
  const { dailyPicksResult, dailyPicksLoading } = useAppStore();

  // ─── 加载态 ─────────────────────────────
  if (dailyPicksLoading) {
    return (
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5 text-yellow-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-yellow-400 font-medium">🧠 AI 正在分析今日机会...</span>
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-gray-800 rounded animate-shimmer w-3/4" />
          <div className="h-4 bg-gray-800 rounded animate-shimmer w-1/2" />
          <div className="h-4 bg-gray-800 rounded animate-shimmer w-5/6" />
        </div>
        <div className="flex gap-2">
          <div className="h-20 flex-1 bg-gray-800 rounded animate-shimmer" />
          <div className="h-20 flex-1 bg-gray-800 rounded animate-shimmer" />
        </div>
        <p className="text-[10px] text-gray-600 text-center">
          正在获取板块数据并调用 AI 分析...
        </p>
      </div>
    );
  }

  if (!dailyPicksResult) return null;

  const { envSummary, envLevel, overallSuggestion, sectors } = dailyPicksResult;

  // ─── 渲染 ─────────────────────────────
  return (
    <div className="card space-y-4 animate-fade-in">
      {/* ═══ 标题 ═══ */}
      <div className="flex items-center gap-2">
        <span className="text-lg">📋</span>
        <span className="text-sm font-bold text-yellow-400">今天买什么</span>
        <span className="text-[10px] text-gray-600 ml-auto">
          {new Date(dailyPicksResult.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          更新
        </span>
      </div>

      {/* ═══ 大盘环境概括 ═══ */}
      <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-bold rounded-md border ${envLevelToColor(envLevel)}`}>
            {envLevel} 级
          </span>
          <span className="text-xs text-gray-400 flex-1">{envSummary}</span>
        </div>
        <div className="flex items-start gap-1.5 text-xs text-gray-500">
          <span className="mt-0.5">💡</span>
          <span>{overallSuggestion}</span>
        </div>
      </div>

      {/* ═══ 推荐板块列表 ═══ */}
      {sectors.length === 0 ? (
        <div className="text-center py-6 text-gray-600 text-sm">
          <div className="text-2xl mb-2">🔍</div>
          <p>AI 认为当前不建议出手</p>
          <p className="text-xs mt-1">等待更好的时机</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sectors.map((sector, idx) => (
            <SectorCard key={idx} sector={sector} index={idx} />
          ))}
        </div>
      )}

      {/* ═══ 底部提示 ═══ */}
      <div className="text-[10px] text-gray-700 text-center pt-1 border-t border-gray-800">
        仅供交易参考，不构成投资建议 | 注意控制仓位和风险
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 板块卡片子组件
// ═══════════════════════════════════════════════════════════════

interface SectorCardProps {
  sector: DailyPickSector;
  index: number;
}

const SectorCard: React.FC<SectorCardProps> = ({ sector, index }) => {
  const strengthBadgeClass =
    sector.logicStrength === '强'
      ? 'bg-green-900/30 text-green-400 border-green-800/40'
      : sector.logicStrength === '中'
        ? 'bg-yellow-900/30 text-yellow-400 border-yellow-800/40'
        : 'bg-gray-800 text-gray-400 border-gray-700/40';

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-hidden">
      {/* 板块头部 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/40 border-b border-gray-800/50">
        <span className="text-xs text-gray-500 font-mono">#{index + 1}</span>
        <span className="text-sm font-semibold text-gray-100">{sector.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${strengthBadgeClass}`}>
          {sector.logicStrength}
        </span>
        <span className="text-[10px] text-gray-600 ml-auto">{sector.logicStrength === '强' ? '🔥 重点关注' : sector.logicStrength === '中' ? '📌 可以参与' : '👀 适当关注'}</span>
      </div>

      {/* 推荐理由 */}
      <div className="px-3 py-2 text-xs text-gray-400 leading-relaxed border-b border-gray-800/30">
        {sector.reason}
      </div>

      {/* 个股列表 */}
      {sector.stocks.length > 0 && (
        <div className="divide-y divide-gray-800/30">
          {sector.stocks.map((stock, si) => (
            <StockItem key={si} stock={stock} />
          ))}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 个股条目子组件
// ═══════════════════════════════════════════════════════════════

interface StockItemProps {
  stock: DailyPickStock;
}

const StockItem: React.FC<StockItemProps> = ({ stock }) => {
  return (
    <div className="px-3 py-2.5 hover:bg-gray-800/30 transition-colors">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-blue-400">{stock.name}</span>
        <span className="text-[10px] text-gray-600 font-mono">{stock.code}</span>
        <span className="ml-auto text-[10px] text-green-500 bg-green-900/20 px-1.5 py-0.5 rounded">
          ⚡ 推荐
        </span>
      </div>

      {/* 买入理由 */}
      <div className="mt-1 flex items-start gap-1.5">
        <span className="text-[10px] text-gray-600 mt-0.5 flex-shrink-0">📌</span>
        <span className="text-[11px] text-gray-400 leading-relaxed">{stock.reason}</span>
      </div>

      {/* 买入点位 */}
      <div className="mt-1 flex items-start gap-1.5">
        <span className="text-[10px] text-gray-600 mt-0.5 flex-shrink-0">💰</span>
        <span className="text-[11px] text-purple-400">{stock.entryPoint}</span>
      </div>

      {/* 风险提示 */}
      {stock.riskPoints.length > 0 && (
        <div className="mt-1 flex items-start gap-1.5">
          <span className="text-[10px] text-gray-600 mt-0.5 flex-shrink-0">⚠️</span>
          <div className="flex flex-wrap gap-1">
            {stock.riskPoints.map((risk, ri) => (
              <span key={ri} className="text-[10px] text-orange-400 bg-orange-900/10 px-1.5 py-0.5 rounded border border-orange-800/20">
                {risk}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyPicks;
