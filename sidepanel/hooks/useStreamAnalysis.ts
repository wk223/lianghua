/**
 * 流式分析 Hook (Web 版)
 * 直接调用 AnalysisEngine，无需 Electron IPC
 *
 * @module sidepanel/hooks/useStreamAnalysis
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  StreamEvent,
  StreamProgress,
  StreamConclusionData,
  AnalysisResult,
  MarketEnvResult,
  DirectionResult,
} from '../../utils/types';
import { useAppStore, type StockResult } from '../stores/useAppStore';
import { analysisEngine } from '../../engine';

// ═══════════════════════════════════════════════════════════════
// 钩子
// ═══════════════════════════════════════════════════════════════

export function useStreamAnalysis() {
  const store = useAppStore();
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 组件卸载时中止进行中的分析
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  /**
   * 开始流式分析
   *
   * @param type  - 分析类型
   * @param payload - 请求参数
   */
  const startStreamAnalysis = useCallback(
    async (
      type: 'ANALYZE_POOL_STREAM' | 'ANALYZE_SINGLE_STREAM',
      payload: unknown,
    ): Promise<void> => {
      // 中止前一次请求
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      setIsStreaming(true);
      setStreamingText('');
      store.clearResults();
      store.setStatus('loading');

      try {
        let result: AnalysisResult;

        if (type === 'ANALYZE_POOL_STREAM') {
          const { stocks } = payload as { stocks: string[] };
          result = await analysisEngine.analyzePool({
            stocks,
            signal,
            streamCallbacks: {
              onChunk: (chunk) => {
                const content = chunk.choices?.[0]?.delta?.content ?? '';
                if (content) {
                  setStreamingText((prev) => prev + content);
                }
              },
            },
          });
        } else {
          const { code } = payload as { code?: string; stock?: string };
          result = await analysisEngine.analyzeSingle({
            code: code ?? (payload as any).stock ?? '',
            signal,
            streamCallbacks: {
              onChunk: (chunk) => {
                const content = chunk.choices?.[0]?.delta?.content ?? '';
                if (content) {
                  setStreamingText((prev) => prev + content);
                }
              },
            },
          });
        }

        // 检查是否被中止
        if (signal.aborted) return;

        // 设置结果
        store.setAnalysisResult(result);
        setIsStreaming(false);
        setStreamingText('');

      } catch (err: unknown) {
        if (signal.aborted) return;

        const errMsg = err instanceof Error ? err.message : String(err);
        store.setError(errMsg);
        setIsStreaming(false);
        setStreamingText('');
      }
    },
    [store],
  );

  /**
   * 中止流式分析
   */
  const abortStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
    store.setStatus('idle');
    store.setCurrentAction('none');
  }, [store]);

  return {
    startStream: startStreamAnalysis,
    abortStream,
    streamingText,
    isStreaming,
  };
}
