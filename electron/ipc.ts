/**
 * xvqiu Electron IPC Handlers
 * 替换 Chrome Extension 的 service-worker.ts 消息路由
 *
 * 职责:
 *   1. 注册所有 IPC handlers (ipcMain.handle)
 *   2. 流式分析通过事件通道推送 (webContents.send)
 *   3. 保持与 Chrome 版相同的业务逻辑
 *
 * @module electron/ipc
 */

import { ipcMain, BrowserWindow } from 'electron';
import type {
  MarketIndex,
  StockQuote,
  SectorData,
  SectorDetail,
  HotTopic,
  MarketEnvResult,
  DirectionResult,
  StreamEvent,
  StreamProgress,
  AnalysisResult,
} from '../utils/types';

import { EastMoneyAdapter } from '../data/eastmoney';
import { AnalysisEngine, L2DirectionAnalyzer } from '../engine';
import type { StreamCallbacks } from '../llm/types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

const SW_VERSION = '1.0.0';

// ─── 单例 ──────────────────────────────────────────
const eastMoney = new EastMoneyAdapter();
const analysisEngine = new AnalysisEngine();

// ═══════════════════════════════════════════════════════════════
// IPC Handlers
// ═══════════════════════════════════════════════════════════════

export function registerIpcHandlers(): void {
  // ─── PING — 连通性检查 ─────────────────────────
  ipcMain.handle('PING', async () => {
    return { status: 'ok', version: SW_VERSION };
  });

  // ─── ENV_CHECK — 环境诊断 ──────────────────────
  ipcMain.handle('ENV_CHECK', async () => {
    logger.info('[IPC] 环境诊断请求');

    const envResult = await analysisEngine.envCheck();
    const l2 = new L2DirectionAnalyzer();
    const directions = await l2.analyze(envResult.sectors, envResult.topics);

    logger.info(`[IPC] 环境诊断完成: 级别 ${envResult.envLevel}`);

    return {
      envLevel: envResult.envLevel,
      sentiment: envResult.sentiment,
      suggestion: envResult.suggestion,
      indices: envResult.indices,
      sectors: envResult.sectors,
      topics: envResult.topics,
      directions,
    };
  });

  // ─── ANALYZE_POOL — 股票池分析 ─────────────────
  ipcMain.handle('ANALYZE_POOL', async (_event, payload: { stocks?: string[] }) => {
    const stockList = payload?.stocks ?? [];
    logger.info(`[IPC] 股票池分析请求: ${stockList.length} 只股票`);

    if (stockList.length === 0) {
      throw new Error('股票列表为空，请提供待分析的股票代码');
    }
    if (stockList.length > 50) {
      throw new Error('单次分析最多支持 50 只股票');
    }

    const result = await analysisEngine.analyzePool({ stocks: stockList });
    logger.info(`[IPC] 股票池分析完成: ${result.conclusions.length} 条结论`);
    return result;
  });

  // ─── ANALYZE_SINGLE — 单票分析 ─────────────────
  ipcMain.handle('ANALYZE_SINGLE', async (_event, payload: { stock?: string; code?: string }) => {
    const stockName = payload?.stock ?? '未知';
    const stockCode = payload?.code ?? '';
    logger.info(`[IPC] 单票分析请求: ${stockName} (${stockCode || '无代码'})`);

    if (!stockCode && !stockName) {
      throw new Error('请提供股票代码或名称');
    }

    return {
      message: '单票分析已实现',
      stock: stockName,
      code: stockCode,
    };
  });

  // ─── GET_QUOTE — 个股行情查询 ──────────────────
  ipcMain.handle('GET_QUOTE', async (_event, payload: { code?: string }) => {
    const stockCode = payload?.code ?? '';
    logger.info(`[IPC] 行情查询请求: ${stockCode}`);

    if (!stockCode) {
      throw new Error('请提供股票代码');
    }

    const quote = await eastMoney.getQuote(stockCode);
    return quote;
  });

  // ─── GET_MARKET — 大盘指数数据 ─────────────────
  ipcMain.handle('GET_MARKET', async () => {
    logger.info('[IPC] 大盘数据请求');
    const indices = await eastMoney.getMarketIndex();
    return indices;
  });

  // ─── GET_SECTOR — 板块/题材数据 ─────────────────
  ipcMain.handle('GET_SECTOR', async (_event, payload: { type: 'sectors' | 'detail' | 'topics'; code?: string }) => {
    const subType = payload?.type;
    logger.info(`[IPC] 板块数据请求: type=${subType}`);

    switch (subType) {
      case 'sectors': {
        const sectors = await eastMoney.getSectors();
        return sectors;
      }
      case 'detail': {
        const code = payload?.code;
        if (!code) throw new Error('板块明细查询需要提供 code 参数');
        const detail = await eastMoney.getSectorDetail(code);
        return detail;
      }
      case 'topics': {
        const topics = await eastMoney.getHotTopics();
        return topics;
      }
      default:
        throw new Error(`未知的 GET_SECTOR 子命令: ${subType}`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 流式分析 IPC (通过 WebContents 推送事件)
// ═══════════════════════════════════════════════════════════════

/**
 * 启动流式股票池分析
 */
export async function startStreamPoolAnalysis(
  win: BrowserWindow,
  payload: { stocks: string[] },
): Promise<void> {
  const stocks = payload?.stocks ?? [];
  logger.info(`[IPC-Stream] 流式股票池分析: ${stocks.length} 只`);

  if (stocks.length === 0) {
    win.webContents.send('stream:event', {
      event: 'stream:error',
      data: '股票列表为空',
    } as StreamEvent);
    return;
  }

  try {
    sendProgress(win, 'fetching', '正在获取市场数据...', 5);

    const result = await analysisEngine.analyzePool({
      stocks,
      streamCallbacks: {
        onChunk: (_chunk) => {
          const content = _chunk.choices?.[0]?.delta?.content ?? '';
          if (content) {
            win.webContents.send('stream:event', {
              event: 'stream:chunk',
              data: content,
            } as StreamEvent);
          }
        },
      },
    });

    // L1 环境评级
    win.webContents.send('stream:event', {
      event: 'stream:env-level',
      data: result.marketEnv,
    } as StreamEvent);

    sendProgress(win, 'l4', '正在生成结论...', 90);

    // 逐条推送结论
    for (const c of result.conclusions) {
      win.webContents.send('stream:event', {
        event: 'stream:conclusion',
        data: {
          stockCode: c.stockCode,
          stockName: c.stockName,
          verdict: c.verdict,
          reason: c.reason,
          riskPoints: c.riskPoints,
          priority: c.priority,
        },
      } as StreamEvent);
    }

    // 完成
    sendProgress(win, 'done', '分析完成', 100);
    win.webContents.send('stream:event', {
      event: 'stream:done',
      data: result,
    } as StreamEvent);

    logger.info(`[IPC-Stream] 流式分析完成: ${stocks.length} 只股票`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('[IPC-Stream] 流式分析错误:', errMsg);
    win.webContents.send('stream:event', {
      event: 'stream:error',
      data: errMsg,
    } as StreamEvent);
  }
}

/**
 * 启动流式单票分析
 */
export async function startStreamSingleAnalysis(
  win: BrowserWindow,
  payload: { code?: string; stock?: string },
): Promise<void> {
  const code = payload?.code ?? payload?.stock ?? '';
  logger.info(`[IPC-Stream] 流式单票分析: ${code}`);

  if (!code) {
    win.webContents.send('stream:event', {
      event: 'stream:error',
      data: '请提供股票代码',
    } as StreamEvent);
    return;
  }

  try {
    sendProgress(win, 'fetching', '正在获取数据...', 10);

    const result = await analysisEngine.analyzeSingle({
      code,
      streamCallbacks: {
        onChunk: (_chunk) => {
          const content = _chunk.choices?.[0]?.delta?.content ?? '';
          if (content) {
            win.webContents.send('stream:event', {
              event: 'stream:chunk',
              data: content,
            } as StreamEvent);
          }
        },
      },
    });

    win.webContents.send('stream:event', {
      event: 'stream:env-level',
      data: result.marketEnv,
    } as StreamEvent);

    for (const c of result.conclusions) {
      win.webContents.send('stream:event', {
        event: 'stream:conclusion',
        data: {
          stockCode: c.stockCode,
          stockName: c.stockName,
          verdict: c.verdict,
          reason: c.reason,
          riskPoints: c.riskPoints,
          priority: c.priority,
        },
      } as StreamEvent);
    }

    win.webContents.send('stream:event', {
      event: 'stream:done',
      data: result,
    } as StreamEvent);

    logger.info(`[IPC-Stream] 流式单票分析完成: ${code}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('[IPC-Stream] 流式分析错误:', errMsg);
    win.webContents.send('stream:event', {
      event: 'stream:error',
      data: errMsg,
    } as StreamEvent);
  }
}

// ─── 辅助函数 ──────────────────────────────────────

function sendProgress(win: BrowserWindow, stage: string, message: string, percent: number): void {
  const progress: StreamProgress = { stage, message, percent };
  win.webContents.send('stream:event', {
    event: 'stream:progress',
    data: progress,
  } as StreamEvent);
}

// ─── 注册流式 IPC ────────────────────────────────

export function registerStreamIpcHandlers(): void {
  ipcMain.on('stream:start', (event, payload: { type: string; payload: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const { type, payload: data } = payload;

    switch (type) {
      case 'ANALYZE_POOL_STREAM':
        startStreamPoolAnalysis(win, data as { stocks: string[] });
        break;
      case 'ANALYZE_SINGLE_STREAM':
        startStreamSingleAnalysis(win, data as { code?: string; stock?: string });
        break;
      default:
        win.webContents.send('stream:event', {
          event: 'stream:error',
          data: `未知流式类型: ${type}`,
        } as StreamEvent);
    }
  });
}
