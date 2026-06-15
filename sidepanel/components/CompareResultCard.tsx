/**
 * CompareResultCard — 比较模式结果卡片
 *
 * 展示二选一/三选一的比较结论
 * 显示胜出者 + 比较理由
 *
 * @module sidepanel/components/CompareResultCard
 */

import React from 'react';
import { useAppStore } from '../stores/useAppStore';

const CompareResultCard: React.FC = () => {
  const { compareResult } = useAppStore();

  if (!compareResult || !compareResult.exists) return null;

  return (
    <div className="card border-yellow-700/30 bg-yellow-900/10 space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <span className="text-lg">🏆</span>
        <span className="text-sm font-semibold text-yellow-400">比较结论</span>
      </div>

      {/* 胜出者 */}
      <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-yellow-500 font-medium">胜出者</span>
          <span className="text-sm font-bold text-yellow-300">
            {compareResult.winner}
          </span>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-start gap-2">
            <span className="text-green-500 flex-shrink-0">✅ 为什么胜出</span>
            <span className="text-gray-300">{compareResult.winnerReason}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-500 flex-shrink-0">❌ 为什么不如它</span>
            <span className="text-gray-400">{compareResult.loserReason}</span>
          </div>
        </div>
      </div>

      {/* 额外维度 */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-900/50 rounded-lg p-2 space-y-1">
          <span className="text-gray-500 block">🎯 更符合模式</span>
          <span className="text-gray-300">{compareResult.betterFit}</span>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-2 space-y-1">
          <span className="text-gray-500 block">💰 买点更合理</span>
          <span className="text-gray-300">{compareResult.betterBuyPoint}</span>
        </div>
      </div>
    </div>
  );
};

export default CompareResultCard;
