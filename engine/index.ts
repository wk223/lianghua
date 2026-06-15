/**
 * xvqiu 分析引擎主入口
 * AnalysisEngine Orchestrator — 四层过滤编排
 *
 * @module engine
 * @todo S2: 实现完整编排逻辑
 */

export { L1MarketAnalyzer } from './l1-market';
export { L2DirectionAnalyzer } from './l2-direction';
export { L3StockAnalyzer } from './l3-stock';
export { L4ConclusionEngine } from './l4-conclusion';

export class AnalysisEngine {
  // TODO: Sprint 2 — 实现引擎编排
  async orchestrate(): Promise<void> {
    throw new Error('AnalysisEngine: 将在 Sprint 2 实现');
  }
}
