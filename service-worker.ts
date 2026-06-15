/**
 * xvqiu Service Worker
 * Chrome MV3 后台服务工作线程 — 消息路由 + 生命周期管理
 *
 * @module service-worker
 *
 * 职责:
 *   1. 生命周期管理 (install / activate / startup)
 *   2. 6 种业务消息路由 (ANALYZE_POOL / ANALYZE_SINGLE / ENV_CHECK / GET_QUOTE / GET_MARKET / GET_SECTOR)
 *   3. 心跳保活 (alarm-based keep-alive)
 *   4. 超时控制 + 统一错误边界
 *   5. 请求追踪 (requestId)
 */

import type {
  ChromeMessage,
  ChromeResponse,
  MarketIndex,
  StockQuote,
  SectorData,
  SectorDetail,
  HotTopic,
  MarketEnvResult,
  DirectionResult,
  StockAnalysisResult,
  ConclusionResult,
} from './utils/types';

import { swLog } from './utils/sw-logger';
import { EastMoneyAdapter } from './data/eastmoney';

// ═══════════════════════════════════════════════════════════════
// 常量 & 配置
// ═══════════════════════════════════════════════════════════════

const SW_VERSION = '1.0.0';
const SW_NAME = 'xvqiu';

/** 各类消息的默认超时 (ms) */
const TIMEOUTS: Partial<Record<string, number>> = {
  ANALYZE_POOL: 120_000,    // 池分析耗时较长
  ANALYZE_SINGLE: 60_000,   // 单票分析
  ENV_CHECK: 30_000,        // 环境诊断
  GET_QUOTE: 15_000,        // 行情查询
  GET_MARKET: 15_000,       // 大盘数据
  GET_SECTOR: 15_000,       // 板块数据
};

/** 默认超时 (fallback) */
const DEFAULT_TIMEOUT = 30_000;

/** 心跳保活间隔 (分钟) */
const KEEPALIVE_INTERVAL_MINUTES = 1;

/** 最近一次活动时间戳 (ms) — 用于监控 */
let lastActiveTime = Date.now();

// ─── 数据适配器单例 ──────────────────────────
// 在 Service Worker 生命周期内复用同一个适配器实例，
// 共享 DataFetcher 的速率限制器和缓存
const eastMoney = new EastMoneyAdapter();

// ═══════════════════════════════════════════════════════════════
// 生命周期
// ═══════════════════════════════════════════════════════════════

/**
 * 扩展安装 / 更新时触发
 */
chrome.runtime.onInstalled.addListener((details) => {
  const { reason, previousVersion } = details;

  swLog.info(`扩展已安装/更新: reason=${reason}, previousVersion=${previousVersion || 'none'}`);

  switch (reason) {
    case 'install': {
      // 首次安装 — 初始化存储、打开 side panel
      initStorageDefaults()
        .then(() => swLog.info('存储默认值初始化完成'))
        .catch((err) => swLog.error('存储初始化失败:', err));

      chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .then(() => swLog.info('SidePanel 行为已设置'))
        .catch((err) => swLog.warn('设置 SidePanel 行为失败:', err));

      break;
    }

    case 'update': {
      swLog.info(`版本更新: ${previousVersion} → ${SW_VERSION}`);
      // 未来可在此处执行数据迁移
      break;
    }

    case 'chrome_update':
    case 'shared_module_update': {
      swLog.info(`浏览器/共享模块更新: ${reason}`);
      break;
    }
  }

  // 安装/更新后注册保活闹钟
  setupKeepAlive();
});

/**
 * 浏览器启动时触发（Service Worker 被唤醒）
 */
chrome.runtime.onStartup.addListener(() => {
  swLog.info('浏览器启动，Service Worker 唤醒');
  lastActiveTime = Date.now();
  setupKeepAlive();
});

/**
 * 激活事件 — 清理旧版本资源
 */
chrome.runtime.onSuspend.addListener(() => {
  swLog.info('Service Worker 即将休眠');
});

// ═══════════════════════════════════════════════════════════════
// 心跳保活
// ═══════════════════════════════════════════════════════════════

/**
 * 设置保活闹钟
 * Chrome 会在闹钟触发时唤醒 Service Worker，防止被回收
 */
function setupKeepAlive(): void {
  try {
    chrome.alarms.create('keep-alive', {
      periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
    });
    swLog.debug(`保活闹钟已设置 (每 ${KEEPALIVE_INTERVAL_MINUTES} 分钟)`);
  } catch (err) {
    swLog.warn('创建保活闹钟失败:', err);
  }
}

