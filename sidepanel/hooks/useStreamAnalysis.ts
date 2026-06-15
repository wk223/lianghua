/**
 * 流式分析 Hook
 * 通过 chrome.runtime.connect 长连接接收流式分析结果
 *
 * 用法:
 * ```ts
 * const { startStream, abortStream, streamingText, isStreaming } = useStreamAnalysis();
 *
 * // 开始流式分析
 * await startStream('ANALYZE_POOL_STREAM', { stocks: ['000001', '600519'] });
 * ```
 *
 * @module sidepanel/hooks/useStreamAnalysis
 */

import { useCallback, useRef, useState } from 'react';
import type {
  StreamEvent,
  StreamProgress,
  StreamConclusionData,
  AnalysisResult,
  MarketEnvResult,
  DirectionResult,
} from '../../utils/types';
import { useAppStore, type StockResult } from '../stores/useAppStore';

// ═══════════════════════════════════════════════════════════════
// 钩子
// ═══════════════════════════════════════════════════════════════

export function useStreamAnalysis() {
  const store = useAppStore();
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  /**
   * 开始流式分析
   *
   * @param type  - 消息类型 (ANALYZE_POOL_STREAM | ANALYZE_SINGLE_STREAM)
   * @param payload - 请求参数
   */
  const startStream = useCallback(
    async (
      type: 'ANALYZE_POOL_STREAM' | 'ANALYZE_SINGLE_STREAM',
      payload: unknown,
    ): Promise<void> => {
      // 关闭旧的连接
      if (portRef.current) {
        portRef.current.disconnect();
      }

      setIsStreaming(true);
      setStreamingText('');
      store.clearResults();
      store.setStatus('loading');

      // 创建长连接
      const port = chrome.runtime.connect({ name: 'xvqiu-stream' });
      portRef.current = port;

      return new Promise<void>((resolve, reject) => {
        port.onMessage.addListener((event: StreamEvent) => {
          try {
            switch (event.event) {
              // ── LLM 流式文本 ──
              case 'stream:chunk': {
                const chunk = event.data as string;
                setStreamingText((prev) => prev + chunk);
                break;
              }

              // ── 进度更新 ──
              case 'stream:progress': {
                const progress = event.data as StreamProgress;
                // 进度信息展示在 loading 状态中
                store.setCurrentAction(
                  progress.stage === 'llm' ? 'analyze' : 'analyze',
                );
                break;
              }

              // ── L1 环境评级结果 ──
              case 'stream:env-level': {
                const env = event.data as MarketEnvResult;
                store.setEnvResult(env.envLevel, env.sentiment, env.suggestion);
                break;
              }

              // ── L2 方向结果 ──
              case 'stream:directions': {
                const dirData = event.data as DirectionResult[];
                if (Array.isArray(dirData)) {
                  store.setDirections(dirData);
                } else if (event.data && typeof event.data === 'object') {
                  store.appendDirection(event.data as DirectionResult);
                }
                break;
              }

              // ── 单只股票结论增量 ──
              case 'stream:conclusion': {
                const conclusion = event.data as StreamConclusionData;
                const stockResult: StockResult = {
                  code: conclusion.stockCode,
                  name: conclusion.stockName,
                  verdict: conclusion.verdict,
                  reason: conclusion.reason,
                  riskPoints: conclusion.riskPoints,
                  priority: conclusion.priority,
                };
                // 追加到当前结果列表
                const current = useAppStore.getState().stockResults;
                useAppStore.getState().setStockResults([
                  ...current,
                  stockResult,
                ]);
                break;
              }

              // ── 分析完成 ──
              case 'stream:done': {
                const result = event.data as AnalysisResult;
                if (result) {
                  store.setAnalysisResult(result);
                } else {
                  store.setStatus('success');
                }
                setIsStreaming(false);
                setStreamingText('');
                resolve();
                break;
              }

              // ── 错误 ──
              case 'stream:error': {
                const errMsg =
                  typeof event.data === 'string'
                    ? event.data
                    : '流式分析错误';
                store.setError(errMsg);
                setIsStreaming(false);
                setStreamingText('');
                reject(new Error(errMsg));
                break;
              }

              default:
                break;
            }
          } catch (err) {
            console.error('[useStreamAnalysis] 事件处理错误:', err);
          }
        });

        port.onDisconnect.addListener(() => {
          // Chrome 断开连接（可能是 SW 休眠）
          if (portRef.current === port) {
            portRef.current = null;
            if (isStreaming) {
              store.setError('连接断开，分析可能未完成');
              setIsStreaming(false);
              reject(new Error('连接断开'));
            }
          }
        });

        // 发送请求
        port.postMessage({
          type,
          payload,
          requestId: crypto.randomUUID?.() ?? Date.now().toString(),
        });
      });
    },
    [store],
  );

  /**
   * 中止流式分析
   */
  const abortStream = useCallback(() => {
    if (portRef.current) {
      portRef.current.postMessage({
        event: 'stream:abort',
      } satisfies StreamEvent);
      portRef.current.disconnect();
      portRef.current = null;
    }
    setIsStreaming(false);
    store.setStatus('idle');
    store.setCurrentAction('none');
  }, [store]);

  return {
    startStream,
    abortStream,
    streamingText,
    isStreaming,
  };
}
