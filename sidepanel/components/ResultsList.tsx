/**
 * ResultsList — 分析结果列表
 *
 * 按优先级排序展示所有股票的结论卡片
 * 顶部显示统计摘要（各结论类型数量）
 *
 * @module sidepanel/components/ResultsList
 */

import React, { useMemo } from 'react';
import { useAppStore } from '../stores/useAppStore';
import ResultCard from './ResultCard';
import type { Verdict } from '../../utils/types';

const ResultsList: React.FC = () => {
  const { stockResults } = useAppStore();

  // 按优先级排序（priority 越低越靠前）
  const sorted = useMemo(
    () => [...stockResults].sort((a, b) => a.priority - b.priority),
    [stockResults],
  );

  // 统计各结论数量
  const stats = useMemo(() => {
    const counts: Record<Verdict, number> = {
      BUY: 0,
      COND_BUY: 0,
      WATCH: 0,
      NO_BUY: 0,
    };
    for (const r of sorted) {
      counts[r.verdict]++;
    }
    return counts;
  }, [sorted]);

  if (sorted.length === 0) return null;

  return (
    <section className="space-y-3">
      {/* 统计摘要条 */}
      <div className="flex flex-wrap gap-2 text-xs">
        {stats.BUY > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-buy/15 text-buy border border-buy/20">
            🟢 买入 {stats.BUY}
          </span>
        )}
        {stats.COND_BUY > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cond-buy/15 text-cond-buy border border-cond-buy/20">
            🟡 条件 {stats.COND_BUY}
          </span>
        )}
        {stats.WATCH > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-watch/15 text-watch border border-watch/20">
            🟠 观察 {stats.WATCH}
          </span>
        )}
        {stats.NO_BUY > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-no-buy/15 text-no-buy border border-no-buy/20">
            🔴 不买 {stats.NO_BUY}
          </span>
        )}
      </div>

      {/* 结论列表 */}
      <div className="space-y-2">
        {sorted.map((result, index) => (
          <ResultCard key={result.code} result={result} index={index} />
        ))}
      </div>
    </section>
  );
};

export default ResultsList;