/**
 * 闹钟事件处理器
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keep-alive') {
    lastActiveTime = Date.now();
    swLog.debug('保活心跳 OK');
  }
});

// ═══════════════════════════════════════════════════════════════
// 超时包装器
// ═══════════════════════════════════════════════════════════════

/**
 * 为异步操作添加超时保护
 * 超时后返回超时错误，不抛出异常
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      // 使用 setTimeout 而不是 AbortController，保持兼容性
      const id = setTimeout(() => {
        reject(new Error(`[${label}] 处理超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      // 允许 promise 完成时清除定时器（但如果 promise 先完成，这个定时器不会被清理）
      // 使用 unref 风格 — 在 Promise.race 中无法直接做到，但有替代方案
      if (typeof id === 'object' && 'unref' in id) {
        (id as any).unref();
      }
    }),
  ]);
}

// ═══════════════════════════════════════════════════════════════
// 消息处理器类型 & 注册表
// ═══════════════════════════════════════════════════════════════

/**
 * 消息处理器签名
 * 接收经过类型断言后的 payload，返回业务数据
 */
type Handler<TPayload = unknown, TData = unknown> = (
  payload: TPayload,
  sender: chrome.runtime.MessageSender,
) => Promise<TData>;

/** 注册表中的处理器条目 */
interface HandlerEntry {
  handler: Handler<any, any>;
  timeoutMs: number;
}

/**
 * 处理器注册表
 * 类型安全 + 可配置超时
 */
class HandlerRegistry {
  private handlers = new Map<string, HandlerEntry>();

  /**
   * 注册一个消息处理器
   * @param type    消息类型
   * @param handler 异步处理器函数
   * @param timeoutMs 可选超时(ms)，不传则使用 DEFAULT_TIMEOUT
   */
  register<TPayload, TData>(
    type: string,
    handler: Handler<TPayload, TData>,
    timeoutMs?: number,
  ): void {
    if (this.handlers.has(type)) {
      swLog.warn(`消息处理器重复注册: ${type}，将覆盖旧处理器`);
    }
    this.handlers.set(type, {
      handler,
      timeoutMs: timeoutMs ?? TIMEOUTS[type] ?? DEFAULT_TIMEOUT,
    });
    swLog.debug(`处理器已注册: ${type}`);
  }

  /**
   * 执行消息处理（含解析 + 超时 + 错误边界）
   * 返回值永远符合 ChromeResponse 结构
   */
  async execute(
    message: ChromeMessage,
    sender: chrome.runtime.MessageSender,
  ): Promise<ChromeResponse> {
    const { type, payload, requestId } = message;
    const entry = this.handlers.get(type);

    // ── 未知消息类型 ──
    if (!entry) {
      swLog.warn(`未知消息类型: ${type}`);
      return {
        success: false,
        error: `未知消息类型: ${type}`,
        requestId,
      };
    }

    // ── 更新活动时间戳 ──
    lastActiveTime = Date.now();

    swLog.debug(`执行处理器: ${type}`, payload);

    try {
      const data = await withTimeout(
        entry.handler(payload, sender),
        entry.timeoutMs,
        type,
      );

      swLog.debug(`处理器完成: ${type}`);
      return {
        success: true,
        data,
        requestId,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      swLog.error(`处理器失败: ${type} — ${errMsg}`, err);

      return {
        success: false,
        error: errMsg,
        requestId,
      };
    }
  }
}

// ─── 单例注册表 ────────────────────────────
const registry = new HandlerRegistry();

// ═══════════════════════════════════════════════════════════════
// 消息路由入口
// ═══════════════════════════════════════════════════════════════

/**
 * 单一入口消息监听
 * 所有请求经由此处分发到注册表
 */
chrome.runtime.onMessage.addListener(
  (
    message: ChromeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ChromeResponse) => void,
  ): boolean => {
    swLog.debug(`收到消息: ${message.type}`, {
      requestId: message.requestId,
      hasPayload: message.payload !== undefined,
    });

    // 异步执行，通过 registry.execute 统一处理
    registry.execute(message, sender).then(sendResponse);

    // 返回 true 保持消息通道开放，允许异步响应
    return true;
  },
);

// ═══════════════════════════════════════════════════════════════
// 处理器实现
// ═══════════════════════════════════════════════════════════════

/**
 * PING — 连通性检查
 */
registry.register<unknown, { status: string; version: string }>(
  'PING',
  async (_payload, _sender) => {
    return { status: 'ok', version: SW_VERSION };
  },
  5_000,
);

/**
 * ANALYZE_POOL — 股票池分析
 *
 * 预期 payload: { stocks: string[] }
 * 实际业务将在 S2 接入分析引擎后实现
 */
registry.register<{ stocks?: string[] }, { message: string; count: number }>(
  'ANALYZE_POOL',
  async (payload, _sender) => {
    const stockList = payload?.stocks ?? [];
    swLog.info(`股票池分析请求: ${stockList.length} 只股票`, stockList);

    if (stockList.length === 0) {
      throw new Error('股票列表为空，请提供待分析的股票代码');
    }

    if (stockList.length > 50) {
      throw new Error('单次分析最多支持 50 只股票');
    }

    // TODO: S2 — 接入四层分析引擎
    return {
      message: '股票池分析将在 Sprint 2 实现',
      count: stockList.length,
    };
  },
);

/**
 * ANALYZE_SINGLE — 单票分析
 *
 * 预期 payload: { stock: string; code?: string }
 */
registry.register<
  { stock?: string; code?: string },
  { message: string; stock: string; code: string }
