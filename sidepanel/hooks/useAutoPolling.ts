/**
 * useAutoPolling — 自动轮询 Hook
 *
 * 每30秒自动刷新大盘指数 + 快讯数据 + 情绪数据
 * 不自动触发 LLM 分析（仅获取数据）
 *
 * @module sidepanel/hooks/useAutoPolling
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { analysisEngine, L2DirectionAnalyzer } from '../../engine';

const POLL_INTERVAL = 30_000; // 30 秒

export function useAutoPolling() {
  const {
    autoPolling,
    setAutoPolling,
    setLastPollTime,
    setEnvResult,
    setTodayAction,
    setAvoidType,
    setCertainDirections,
    setDirections,
    setError,
  } = useAppStore();

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);

  const doPoll = useCallback(async () => {
    if (isPollingRef.current) return; // 防止并发轮询
    isPollingRef.current = true;

    try {
      const envData = await analysisEngine.envCheck();

      // 更新环境数据
      setEnvResult(
        envData.envLevel,
        envData.sentiment,
        envData.suggestion,
      );

      if (envData.todayAction) setTodayAction(envData.todayAction);
      if (envData.avoidType) setAvoidType(envData.avoidType);
      if (envData.certainDirections) setCertainDirections(envData.certainDirections);

      // 更新方向数据
      const l2 = new L2DirectionAnalyzer();
      const directions = await l2.analyze(envData.sectors, envData.topics);
      if (directions?.length > 0) {
        setDirections(directions);
      }

      setLastPollTime(Date.now());
    } catch (err) {
      // 轮询失败不设置全局错误（避免干扰用户操作）
      console.debug('[AutoPoll] 轮询失败:', err instanceof Error ? err.message : err);
    } finally {
      isPollingRef.current = false;
    }
  }, [
    setEnvResult,
    setTodayAction,
    setAvoidType,
    setCertainDirections,
    setDirections,
    setLastPollTime,
  ]);

  // ─── 启动/停止轮询 ─────────────────────────

  const startPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    // 立即执行一次
    doPoll();
    // 然后每30秒执行
    pollingRef.current = setInterval(doPoll, POLL_INTERVAL);
    setAutoPolling(true);
  }, [doPoll, setAutoPolling]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setAutoPolling(false);
  }, [setAutoPolling]);

  // ─── 切换轮询状态 ─────────────────────────

  const togglePolling = useCallback(() => {
    const store = useAppStore.getState();
    if (store.autoPolling) {
      stopPolling();
    } else {
      startPolling();
    }
  }, [startPolling, stopPolling]);

  // ─── 组件卸载时清理 ─────────────────────────

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  return {
    startPolling,
    stopPolling,
    togglePolling,
    isPolling: autoPolling,
  };
}