>(
  'ANALYZE_SINGLE',
  async (payload, _sender) => {
    const stockName = payload?.stock ?? '未知';
    const stockCode = payload?.code ?? '';

    swLog.info(`单票分析请求: ${stockName} (${stockCode || '无代码'})`);

    if (!stockCode && !stockName) {
      throw new Error('请提供股票代码或名称');
    }

    // TODO: S2 — 接入四层分析引擎
    return {
      message: '单票分析将在 Sprint 2 实现',
      stock: stockName,
      code: stockCode,
    };
  },
);

/**
 * ENV_CHECK — 环境诊断
 *
 * 预期 payload: 任意（可为空）
 * 返回当前市场环境级别
 */
registry.register<unknown, { message: string; envLevel: string }>(
  'ENV_CHECK',
  async (_payload, _sender) => {
    swLog.info('环境诊断请求');

    // TODO: S2 — 接入 L1 MarketAnalyzer
    return {
      message: '环境诊断将在 Sprint 2 实现',
      envLevel: '--',
    };
  },
);

/**
 * GET_QUOTE — 个股行情查询
 *
 * 预期 payload: { code: string }
 * 返回 StockQuote
 */
registry.register<{ code?: string }, StockQuote>(
  'GET_QUOTE',
  async (payload, _sender) => {
    const stockCode = payload?.code ?? '';

    swLog.info(`行情查询请求: ${stockCode}`);

    if (!stockCode) {
      throw new Error('请提供股票代码');
    }

    const quote = await eastMoney.getQuote(stockCode);
    swLog.info(`行情查询完成: ${quote.name}(${quote.code}) ¥${quote.price}`);
    return quote;
  },
);

/**
 * GET_MARKET — 大盘指数数据
 *
 * 预期 payload: 无
 * 返回 MarketIndex[]
 */
registry.register<unknown, MarketIndex[]>(
  'GET_MARKET',
  async (_payload, _sender) => {
    swLog.info('大盘数据请求');

    const indices = await eastMoney.getMarketIndex();
    swLog.info(`大盘数据完成: ${indices.length} 个指数`);
    return indices;
  },
);

/**
 * GET_SECTOR — 板块/题材数据
 *
 * 三种子命令:
 *   1) { type: 'sectors' }              → SectorData[]     板块行情列表
 *   2) { type: 'detail', code: string }  → SectorDetail     板块明细（含成分股）
 *   3) { type: 'topics' }               → HotTopic[]        热门题材/概念
 *
 * 预期 payload: { type: 'sectors' | 'detail' | 'topics'; code?: string }
 */
registry.register<
  { type: 'sectors' | 'detail' | 'topics'; code?: string },
  SectorData[] | SectorDetail | HotTopic[]
>(
  'GET_SECTOR',
  async (payload, _sender) => {
    const subType = payload?.type;
    swLog.info(`板块数据请求: type=${subType}`, payload);

    switch (subType) {
      case 'sectors': {
        const sectors = await eastMoney.getSectors();
        swLog.info(`板块列表查询完成: ${sectors.length} 个板块`);
        return sectors;
      }

      case 'detail': {
        const code = payload?.code;
        if (!code) {
          throw new Error('板块明细查询需要提供 code 参数（如 BK0477）');
        }
        const detail = await eastMoney.getSectorDetail(code);
        swLog.info(
          `板块明细查询完成: ${detail.sector.name}(${detail.sector.code}), ${detail.stocks.length} 只成分股`,
        );
        return detail;
      }

      case 'topics': {
        const topics = await eastMoney.getHotTopics();
        swLog.info(`热门题材查询完成: ${topics.length} 个概念`);
        return topics;
      }

      default: {
        throw new Error(
          `未知的 GET_SECTOR 子命令: ${subType}，可用值: sectors / detail / topics`,
        );
      }
    }
  },
);

// ═══════════════════════════════════════════════════════════════
// 初始化工具
// ═══════════════════════════════════════════════════════════════

/**
 * 初始化存储默认值
 */
async function initStorageDefaults(): Promise<void> {
  const defaults: Record<string, unknown> = {
    xvqiu_installed_at: Date.now(),
    xvqiu_version: SW_VERSION,
    xvqiu_settings: {
      watchlist: [],
      autoAnalyze: false,
      maxConcurrent: 3,
    },
  };

  await chrome.storage.local.set(defaults);
}

// ═══════════════════════════════════════════════════════════════
// 连接管理 (long-lived connections)
// ═══════════════════════════════════════════════════════════════

/**
 * 长期连接 — 用于 Side Panel 持续通信
 * 未来可支持流式推送分析结果
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'xvqiu-sidepanel') {
    swLog.info('Side Panel 已连接', port.sender?.tab?.id);

    port.onMessage.addListener((msg: ChromeMessage) => {
      swLog.debug('Side Panel 消息 (port):', msg.type);
    });

    port.onDisconnect.addListener(() => {
      swLog.info('Side Panel 已断开');
    });
  }
});

// ─── 启动日志 ──────────────────────────────
swLog.info(`Service Worker 已启动 v${SW_VERSION}`);
