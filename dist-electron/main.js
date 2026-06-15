var _a;
import { ipcMain, BrowserWindow, app } from "electron";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1e3,
    maxDelay = 1e4,
    onRetry
  } = options;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        onRetry == null ? void 0 : onRetry(lastError, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
const DEFAULT_RATE_LIMIT = {
  maxRequests: 5,
  windowMs: 1e3
  // 5 req / sec
};
const DEFAULT_TIMEOUT = 8e3;
const DEFAULT_TTL = 3e4;
const DEFAULT_RETRY = 3;
const CACHE_CLEANUP_INTERVAL = 6e4;
class DataFetcher {
  constructor(rateLimit = DEFAULT_RATE_LIMIT) {
    this.rateLimit = rateLimit;
    this.cache = /* @__PURE__ */ new Map();
    this.rateLimitQueue = [];
    this.lastRequestTime = 0;
    this.processingQueue = false;
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedRequests: 0,
      rateLimited: 0
    };
    this.cleanupTimer = null;
    if (typeof setInterval !== "undefined") {
      this.cleanupTimer = setInterval(
        () => this.evictExpired(),
        CACHE_CLEANUP_INTERVAL
      );
    }
  }
  // ─── 公开 API ──────────────────────────────────────────
  /**
   * 发起 HTTP 请求，返回解析后的 JSON 数据
   * 集成：速率限制 → 缓存检查 → 超时 → 重试
   */
  async fetchJSON(url, options = {}) {
    this.stats.totalRequests++;
    const {
      useCache = true,
      ttl = DEFAULT_TTL,
      timeout = DEFAULT_TIMEOUT,
      retry = DEFAULT_RETRY,
      headers = {}
    } = options;
    if (useCache) {
      const cached = this.getFromCache(url);
      if (cached !== null) {
        this.stats.cacheHits++;
        return cached;
      }
    }
    this.stats.cacheMisses++;
    try {
      const data = await this.executeWithRateLimit(url, timeout, retry, headers);
      if (useCache) {
        this.setCache(url, data, ttl);
      }
      return data;
    } catch (err) {
      this.stats.failedRequests++;
      throw err;
    }
  }
  /**
   * 发起原始 HTTP 请求，返回 Response（不缓存、不限速）
   * 适用于流式或非 JSON 场景
   */
  async fetchRaw(url, timeout = DEFAULT_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
  // ─── 缓存管理 ──────────────────────────────────────────
  /** 清空所有缓存 */
  clearCache() {
    this.cache.clear();
    this.stats.cacheHits = 0;
    this.stats.cacheMisses = 0;
  }
  /** 删除指定 URL 的缓存 */
  invalidateCache(url) {
    this.cache.delete(url);
  }
  /** 获取当前缓存大小（条目数） */
  get cacheSize() {
    return this.cache.size;
  }
  /** 获取统计信息 */
  getStats() {
    return { ...this.stats };
  }
  /** 重置统计 */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedRequests: 0,
      rateLimited: 0
    };
  }
  // ─── 生命周期 ──────────────────────────────────────────
  /** 释放资源 */
  destroy() {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }
  // ─── 内部实现 ──────────────────────────────────────────
  /**
   * 执行带速率限制的请求
   * 使用队列确保不超过 rateLimit.maxRequests / rateLimit.windowMs
   */
  async executeWithRateLimit(url, timeout, retry, headers) {
    await this.enqueue();
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              "Accept": "application/json",
              "Accept-Language": "zh-CN,zh;q=0.9",
              "Referer": "https://quote.eastmoney.com/",
              ...headers
            }
          });
          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}: ${response.statusText} (${url})`
            );
          }
          const text = await response.text();
          if (!text || text.trim().length === 0) {
            throw new Error("东方财富 API 返回空数据");
          }
          return JSON.parse(text);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            throw new Error(`请求超时 (${timeout}ms): ${url}`);
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        maxRetries: retry,
        baseDelay: 500,
        maxDelay: 5e3,
        onRetry: (error, attempt) => {
          console.warn(
            `[DataFetcher] 重试 #${attempt + 1}/${retry}: ${url}`,
            error.message
          );
        }
      }
    );
  }
  /**
   * 速率限制队列
   * 保证请求间隔不小于 windowMs / maxRequests
   */
  enqueue() {
    return new Promise((resolve) => {
      this.rateLimitQueue.push(resolve);
      if (!this.processingQueue) {
        this.processQueue();
      }
    });
  }
  async processQueue() {
    this.processingQueue = true;
    while (this.rateLimitQueue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      const minInterval = this.rateLimit.windowMs / this.rateLimit.maxRequests;
      if (elapsed < minInterval) {
        await sleep(minInterval - elapsed);
      }
      const next = this.rateLimitQueue.shift();
      if (next) {
        this.lastRequestTime = Date.now();
        next();
      }
    }
    this.processingQueue = false;
  }
  // ─── 缓存操作 ──────────────────────────────────────────
  getFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }
  setCache(key, data, ttl) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }
  /** 清理过期缓存条目 */
  evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const API_BASE = "https://push2.eastmoney.com/api/qt";
const STOCK_GET_PATH = "/stock/get";
const ULIST_PATH = "/ulist.np/get";
const CLIST_PATH = "/clist/get";
const SECTOR_FIELDS = "f2,f3,f4,f12,f14,f20,f62,f104,f128,f140,f141,f142";
const SECTOR_STOCK_FIELDS = "f2,f3,f4,f5,f6,f12,f14";
const STOCK_FIELDS = "f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f55,f57,f58,f60,f116,f117,f162,f167";
const INDEX_FIELDS = "f43,f44,f45,f46,f47,f48,f50,f52,f55,f57,f58,f60,f62,f115,f128,f140";
const INDEX_SECIDS = [
  "1.000001",
  // 上证指数
  "0.399001",
  // 深证成指
  "0.399006",
  // 创业板指
  "1.000688"
  // 科创50
];
const EXCHANGE_MAP = {
  "6": 1,
  // SH
  "5": 1,
  // SH 基金/债券
  "0": 0,
  // SZ 主板
  "3": 0,
  // SZ 创业板
  "4": 0,
  // BJ / 新三板
  "8": 0
  // BJ 北交所
};
const QUOTE_TTL = 1e4;
const INDEX_TTL = 15e3;
class EastMoneyAdapter {
  /**
   * @param fetcher 可注入自定义 DataFetcher（便于测试 / 共享限制器）
   */
  constructor(fetcher) {
    this.fetcher = fetcher ?? new DataFetcher();
  }
  // ─── 公开接口 ──────────────────────────────────────────
  /**
   * 获取个股实时行情
   *
   * @param code 股票代码（6 位数字，如 "600519"）
   * @returns StockQuote
   * @throws 股票代码无效 / 网络异常 / API 返回空数据
   */
  async getQuote(code, options) {
    const cleanCode = code.replace(/^(SH|SZ|BJ)/i, "").trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      throw new Error(`无效的股票代码: ${code}，应为 6 位数字`);
    }
    const secid = buildSecId(cleanCode);
    const url = buildStockGetUrl(secid);
    const response = await this.fetcher.fetchJSON(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options
    });
    if (!response.data) {
      throw new Error(`东方财富 API 返回空数据: code=${code}`);
    }
    return parseStockQuote(response.data, cleanCode);
  }
  /**
   * 批量获取个股实时行情
   *
   * @param codes 股票代码数组（每个 6 位数字）
   * @param options 可选覆写请求配置
   * @returns StockQuote[] — 成功解析的行情列表（失败的静默忽略）
   */
  async getQuotes(codes, options) {
    if (codes.length === 0) return [];
    if (codes.length > 50) {
      throw new Error("批量查询最多支持 50 只股票");
    }
    const validCodes = codes.map((c) => c.replace(/^(SH|SZ|BJ)/i, "").trim()).filter((c) => /^\d{6}$/.test(c));
    if (validCodes.length === 0) return [];
    const secids = validCodes.map(buildSecId);
    const url = buildUlistUrl(secids, STOCK_FIELDS);
    const response = await this.fetcher.fetchJSON(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options
    });
    if (!response.data || !response.data.diff) {
      return [];
    }
    return response.data.diff.filter((raw) => raw !== null && raw.f57 !== null).map((raw) => parseStockQuote(raw));
  }
  /**
   * 获取大盘指数数据
   * 返回 [上证指数, 深证成指, 创业板指, 科创50]
   */
  async getMarketIndex(options) {
    const url = buildUlistUrl([...INDEX_SECIDS], INDEX_FIELDS);
    const response = await this.fetcher.fetchJSON(url, {
      useCache: true,
      ttl: INDEX_TTL,
      ...options
    });
    if (!response.data || !response.data.diff) {
      return [];
    }
    return response.data.diff.filter((raw) => raw !== null && raw.f57 !== null).map(parseMarketIndex);
  }
  // ─── 板块/题材接口 ──────────────────────────────────
  /**
   * 获取板块行情列表（按涨幅降序）
   *
   * 请求东方财富行业板块（m:90+t:2），返回涨幅前 20 的板块
   *
   * @param options 可选覆写请求配置
   * @returns SectorData[]
   */
  async getSectors(options) {
    const url = buildClistUrl("m:90+t:2", 20, SECTOR_FIELDS, "f3");
    const response = await this.fetcher.fetchJSON(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options
    });
    if (!response.data || !response.data.diff) {
      return [];
    }
    return response.data.diff.filter((raw) => raw !== null && raw.f12 !== null).map(parseSectorData);
  }
  /**
   * 获取板块明细（含成分股列表）
   *
   * 先通过 ulist.np/get 获取板块元数据（市场 90），
   * 再通过 clist/get 获取成分股行情
   *
   * @param code 板块代码（如 "BK0477" 或 "BK0477"）
   * @param options 可选覆写请求配置
   * @returns SectorDetail
   * @throws 板块代码无效 / 板块不存在
   */
  async getSectorDetail(code, options) {
    var _a2, _b, _c;
    const cleanCode = code.replace(/^BK/i, "").trim().toUpperCase();
    const sectorCode = `BK${cleanCode}`;
    if (!/^BK\d{4}$/i.test(sectorCode)) {
      throw new Error(
        `无效的板块代码: ${code}，应为 BK + 4 位数字（如 BK0477）`
      );
    }
    const secid = `90.${sectorCode}`;
    const metaUrl = buildUlistUrl([secid], SECTOR_FIELDS);
    const metaResp = await this.fetcher.fetchJSON(metaUrl, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options
    });
    if (!((_b = (_a2 = metaResp.data) == null ? void 0 : _a2.diff) == null ? void 0 : _b[0])) {
      throw new Error(`板块不存在: ${sectorCode}`);
    }
    const sector = parseSectorData(metaResp.data.diff[0]);
    const stocksUrl = buildClistUrl(`b:${sectorCode}`, 50, SECTOR_STOCK_FIELDS, "f3");
    const stocksResp = await this.fetcher.fetchJSON(stocksUrl, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options
    });
    const stocks = (((_c = stocksResp.data) == null ? void 0 : _c.diff) ?? []).filter((raw) => raw !== null && raw.f12 !== null).map(parseSectorStock);
    return { sector, stocks };
  }
  /**
   * 获取热门题材/概念列表
   *
   * 请求东方财富概念板块（m:90+t:3），按涨幅降序返回前 20
   *
   * @param options 可选覆写请求配置
   * @returns HotTopic[]
   */
  async getHotTopics(options) {
    const url = buildClistUrl("m:90+t:3", 20, SECTOR_FIELDS, "f3");
    const response = await this.fetcher.fetchJSON(url, {
      useCache: true,
      ttl: QUOTE_TTL,
      ...options
    });
    if (!response.data || !response.data.diff) {
      return [];
    }
    return response.data.diff.filter((raw) => raw !== null && raw.f12 !== null).map(parseHotTopic);
  }
  /**
   * 获取底层 DataFetcher 实例
   * 用于统计 / 缓存操作
   */
  getFetcher() {
    return this.fetcher;
  }
}
function getMarketCode(code) {
  const prefix = code.charAt(0);
  return EXCHANGE_MAP[prefix] ?? 0;
}
function buildSecId(code) {
  const market = getMarketCode(code);
  return `${market}.${code}`;
}
function buildStockGetUrl(secid) {
  const params = new URLSearchParams({
    fltt: "2",
    secid,
    fields: STOCK_FIELDS,
    _: String(Date.now())
  });
  return `${API_BASE}${STOCK_GET_PATH}?${params.toString()}`;
}
function buildClistUrl(fs2, pz, fields, fid = "f3", po = 1) {
  const params = new URLSearchParams({
    pn: "1",
    pz: String(pz),
    po: String(po),
    np: "1",
    fltt: "2",
    invt: "2",
    fid,
    fs: fs2,
    fields,
    _: String(Date.now())
  });
  return `${API_BASE}${CLIST_PATH}?${params.toString()}`;
}
function buildUlistUrl(secids, fields) {
  const params = new URLSearchParams({
    fltt: "2",
    secids: secids.join(","),
    fields,
    _: String(Date.now())
  });
  return `${API_BASE}${ULIST_PATH}?${params.toString()}`;
}
function parseStockQuote(raw, fallbackCode) {
  const code = raw.f57 ?? fallbackCode ?? "000000";
  const price = safeNumber(raw.f43, 0);
  safeNumber(raw.f60, price);
  const change = safeNumber(raw.f52, 0);
  const changePercent = safeNumber(raw.f55, 0);
  return {
    code,
    name: raw.f58 ?? "",
    price,
    change,
    changePercent,
    volume: safeNumber(raw.f47, 0),
    turnover: safeNumber(raw.f48, 0),
    high: safeNumber(raw.f44, price),
    low: safeNumber(raw.f45, price),
    open: safeNumber(raw.f46, price),
    amplitude: safeNumber(raw.f49, 0),
    turnoverRate: safeNumber(raw.f50, 0)
  };
}
function parseMarketIndex(raw) {
  const price = safeNumber(raw.f43, 0);
  const change = safeNumber(raw.f52, 0);
  return {
    code: raw.f57 ?? "000000",
    name: raw.f58 ?? "",
    price,
    change,
    changePercent: safeNumber(raw.f55, 0),
    volume: safeNumber(raw.f47, 0),
    amount: safeNumber(raw.f48, 0)
  };
}
function parseSectorData(raw) {
  const code = raw.f12 ?? "BK0000";
  const leadingStockCode = raw.f62 != null ? String(raw.f62).padStart(6, "0") : "";
  return {
    code,
    name: raw.f14 ?? "",
    changePercent: safeNumber(raw.f3, 0),
    change: safeNumber(raw.f4, 0),
    indexValue: safeNumber(raw.f2, 0),
    leadingStock: raw.f104 ?? "",
    leadingStockCode,
    leadingChange: safeNumber(raw.f128, 0),
    upCount: safeNumber(raw.f140, 0),
    downCount: safeNumber(raw.f141, 0),
    capitalFlow: safeNumber(raw.f142, 0)
  };
}
function parseSectorStock(raw) {
  return {
    code: raw.f12 ?? "000000",
    name: raw.f14 ?? "",
    price: safeNumber(raw.f2, 0),
    changePercent: safeNumber(raw.f3, 0),
    change: safeNumber(raw.f4, 0),
    volume: safeNumber(raw.f5, 0),
    turnover: safeNumber(raw.f6, 0)
  };
}
function parseHotTopic(raw) {
  const code = raw.f12 ?? "BK0000";
  const leadingStockCode = raw.f62 != null ? String(raw.f62).padStart(6, "0") : "";
  return {
    code,
    name: raw.f14 ?? "",
    changePercent: safeNumber(raw.f3, 0),
    change: safeNumber(raw.f4, 0),
    leadingStock: raw.f104 ?? "",
    leadingStockCode,
    leadingChange: safeNumber(raw.f128, 0),
    upCount: safeNumber(raw.f140, 0),
    downCount: safeNumber(raw.f141, 0),
    capitalFlow: safeNumber(raw.f142, 0)
  };
}
function safeNumber(value, fallback) {
  if (value === null || value === void 0) return fallback;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
const LOG_PREFIX = "[xvqiu]";
const levelOrder = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
const currentLevel = typeof window !== "undefined" && (window.location.search.includes("debug=true") || ((_a = window.localStorage) == null ? void 0 : _a.getItem("xvqiu_debug")) === "true") ? "debug" : "info";
function log(level, ...args) {
  if (levelOrder[level] < levelOrder[currentLevel]) return;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : level === "info" ? console.info : console.log;
  fn(LOG_PREFIX, `[${level.toUpperCase()}]`, ...args);
}
const logger$1 = {
  debug: (...args) => log("debug", ...args),
  info: (...args) => log("info", ...args),
  warn: (...args) => log("warn", ...args),
  error: (...args) => log("error", ...args)
};
const WEIGHTS$1 = {
  INDEX_TREND: 0.35,
  // 指数趋势权重
  SECTOR_EFFECT: 0.25,
  // 板块效应权重
  VOLUME: 0.2,
  // 成交量能权重
  MARKET_BREADTH: 0.2
  // 市场宽度（涨跌家数等）
};
class L1MarketAnalyzer {
  /**
   * 全量分析市场环境
   *
   * @param indices  - 大盘指数列表（上证/深证/创业板/科创50）
   * @param sectors  - 板块行情列表（用于判断板块效应）
   * @param prevIndices - 前一日指数数据（用于判断趋势变化，可选）
   * @returns MarketEnvResult
   */
  async analyze(indices, sectors, prevIndices) {
    if (indices.length === 0) {
      logger$1.warn("[L1] 无指数数据，返回默认环境");
      return {
        envLevel: "B",
        sentiment: "数据不足",
        suggestion: "等待数据更新后再做判断"
      };
    }
    const indexScore = this.scoreIndexTrend(indices, prevIndices);
    const sectorScore = this.scoreSectorEffect(sectors);
    const volumeScore = this.scoreVolume(indices);
    const breadthScore = this.scoreMarketBreadth(indices, sectors);
    const totalScore = indexScore * WEIGHTS$1.INDEX_TREND + sectorScore * WEIGHTS$1.SECTOR_EFFECT + volumeScore * WEIGHTS$1.VOLUME + breadthScore * WEIGHTS$1.MARKET_BREADTH;
    const envLevel = this.scoreToLevel(totalScore);
    const sentiment = this.describeSentiment(indices, envLevel);
    const suggestion = this.getSuggestion(envLevel, totalScore, indices);
    logger$1.debug("[L1] 环境评分结果:", {
      indexScore: indexScore.toFixed(1),
      sectorScore: sectorScore.toFixed(1),
      volumeScore: volumeScore.toFixed(1),
      breadthScore: breadthScore.toFixed(1),
      totalScore: totalScore.toFixed(1),
      envLevel
    });
    return { envLevel, sentiment, suggestion };
  }
  /**
   * 快速判断 — 只给评级，不做详细打分
   * 用于获取数据的模块内部快速判断
   */
  quickAssess(indices) {
    if (indices.length === 0) return "B";
    try {
      const avgChange = this.averageChange(indices);
      if (avgChange >= 1.5) return "S";
      if (avgChange >= 0.5) return "A";
      if (avgChange >= -0.5) return "B";
      if (avgChange >= -1.5) return "C";
      return "D";
    } catch {
      return "B";
    }
  }
  // ─── 评分方法 ──────────────────────────────────────
  /**
   * 指数趋势评分 (0-100)
   * - 各指数的涨跌幅平均值
   * - 上证/创业板加权（更重要的指数赋予更高权重）
   */
  scoreIndexTrend(indices, prevIndices) {
    if (indices.length === 0) return 50;
    const avgChange = this.averageChange(indices);
    let score = 50 + avgChange / 3 * 50;
    score = Math.max(0, Math.min(100, score));
    if (prevIndices && prevIndices.length > 0) {
      const prevAvgChange = this.averageChange(prevIndices);
      const improvement = avgChange - prevAvgChange;
      if (improvement > 0.5) {
        score += 10;
      } else if (improvement < -0.5) {
        score -= 10;
      }
    }
    return Math.max(0, Math.min(100, score));
  }
  /**
   * 板块效应评分 (0-100)
   * - 上涨板块比例
   * - 领涨板块的涨幅强度
   */
  scoreSectorEffect(sectors) {
    if (sectors.length === 0) return 50;
    const upCount = sectors.filter((s) => s.changePercent > 0).length;
    const upRatio = upCount / sectors.length;
    const top3Avg = sectors.slice(0, 3).reduce((sum, s) => sum + Math.max(0, s.changePercent), 0) / 3;
    const ratioScore = upRatio * 100;
    const strengthScore = Math.min(100, top3Avg / 5 * 100);
    return ratioScore * 0.6 + strengthScore * 0.4;
  }
  /**
   * 成交量能评分 (0-100)
   * - 比较各指数的成交量与成交额变化
   * - 放量上涨 = 健康
   * - 缩量下跌 = 弱势
   */
  scoreVolume(indices) {
    if (indices.length === 0) return 50;
    indices.find(
      (i) => i.code === "000001" || i.name.includes("上证")
    );
    indices.find(
      (i) => i.code === "399001" || i.name.includes("深证")
    );
    const avgChange = this.averageChange(indices);
    if (avgChange > 1) return 70;
    if (avgChange > 0) return 60;
    if (avgChange > -0.5) return 50;
    if (avgChange > -1.5) return 30;
    return 20;
  }
  /**
   * 市场宽度评分 (0-100)
   * - 上涨/下跌家数比（通过板块数据估算）
   * - 涨停/跌停数量
   */
  scoreMarketBreadth(indices, sectors) {
    if (indices.length === 0 && sectors.length === 0) return 50;
    let sectorRatio = 0.5;
    if (sectors.length > 0) {
      const upCount = sectors.filter((s) => s.changePercent > 0).length;
      sectorRatio = upCount / sectors.length;
    }
    const ratioScore = sectorRatio * 100;
    let breadthBonus = 0;
    const sectorWithBreadth = sectors.filter(
      (s) => s.upCount > 0 || s.downCount > 0
    );
    if (sectorWithBreadth.length > 0) {
      const avgUpDownRatio = sectorWithBreadth.reduce((sum, s) => {
        const total = s.upCount + s.downCount;
        return total > 0 ? sum + s.upCount / total : sum;
      }, 0) / sectorWithBreadth.length;
      breadthBonus = (avgUpDownRatio - 0.5) * 40;
    }
    return Math.max(0, Math.min(100, ratioScore * 0.7 + breadthBonus));
  }
  // ─── 辅助方法 ──────────────────────────────────────
  /** 计算指数平均涨跌幅 */
  averageChange(indices) {
    if (indices.length === 0) return 0;
    return indices.reduce((sum, idx) => sum + idx.changePercent, 0) / indices.length;
  }
  /** 分数 → 环境评级 */
  scoreToLevel(score) {
    if (score >= 80) return "S";
    if (score >= 60) return "A";
    if (score >= 40) return "B";
    if (score >= 20) return "C";
    return "D";
  }
  /** 生成情绪描述 */
  describeSentiment(indices, level) {
    const avgChange = this.averageChange(indices);
    const sentimentMap = {
      S: ["情绪亢奋", "赚钱效应强", "市场全面活跃"],
      A: ["情绪偏多", "赚钱效应较好", "市场健康"],
      B: ["情绪中性", "赚钱效应一般", "市场震荡"],
      C: ["情绪偏空", "亏钱效应明显", "市场低迷"],
      D: ["情绪恐慌", "系统性风险", "市场极端弱势"]
    };
    const options = sentimentMap[level];
    if (avgChange > 2) return options[0];
    if (avgChange > 0.5) return options[1];
    return options[2];
  }
  /** 获取仓位/风格建议 */
  getSuggestion(level, score, indices) {
    const avgChange = this.averageChange(indices);
    switch (level) {
      case "S":
        return avgChange > 2 ? "可积极做多，仓位 7-8 成，追涨需谨慎" : "可适当加仓，仓位 5-7 成，围绕主线操作";
      case "A":
        return "仓位 4-6 成，聚焦主线，避免追高";
      case "B":
        return "仓位 3-5 成，谨慎操作，快进快出";
      case "C":
        return "仓位 1-3 成，防守为主，仅做核心龙头";
      case "D":
        return "空仓或极轻仓，不建议开新仓";
    }
  }
}
const WEIGHTS = {
  CHANGE: 0.3,
  // 涨幅权重
  BREADTH: 0.25,
  // 广度（涨跌比）权重
  CAPITAL: 0.25,
  // 资金流向权重
  LEADING: 0.2
  // 领涨股强度权重
};
const THRESHOLDS = {
  MAIN_LINE: 65,
  // ≥65分 → 主线
  SUB_LINE: 40
  // ≥40分 → 次线
  // <40分 → 一般方向
};
const MAX_DIRECTIONS = 3;
class L2DirectionAnalyzer {
  /**
   * 分析当前市场方向
   *
   * @param sectors - 行业板块行情列表（从东方财富获取）
   * @param topics  - 概念/题材列表
   * @returns DirectionResult[] — 按优先级排序的方向列表
   */
  async analyze(sectors, topics) {
    if (sectors.length === 0 && (!topics || topics.length === 0)) {
      logger$1.warn("[L2] 无板块/题材数据，返回空方向");
      return [];
    }
    const scored = [];
    for (const sector of sectors) {
      const score = this.calculateCompositeScore(sector);
      scored.push({
        name: sector.name,
        code: sector.code,
        changePercent: sector.changePercent,
        upRatio: sector.upCount + sector.downCount > 0 ? sector.upCount / (sector.upCount + sector.downCount) : 0.5,
        capitalFlow: sector.capitalFlow,
        compositeScore: score,
        type: "sector"
      });
    }
    if (topics) {
      for (const topic of topics) {
        const score = this.calculateTopicScore(topic);
        scored.push({
          name: topic.name,
          code: topic.code,
          changePercent: topic.changePercent,
          upRatio: topic.upCount + topic.downCount > 0 ? topic.upCount / (topic.upCount + topic.downCount) : 0.5,
          capitalFlow: topic.capitalFlow,
          compositeScore: score,
          type: "topic"
        });
      }
    }
    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    const mainLines = [];
    const subLines = [];
    for (const d of scored.slice(0, 10)) {
      if (d.compositeScore >= THRESHOLDS.MAIN_LINE) {
        if (!this.isDuplicateDirection(mainLines, d)) {
          mainLines.push(d);
        }
      } else if (d.compositeScore >= THRESHOLDS.SUB_LINE) {
        if (!this.isDuplicateDirection(subLines, d)) {
          subLines.push(d);
        }
      }
    }
    const results = [];
    let rank = 0;
    for (const d of mainLines.slice(0, 2)) {
      rank++;
      results.push({
        mainLine: d.name,
        subLine: rank === 1 ? "主线核心" : "主线延伸/补涨",
        recommendations: []
        // L3 分析后填充
      });
    }
    if (subLines.length > 0 && results.length < MAX_DIRECTIONS) {
      const d = subLines[0];
      results.push({
        mainLine: d.name,
        subLine: "次线/轮动方向",
        recommendations: []
      });
    }
    if (results.length === 0) {
      results.push({
        mainLine: "无明显主线",
        subLine: "快速轮动/防守",
        recommendations: []
      });
    }
    logger$1.debug("[L2] 方向分析结果:", {
      analyzed: scored.length,
      mainLines: mainLines.map((d) => `${d.name}(${d.compositeScore.toFixed(0)}分)`),
      subLines: subLines.map((d) => `${d.name}(${d.compositeScore.toFixed(0)}分)`)
    });
    return results;
  }
  /**
   * 获取当前最强方向（仅返回第一条主线）
   * 用于快速判断方向偏好
   */
  async getPrimaryDirection(sectors, topics) {
    const directions = await this.analyze(sectors, topics);
    return directions.length > 0 ? directions[0] : null;
  }
  // ─── 评分方法 ──────────────────────────────────────
  /**
   * 计算板块方向的综合评分 (0-100)
   */
  calculateCompositeScore(sector) {
    const changeScore = Math.max(0, Math.min(
      100,
      30 + sector.changePercent / 5 * 70
    ));
    const total = sector.upCount + sector.downCount;
    const breadthScore = total > 0 ? sector.upCount / total * 100 : 50;
    const capitalScore = Math.max(0, Math.min(
      100,
      50 + sector.capitalFlow / 1e5 * 50
    ));
    const leadingScore = Math.max(0, Math.min(
      100,
      50 + sector.leadingChange / 10 * 50
    ));
    return changeScore * WEIGHTS.CHANGE + breadthScore * WEIGHTS.BREADTH + capitalScore * WEIGHTS.CAPITAL + leadingScore * WEIGHTS.LEADING;
  }
  /**
   * 计算概念题材的综合评分 (0-100)
   * 概念数据结构与板块略有不同
   */
  calculateTopicScore(topic) {
    const changeScore = Math.max(0, Math.min(
      100,
      30 + topic.changePercent / 5 * 70
    ));
    const total = topic.upCount + topic.downCount;
    const breadthScore = total > 0 ? topic.upCount / total * 100 : 50;
    const capitalScore = Math.max(0, Math.min(
      100,
      50 + topic.capitalFlow / 1e5 * 50
    ));
    const leadingScore = Math.max(0, Math.min(
      100,
      50 + topic.leadingChange / 10 * 50
    ));
    return changeScore * 0.35 + breadthScore * 0.3 + capitalScore * 0.2 + leadingScore * 0.15;
  }
  // ─── 辅助方法 ──────────────────────────────────────
  /**
   * 检查是否为重复方向（名称相似的主题/板块去重）
   */
  isDuplicateDirection(existing, candidate) {
    return existing.some((d) => {
      const nameA = d.name.replace(/[板块概念题材]/g, "");
      const nameB = candidate.name.replace(/[板块概念题材]/g, "");
      return nameA.includes(nameB) || nameB.includes(nameA);
    });
  }
}
const LIMIT_UP_THRESHOLD = 9.8;
const LIMIT_DOWN_THRESHOLD = -9.8;
const TURNOVER = {
  LOW: 3,
  // <3% 低换手
  MEDIUM: 8,
  // 3-8% 正常换手
  HIGH: 15
  // 8-15% 活跃换手
  // >15% 极高换手
};
const AMPLITUDE = {
  // <3% 窄幅
  NORMAL: 6,
  // 3-6% 正常
  WIDE: 10
  // 6-10% 宽幅
  // >10% 巨幅
};
class L3StockAnalyzer {
  /**
   * 对一组股票进行五维评估
   *
   * 纯数据驱动的分析（不依赖 LLM），为 LLM 提供结构化输入
   *
   * @param quotes   - 个股行情数据
   * @param indices  - 大盘指数（用于判断相对强度）
   * @param sectors  - 板块行情（用于判断板块归属强度）
   * @returns StockAnalysisResult[]
   */
  async analyze(quotes, indices, sectors) {
    if (quotes.length === 0) return [];
    const avgMarketChange = this.getAvgMarketChange(indices);
    const sectorMap = this.buildSectorMap(sectors);
    const results = [];
    for (const quote of quotes) {
      try {
        const result = this.analyzeSingle(
          quote,
          avgMarketChange,
          sectorMap
        );
        results.push(result);
      } catch (err) {
        logger$1.warn(`[L3] 分析 ${quote.code} 失败:`, err);
        results.push({
          stock: quote.name,
          code: quote.code,
          position: "数据不足",
          strength: "--",
          volumeAnalysis: "--",
          logic: "待 LLM 补充",
          risk: ["数据不完整"],
          buyPoint: "待定"
        });
      }
    }
    logger$1.debug(`[L3] 个股分析完成: ${results.length} 只`);
    return results;
  }
  /**
   * 分析单只个股
   */
  analyzeSingle(quote, avgMarketChange, sectorMap) {
    const position = this.assessPosition(quote);
    const strength = this.assessStrength(quote, avgMarketChange);
    const volumeAnalysis = this.assessVolumePrice(quote);
    const logic = this.inferLogic(quote);
    const risk = this.assessRisk(quote);
    const buyPoint = this.suggestBuyPoint(quote, position);
    return {
      stock: quote.name,
      code: quote.code,
      position,
      strength,
      volumeAnalysis,
      logic,
      risk,
      buyPoint
    };
  }
  // ─── 位置评估 ──────────────────────────────────────
  /**
   * 位置评估（基于涨跌幅、换手、振幅的综合判断）
   *
   * 策略:
   *   - 大涨 + 高换手 + 宽振幅 → "高位/突破"
   *   - 小涨 + 低换手 + 窄振幅 → "低位"
   *   - 大跌 + 放量 → "回调/破位"
   */
  assessPosition(quote) {
    const { changePercent, turnoverRate, amplitude } = quote;
    if (changePercent >= LIMIT_UP_THRESHOLD) {
      if (turnoverRate > TURNOVER.HIGH) return "放量涨停(高位)";
      if (turnoverRate > TURNOVER.MEDIUM) return "涨停(中位)";
      return "缩量涨停(强势)";
    }
    if (changePercent <= LIMIT_DOWN_THRESHOLD) {
      if (turnoverRate > TURNOVER.MEDIUM) return "放量跌停(危险)";
      return "跌停(弱势)";
    }
    if (changePercent > 3) {
      if (amplitude > AMPLITUDE.WIDE) return "宽幅上涨(突破区)";
      if (amplitude > AMPLITUDE.NORMAL) return "震荡上涨(中位)";
      return "稳步上涨(趋势中)";
    }
    if (changePercent > 0) {
      if (turnoverRate < TURNOVER.LOW) return "缩量微涨(低位盘整)";
      return "温和上涨(中位)";
    }
    if (changePercent > -3) {
      if (turnoverRate < TURNOVER.LOW) return "缩量微跌(低位)";
      return "放量微跌(承压)";
    }
    if (turnoverRate > TURNOVER.MEDIUM) return "放量下跌(破位)";
    return "缩量下跌(回调)";
  }
  // ─── 强度评估 ──────────────────────────────────────
  /**
   * 个股相对大盘的强度
   *
   * 策略:
   *   - 个股涨幅 > 大盘 +2% → 强
   *   - 个股涨幅 ≈ 大盘 → 中
   *   - 个股涨幅 < 大盘 -2% → 弱
   */
  assessStrength(quote, avgMarketChange) {
    const relativeStrength = quote.changePercent - avgMarketChange;
    if (quote.changePercent >= LIMIT_UP_THRESHOLD) return "极强(涨停)";
    if (relativeStrength > 3) return "强(远超大盘)";
    if (relativeStrength > 0) return "偏强(强于大盘)";
    if (relativeStrength > -2) return "中性(与大盘同步)";
    if (relativeStrength > -5) return "偏弱(弱于大盘)";
    return "弱(远弱于大盘)";
  }
  // ─── 量价分析 ──────────────────────────────────────
  /**
   * 量价配合关系分析
   */
  assessVolumePrice(quote) {
    const { changePercent, turnoverRate, amplitude } = quote;
    if (changePercent >= LIMIT_UP_THRESHOLD) {
      if (turnoverRate < TURNOVER.LOW) return "缩量涨停(筹码锁定好)";
      if (turnoverRate < TURNOVER.MEDIUM) return "温和放量涨停(健康)";
      return "放量涨停(分歧大)";
    }
    if (changePercent > 3) {
      if (turnoverRate > TURNOVER.HIGH) return "放量上攻(资金活跃)";
      if (turnoverRate > TURNOVER.MEDIUM) return "量价配合(正常)";
      return "缩量上涨(抛压轻)";
    }
    if (changePercent > 0) {
      if (turnoverRate > TURNOVER.MEDIUM) return "放量滞涨(需警惕)";
      return "量平价稳(正常)";
    }
    if (changePercent > -3) {
      if (turnoverRate > TURNOVER.MEDIUM) return "放量滞跌(有承接)";
      return "缩量微跌(正常调整)";
    }
    if (turnoverRate > TURNOVER.MEDIUM) return "放量下跌(资金出逃)";
    if (amplitude > AMPLITUDE.WIDE) return "宽幅震荡下跌(分歧)";
    return "缩量下跌(无人接盘)";
  }
  // ─── 逻辑推断（数据层面） ──────────────────────────
  /**
   * 基于数据推断可能的上涨逻辑
   * 具体逻辑需 LLM 补充，这里只做数据层面的提示
   */
  inferLogic(quote) {
    const { changePercent, turnoverRate, amplitude } = quote;
    if (changePercent >= LIMIT_UP_THRESHOLD) {
      return "涨停 — 可能有消息/题材驱动，需 LLM 确认具体逻辑";
    }
    if (changePercent > 5) {
      return "大幅上涨 — 资金主动买入，需 LLM 确认驱动因素";
    }
    if (changePercent > 2) {
      if (turnoverRate > TURNOVER.MEDIUM) {
        return "放量上涨 — 资金介入明显，需 LLM 判断题材属性";
      }
      return "温和上涨 — 趋势延续，需 LLM 判断逻辑强度";
    }
    if (Math.abs(changePercent) <= 2) {
      if (turnoverRate < TURNOVER.LOW) {
        return "缩量整理 — 等待方向选择，需 LLM 判断中期逻辑";
      }
      return "震荡 — 多空平衡，需 LLM 分析题材催化";
    }
    return "下跌 — 需 LLM 判断是洗盘还是出货";
  }
  // ─── 风险评估 ──────────────────────────────────────
  /**
   * 数据层面的风险识别
   */
  assessRisk(quote) {
    const risks = [];
    const { changePercent, turnoverRate, amplitude, high, low, price } = quote;
    if (changePercent > 7) {
      risks.push("短线涨幅已大，追高有回调风险");
    }
    if (turnoverRate > TURNOVER.HIGH) {
      risks.push("换手率过高，筹码松动");
    }
    if (amplitude > AMPLITUDE.WIDE) {
      risks.push("波动剧烈，多空分歧大");
    }
    if (changePercent < -5) {
      risks.push("趋势走弱，下方支撑不明");
    }
    if (changePercent < -2 && turnoverRate > TURNOVER.MEDIUM) {
      risks.push("放量下跌，资金出逃");
    }
    if (changePercent > 3 && turnoverRate < TURNOVER.LOW) {
      risks.push("缩量上涨，持续性存疑");
    }
    if (amplitude > AMPLITUDE.NORMAL && changePercent < 0 && high > price * 1.03) {
      risks.push("高开低走，抛压沉重");
    }
    if (risks.length === 0) {
      risks.push("大盘系统性风险");
    }
    return risks;
  }
  // ─── 买入点位建议 ──────────────────────────────────
  /**
   * 基于当前位置和状态建议买入点位
   */
  suggestBuyPoint(quote, position) {
    const { price, low, high } = quote;
    if (position.includes("涨停")) {
      return `打板确认/排板，不低吸`;
    }
    if (position.includes("高位") || position.includes("突破")) {
      return `回调至 ${low.toFixed(2)} 附近低吸`;
    }
    if (position.includes("低位") || position.includes("盘整")) {
      return `现价附近分批建仓 ${(price * 0.98).toFixed(2)}-${(price * 1.02).toFixed(2)}`;
    }
    if (position.includes("回调") || position.includes("下跌")) {
      return `等待企稳信号，关注 ${low.toFixed(2)} 支撑`;
    }
    return `现价 ${price} 附近观察`;
  }
  // ─── 辅助方法 ──────────────────────────────────────
  /** 获取大盘平均涨跌幅 */
  getAvgMarketChange(indices) {
    if (!indices || indices.length === 0) return 0;
    return indices.reduce((sum, idx) => sum + idx.changePercent, 0) / indices.length;
  }
  /** 构建板块代码→涨跌幅 映射 */
  buildSectorMap(sectors) {
    const map = /* @__PURE__ */ new Map();
    if (sectors) {
      for (const s of sectors) {
        map.set(s.code, s.changePercent);
      }
    }
    return map;
  }
}
class L4ParseError extends Error {
  constructor(message, rawText, parseStage) {
    super(message);
    this.rawText = rawText;
    this.parseStage = parseStage;
    this.name = "L4ParseError";
  }
}
const VALID_ENV_LEVELS = ["S", "A", "B", "C", "D"];
const VALID_VERDICTS = ["BUY", "COND_BUY", "WATCH", "NO_BUY"];
class L4ConclusionEngine {
  /**
   * 解析并处理 LLM 输出
   *
   * @param llmOutput - DeepSeek 返回的 content 字符串（预期为 JSON）
   * @param fallback  - 可选 fallback 数据（用于 LLM 部分失败时的降级）
   * @returns 完整的 AnalysisResult
   * @throws L4ParseError 当 JSON 解析完全失败时
   */
  async process(llmOutput, fallback) {
    if (!llmOutput || llmOutput.trim().length === 0) {
      throw new L4ParseError("LLM 输出为空", llmOutput, "empty");
    }
    const cleaned = this.cleanLLMOutput(llmOutput);
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const repaired = this.attemptJSONRepair(cleaned);
      if (repaired !== null) {
        parsed = repaired;
      } else {
        throw new L4ParseError(
          `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
          llmOutput,
          "json-parse"
        );
      }
    }
    const marketEnv = this.parseMarketEnv(parsed.marketEnv, fallback == null ? void 0 : fallback.envLevel);
    const directions = this.parseDirections(parsed.directions);
    const stocks = this.parseStocks(parsed.stocks);
    const conclusions = this.parseConclusions(
      parsed.conclusions,
      fallback == null ? void 0 : fallback.stockCodes
    );
    if (conclusions.length === 0 && (fallback == null ? void 0 : fallback.stockCodes)) {
      logger$1.warn("[L4] LLM 未输出结论，使用 fallback");
      for (const code of fallback.stockCodes) {
        conclusions.push({
          stockCode: code,
          stockName: code,
          verdict: "WATCH",
          reason: "LLM 未给出结论，默认观察",
          riskPoints: ["数据不足"],
          priority: 99
        });
      }
    }
    conclusions.sort((a, b) => a.priority - b.priority);
    this.normalizePriorities(conclusions);
    const result = {
      marketEnv,
      directions,
      stocks,
      conclusions,
      timestamp: Date.now()
    };
    logger$1.debug("[L4] 结论处理完成:", {
      envLevel: marketEnv.envLevel,
      directions: directions.length,
      stocks: stocks.length,
      conclusions: conclusions.length,
      buyCount: conclusions.filter((c) => c.verdict === "BUY").length
    });
    return result;
  }
  /**
   * 快速校验 LLM 输出是否为有效 JSON
   * 用于流式场景下的实时校验
   */
  validateChunk(text) {
    const cleaned = this.cleanLLMOutput(text);
    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== "object") {
        return { valid: false, reason: "非对象" };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: "JSON 语法错误" };
    }
  }
  // ─── 内部解析方法 ──────────────────────────────────
  /**
   * 解析市场环境部分
   */
  parseMarketEnv(raw, fallbackLevel) {
    var _a2, _b;
    const defaultResult = {
      envLevel: fallbackLevel ?? "B",
      sentiment: "数据不足",
      suggestion: "等待数据更新"
    };
    if (!raw) return defaultResult;
    const envLevel = this.normalizeEnvLevel(raw.envLevel) ?? defaultResult.envLevel;
    const sentiment = ((_a2 = raw.sentiment) == null ? void 0 : _a2.trim()) || defaultResult.sentiment;
    const suggestion = ((_b = raw.suggestion) == null ? void 0 : _b.trim()) || defaultResult.suggestion;
    return { envLevel, sentiment, suggestion };
  }
  /**
   * 解析方向部分
   */
  parseDirections(raw) {
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }
    return raw.filter((d) => d && d.mainLine).map((d) => ({
      mainLine: d.mainLine ?? "未知方向",
      subLine: d.subLine ?? "",
      recommendations: Array.isArray(d.recommendations) ? d.recommendations : []
    }));
  }
  /**
   * 解析个股分析部分
   */
  parseStocks(raw) {
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }
    return raw.filter((s) => s && (s.stock || s.code)).map((s) => ({
      stock: s.stock ?? s.code ?? "未知",
      code: s.code ?? "",
      position: s.position ?? "--",
      strength: s.strength ?? "--",
      volumeAnalysis: s.volumeAnalysis ?? "--",
      logic: s.logic ?? "--",
      risk: Array.isArray(s.risk) ? s.risk : ["未知风险"],
      buyPoint: s.buyPoint ?? "--"
    }));
  }
  /**
   * 解析结论部分
   */
  parseConclusions(raw, stockCodes) {
    var _a2;
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return [];
    }
    const results = [];
    for (const c of raw) {
      if (!c || !c.stockCode && !c.stockName) continue;
      const verdict = this.normalizeVerdict(c.verdict);
      if (!verdict) {
        logger$1.warn(`[L4] 忽略无效 verdict: ${c.verdict}`);
        continue;
      }
      results.push({
        stockCode: c.stockCode ?? c.stockName ?? "未知",
        stockName: c.stockName ?? c.stockCode ?? "未知",
        verdict,
        reason: ((_a2 = c.reason) == null ? void 0 : _a2.trim()) || "无说明",
        riskPoints: Array.isArray(c.riskPoints) && c.riskPoints.length > 0 ? c.riskPoints : ["未指明风险"],
        priority: typeof c.priority === "number" ? c.priority : 999
      });
    }
    return results;
  }
  // ─── 规范化 ──────────────────────────────────────────
  /** 规范化环境评级 */
  normalizeEnvLevel(value) {
    if (!value) return null;
    const upper = value.toUpperCase().trim();
    return VALID_ENV_LEVELS.includes(upper) ? upper : null;
  }
  /** 规范化结论 */
  normalizeVerdict(value) {
    if (!value) return null;
    const upper = value.toUpperCase().trim();
    if (VALID_VERDICTS.includes(upper)) return upper;
    if (upper.includes("BUY") || upper.includes("买")) return "COND_BUY";
    if (upper.includes("WATCH") || upper.includes("观") || upper.includes("察")) return "WATCH";
    if (upper.includes("NO") || upper.includes("不") || upper.includes("放弃")) return "NO_BUY";
    return null;
  }
  /**
   * 规范化结论优先级
   * 确保：1) 连续无断档 2) BUY 最高优先级
   */
  normalizePriorities(conclusions) {
    const prioritized = conclusions.sort((a, b) => {
      const aWeight = this.verdictWeight(a.verdict);
      const bWeight = this.verdictWeight(b.verdict);
      if (aWeight !== bWeight) return aWeight - bWeight;
      return (a.priority ?? 999) - (b.priority ?? 999);
    });
    prioritized.forEach((c, i) => {
      c.priority = i + 1;
    });
  }
  /** 结论类型权重（用于排序） */
  verdictWeight(verdict) {
    switch (verdict) {
      case "BUY":
        return 1;
      case "COND_BUY":
        return 2;
      case "WATCH":
        return 3;
      case "NO_BUY":
        return 4;
    }
  }
  // ─── 清理 & 修复 ──────────────────────────────────
  /**
   * 清理 LLM 输出
   * - 去除 markdown 代码块标记: ```json ... ```
   * - 去除首尾空白
   * - 去除 BOM
   */
  cleanLLMOutput(text) {
    let cleaned = text.trim();
    if (cleaned.charCodeAt(0) === 65279) {
      cleaned = cleaned.slice(1);
    }
    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    }
    cleaned = cleaned.replace(/^```(?:json)?\s*/gm, "").replace(/```\s*$/gm, "");
    return cleaned.trim();
  }
  /**
   * 尝试修复常见 JSON 错误
   * - 末尾多余的逗号
   * - 单引号代替双引号
   * - 缺少引号的键名
   * - 注释
   */
  attemptJSONRepair(text) {
    let repaired = text;
    repaired = repaired.replace(/\/\/.*$/gm, "");
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, "");
    repaired = repaired.replace(/'/g, '"');
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}
const SYSTEM_PROMPT = `你是一位A股短线交易决策助手，专注于A股沪深主板/创业板/科创板的短线交易机会识别。

【核心定位】
- 市场：A股沪深主板/创业板/科创板
- 风格：短线交易（日内/隔日/短持，通常持仓1-5天）
- 目标：从给定股票池中，找出值得做的机会，排除不适合的机会
- 理念：宁可错过，不可做错；先看环境，再看个股

【四层分析框架】
你必须严格按照以下顺序逐层分析，每一层的输出是下一层的输入：

## L1: 市场环境判断
分析当前市场整体环境，包括：
1. 大盘指数状态（上证/深证/创业板/科创50）——趋势、位置、成交量
2. 市场情绪（涨跌家数比、涨停/跌停数量、连板高度）
3. 赚钱效应（昨日涨停今日表现、板块持续性）
4. 成交量能（全市成交额是否放量/缩量）

输出：环境评级 (S/A/B/C/D) + 仓位建议 + 风格偏好

## L2: 方向判断
在确定了市场环境后，识别当前有持续性的方向：
1. 主线方向（资金最集中的板块/题材）
2. 次主线方向（有轮动潜力的方向）
3. 个股方向（独立逻辑个股）

输出：主线/次主线排序 + 各方向逻辑强度 + 推荐关注度

## L3: 个股分析
对每一只候选股票进行五维评估：
1. 位置：股价在趋势中的位置（低位/中位/高位/突破）
2. 强度：相对大盘和板块的强度（强/中/弱）
3. 量价：量价配合关系（放量突破/缩量回调/量价背离）
4. 逻辑：上涨驱动逻辑的确定性（业绩/政策/题材/公告）
5. 风险：潜在风险点（减持/解禁/业绩雷/高位/板块退潮）

输出：每只股票的详细五维评分

## L4: 结论输出
基于以上三层分析，给出最终交易结论：

【结论枚举】
1. "BUY" — 可直接试仓买入（环境好、方向对、个股强、风险低）
2. "COND_BUY" — 条件满足后才可买入（说明具体条件）
3. "WATCH" — 只可观察，不可买入（等待更好的时机）
4. "NO_BUY" — 明确不买（说明具体原因）

【交易纪律】
- 环境评级 C/D 时，只做最核心的主线，降低仓位
- 环境评级 D 时，原则上不推荐买入
- 单票买入必须有明确的买入点位描述
- 必须为每只票列出至少1个风险点
- 必须对所有分析票做优先级排序

【输出格式约束】
1. 最终输出必须是严格的 JSON 格式（见输出 Schema）
2. 禁止在 JSON 外套 markdown 代码块
3. 禁止添加 JSON 之外的文字说明
4. 禁止模糊表达（如"可以关注"、"高抛低吸"、"逢低买入"等）
5. 禁止跳过环境分析直接推荐个股
6. 禁止不做优先级排序
7. 禁止把判断责任推给用户`;
function buildFullSystemPrompt(options) {
  const parts = [SYSTEM_PROMPT];
  if (options == null ? void 0 : options.dynamicContext) {
    parts.push(`

【当前市场数据上下文】
${options.dynamicContext}`);
  }
  if (options == null ? void 0 : options.selectedStocks) {
    parts.push(`

【待分析股票池】
${options.selectedStocks}`);
  }
  parts.push(`

【输出 JSON Schema】
你必须在分析完成后输出如下 JSON 结构（禁止加代码块标记，直接输出 JSON）：

{
  "marketEnv": {
    "envLevel": "S|A|B|C|D",
    "sentiment": "市场情绪描述（20字以内）",
    "suggestion": "仓位及风格建议（30字以内）"
  },
  "directions": [
    {
      "mainLine": "主线方向名称",
      "subLine": "次线/分支方向",
      "recommendations": ["推荐关注个股列表"]
    }
  ],
  "stocks": [
    {
      "stock": "股票名称",
      "code": "股票代码",
      "position": "位置评估",
      "strength": "强度评估",
      "volumeAnalysis": "量价分析",
      "logic": "上涨逻辑",
      "risk": ["风险点1", "风险点2"],
      "buyPoint": "买入点位描述"
    }
  ],
  "conclusions": [
    {
      "stockCode": "股票代码",
      "stockName": "股票名称",
      "verdict": "BUY|COND_BUY|WATCH|NO_BUY",
      "reason": "结论理由（20字以内）",
      "riskPoints": ["风险点1", "风险点2"],
      "priority": 1
    }
  ]
}

注意事项：
- conclusions 数组必须按 priority 升序排列（1为最高优先级）
- verdict 必须是 BUY / COND_BUY / WATCH / NO_BUY 其中之一
- 每只分析票必须出现在 conclusions 中
- riskPoints 不能为空数组（每只票至少1个风险点）`);
  return parts.join("\n");
}
function buildEnvOnlyPrompt(options) {
  const parts = [
    `你是一位A股短线交易决策助手。请仅分析当前市场环境，不需要推荐个股。

【要求】
1. 分析大盘指数状态、市场情绪、赚钱效应、成交量能
2. 给出环境评级 (S/A/B/C/D)
3. 给出仓位建议和风格偏好

【输出 JSON Schema】
{
  "envLevel": "S|A|B|C|D",
  "sentiment": "市场情绪描述（20字以内）",
  "suggestion": "仓位及风格建议（30字以内）"
}

禁止在 JSON 外套 markdown 代码块。`
  ];
  if (options == null ? void 0 : options.dynamicContext) {
    parts.push(`

【当前市场数据】
${options.dynamicContext}`);
  }
  return parts.join("\n");
}
function buildSingleStockPrompt(options) {
  const envContext = (options == null ? void 0 : options.dynamicContext) ? `

【当前市场数据】
${options.dynamicContext}` : "\n\n【注意】未提供市场环境数据，请仅根据个股数据做技术面和基本面分析。";
  return `你是一位A股短线交易决策助手。请分析给定的单只股票。

${envContext}

【输出 JSON Schema】
{
  "stock": "股票名称",
  "code": "股票代码",
  "position": "位置评估（低位/中位/高位/突破）",
  "strength": "强度评估（强/中/弱）",
  "volumeAnalysis": "量价分析（放量/缩量/量价配合/背离）",
  "logic": "上涨驱动逻辑描述",
  "risk": ["风险点1"],
  "buyPoint": "建议买入点位",
  "verdict": "BUY|COND_BUY|WATCH|NO_BUY",
  "reason": "结论理由",
  "priority": 1
}

禁止在 JSON 外套 markdown 代码块。`;
}
function formatMarketIndex(indices) {
  if (indices.length === 0) return "暂无大盘指数数据";
  return indices.map((idx) => {
    const direction = idx.changePercent >= 0 ? "📈" : "📉";
    return `${direction} ${idx.name}(${idx.code}): ${idx.price}点 ${idx.changePercent >= 0 ? "+" : ""}${idx.changePercent.toFixed(2)}% | 成交额 ${formatAmount(idx.amount)}`;
  }).join("\n");
}
function formatSectors(sectors) {
  if (sectors.length === 0) return "暂无板块数据";
  const top5 = sectors.slice(0, 5);
  const lines = top5.map((s, i) => {
    s.changePercent >= 0 ? "📈" : "📉";
    return `  ${i + 1}. ${s.name}(${s.code}) ${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}% | 领涨:${s.leadingStock}(${s.leadingChange >= 0 ? "+" : ""}${s.leadingChange.toFixed(2)}%) | 涨${s.upCount}/跌${s.downCount} | 资金流:${formatFundFlow(s.capitalFlow)}`;
  });
  return `【板块表现 Top ${top5.length}】
${lines.join("\n")}`;
}
function formatHotTopics(topics) {
  if (topics.length === 0) return "暂无题材数据";
  const top5 = topics.slice(0, 5);
  const lines = top5.map((t, i) => {
    t.changePercent >= 0 ? "📈" : "📉";
    return `  ${i + 1}. ${t.name}(${t.code}) ${t.changePercent >= 0 ? "+" : ""}${t.changePercent.toFixed(2)}% | 领涨:${t.leadingStock} | 涨${t.upCount}/跌${t.downCount}`;
  });
  return `【热门题材 Top ${top5.length}】
${lines.join("\n")}`;
}
function formatStockQuotes(quotes) {
  if (quotes.length === 0) return "暂无个股数据";
  return quotes.map((q) => {
    const dir = q.changePercent >= 0 ? "📈" : "📉";
    return `${dir} ${q.name}(${q.code}): ¥${q.price} ${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}% | 量:${(q.volume / 1e4).toFixed(1)}万手 | 额:${formatAmount(q.turnover)} | 换手:${q.turnoverRate.toFixed(1)}% | 振幅:${q.amplitude.toFixed(1)}% | 高低:${q.high}/${q.low}`;
  }).join("\n");
}
class PromptBuilder {
  /**
   * 组装完整分析 Prompt（四层全量分析）
   *
   * @param data - 当前市场数据
   * @returns messages 数组，可直接传给 DeepSeekClient.chat()
   */
  buildAnalysisPrompt(data) {
    var _a2;
    const contextParts = [];
    if (data.indices && data.indices.length > 0) {
      contextParts.push(formatMarketIndex(data.indices));
    }
    if (data.sectors && data.sectors.length > 0) {
      contextParts.push(formatSectors(data.sectors));
    }
    if (data.topics && data.topics.length > 0) {
      contextParts.push(formatHotTopics(data.topics));
    }
    if (data.quotes && data.quotes.length > 0) {
      contextParts.push(`【个股行情】
${formatStockQuotes(data.quotes)}`);
    }
    const dynamicContext = contextParts.join("\n\n");
    const stockListStr = data.stocksToAnalyze ? data.stocksToAnalyze.map((s) => `${s.name}(${s.code})`).join("、") : "";
    const selectedStocks = stockListStr ? `请分析以下股票：${stockListStr}` : void 0;
    const systemPrompt = buildFullSystemPrompt({
      dynamicContext: dynamicContext || void 0,
      selectedStocks
    });
    const userPrompt = this.buildUserAnalysisPrompt(
      data.stocksToAnalyze ?? [],
      ((_a2 = data.indices) == null ? void 0 : _a2.length) ? "已有市场数据" : "无市场数据"
    );
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
  }
  /**
   * 构建环境诊断 Prompt（仅 L1 层面）
   */
  buildEnvCheckPrompt(data) {
    const contextParts = [];
    if (data.indices && data.indices.length > 0) {
      contextParts.push(formatMarketIndex(data.indices));
    }
    if (data.sectors && data.sectors.length > 0) {
      contextParts.push(formatSectors(data.sectors));
    }
    if (data.topics && data.topics.length > 0) {
      contextParts.push(formatHotTopics(data.topics));
    }
    const dynamicContext = contextParts.join("\n\n");
    const systemPrompt = buildEnvOnlyPrompt({
      dynamicContext: dynamicContext || void 0
    });
    return [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: "请基于以上市场数据分析当前市场环境，输出环境评级、情绪描述和仓位建议。"
      }
    ];
  }
  /**
   * 构建单票快速分析 Prompt
   */
  buildSingleStockPrompt(data) {
    const contextParts = [];
    if (data.indices && data.indices.length > 0) {
      contextParts.push(formatMarketIndex(data.indices));
    }
    if (data.sectors && data.sectors.length > 0) {
      contextParts.push(formatSectors(data.sectors));
    }
    contextParts.push(
      `【目标个股】
${formatStockQuotes([data.quote])}`
    );
    const dynamicContext = contextParts.join("\n\n");
    const systemPrompt = buildSingleStockPrompt({
      dynamicContext
    });
    return [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `请详细分析 ${data.quote.name}(${data.quote.code})，输出完整的五维评估和交易结论。`
      }
    ];
  }
  /**
   * 内部：构建 User Prompt（分析指令部分）
   */
  buildUserAnalysisPrompt(stocksToAnalyze, marketDataStatus) {
    const stockLines = stocksToAnalyze.map(
      (s, i) => `  ${i + 1}. ${s.name}(${s.code})`
    );
    if (stocksToAnalyze.length === 0) {
      return "请分析当前市场环境，并给出交易建议。";
    }
    return [
      `请严格按照四层分析框架，分析以下股票池中的 ${stocksToAnalyze.length} 只股票：`,
      "",
      stockLines.join("\n"),
      "",
      `市场数据状态: ${marketDataStatus}`,
      "",
      "要求:",
      "- 先分析市场环境 (L1)",
      "- 再判断主线方向 (L2)",
      "- 再逐只个股五维评估 (L3)",
      "- 最后输出四类结论并排序 (L4)"
    ].join("\n");
  }
  // ─── 工具方法 ──────────────────────────────────────
  /**
   * 组合多段 context 文本
   */
  static joinContext(...parts) {
    return parts.filter(Boolean).join("\n\n");
  }
  /**
   * 从用户输入文本中提取股票代码
   * 支持格式: "600519"、"贵州茅台"、"600519贵州茅台"、"600519,000858"
   */
  static extractStocks(input) {
    const codePattern = /\b\d{6}\b/g;
    const codes = input.match(codePattern);
    if (codes) {
      return [...new Set(codes)];
    }
    return [];
  }
}
function formatAmount(yuan) {
  if (yuan >= 1e8) {
    return `${(yuan / 1e8).toFixed(1)}亿`;
  }
  if (yuan >= 1e4) {
    return `${(yuan / 1e4).toFixed(1)}万`;
  }
  return `${yuan.toFixed(0)}元`;
}
function formatFundFlow(wanYuan) {
  const abs = Math.abs(wanYuan);
  const prefix = wanYuan >= 0 ? "+" : "-";
  if (abs >= 1e4) {
    return `${prefix}${(abs / 1e4).toFixed(2)}亿`;
  }
  return `${prefix}${abs.toFixed(0)}万`;
}
const DEFAULT_CONFIG$2 = {
  BASE_URL: "https://api.deepseek.com/v1",
  MODEL: "deepseek-chat",
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
  TIMEOUT: 6e4,
  // 非流式 60s
  STREAM_TIMEOUT: 12e4,
  // 流式 120s
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY: 1e3,
  RETRY_MAX_DELAY: 1e4
};
class LLMError extends Error {
  constructor(message, code, statusCode, retryable = false) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.name = "LLMError";
  }
}
class APIError extends LLMError {
  constructor(message, statusCode, body) {
    super(message, "API_ERROR", statusCode, statusCode >= 500);
    this.body = body;
    this.name = "APIError";
  }
}
class TimeoutError extends LLMError {
  constructor(timeoutMs) {
    super(
      `请求超时 (${timeoutMs}ms)`,
      "TIMEOUT",
      void 0,
      true
      // 超时可重试
    );
    this.name = "TimeoutError";
  }
}
class StreamError extends LLMError {
  constructor(message, rawLine) {
    super(message, "STREAM_ERROR", void 0, false);
    this.rawLine = rawLine;
    this.name = "StreamError";
  }
}
class AuthError extends LLMError {
  constructor(message = "API Key 无效或未配置") {
    super(message, "AUTH_ERROR", 401, false);
    this.name = "AuthError";
  }
}
class RateLimitError extends LLMError {
  constructor(retryAfterMs = 6e4) {
    super(
      `API 速率限制，建议等待 ${retryAfterMs}ms`,
      "RATE_LIMIT",
      429,
      true
    );
    this.retryAfterMs = retryAfterMs;
    this.name = "RateLimitError";
  }
}
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) {
    return { type: "skip" };
  }
  if (trimmed.startsWith("data: ")) {
    const value = trimmed.slice(6);
    if (value === "[DONE]") {
      return { type: "done" };
    }
    return { type: "data", value };
  }
  if (trimmed.startsWith("data:")) {
    const value = trimmed.slice(5);
    if (value === "[DONE]") {
      return { type: "done" };
    }
    return { type: "data", value };
  }
  if (trimmed.startsWith("event: ")) {
    return { type: "event", value: trimmed.slice(7) };
  }
  return { type: "skip" };
}
function parseChunkJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.choices)) {
      return parsed;
    }
    logger$1.warn("[Stream] 收到非标准 chunk 结构:", raw.slice(0, 200));
    return null;
  } catch {
    logger$1.warn("[Stream] JSON 解析失败:", raw.slice(0, 200));
    return null;
  }
}
async function readStream(response, callbacks, signal) {
  var _a2, _b, _c, _d, _e, _f, _g, _h;
  const { onChunk, onDone, onError } = callbacks;
  let fullContent = "";
  let id = "";
  let model = "";
  let created = 0;
  let finishReason = "stop";
  if (signal == null ? void 0 : signal.aborted) {
    const err = new StreamError("流已被外部中止");
    onError == null ? void 0 : onError(err);
    throw err;
  }
  const reader = (_a2 = response.body) == null ? void 0 : _a2.getReader();
  if (!reader) {
    const err = new StreamError("响应体不可读（body 为 null）");
    onError == null ? void 0 : onError(err);
    throw err;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal == null ? void 0 : signal.aborted) {
        const err = new StreamError("流已被外部中止");
        onError == null ? void 0 : onError(err);
        throw err;
      }
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const result = parseLine(line);
        switch (result.type) {
          case "skip":
            break;
          case "done":
            finishReason = "stop";
            break;
          case "data": {
            const chunk = parseChunkJson(result.value);
            if (!chunk) break;
            if (!id && chunk.id) id = chunk.id;
            if (!model && chunk.model) model = chunk.model;
            if (!created && chunk.created) created = chunk.created;
            const choice = (_b = chunk.choices) == null ? void 0 : _b[0];
            if (choice) {
              const delta = ((_c = choice.delta) == null ? void 0 : _c.content) ?? "";
              if (delta) {
                fullContent += delta;
              }
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
            }
            onChunk == null ? void 0 : onChunk(chunk, fullContent);
            break;
          }
          case "event":
            logger$1.debug("[Stream] SSE event:", result.value);
            break;
          case "error":
            logger$1.warn("[Stream] 行解析警告:", result.message);
            break;
        }
      }
    }
    if (buffer.trim()) {
      const result = parseLine(buffer);
      if (result.type === "data") {
        const chunk = parseChunkJson(result.value);
        if (chunk) {
          const delta = ((_f = (_e = (_d = chunk.choices) == null ? void 0 : _d[0]) == null ? void 0 : _e.delta) == null ? void 0 : _f.content) ?? "";
          if (delta) fullContent += delta;
          if ((_h = (_g = chunk.choices) == null ? void 0 : _g[0]) == null ? void 0 : _h.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
          if (!id && chunk.id) id = chunk.id;
          if (!model && chunk.model) model = chunk.model;
          if (!created && chunk.created) created = chunk.created;
          onChunk == null ? void 0 : onChunk(chunk, fullContent);
        }
      } else if (result.type === "done") {
        finishReason = "stop";
      }
    }
    const streamResult = {
      fullContent,
      id,
      model,
      created,
      finishReason
    };
    onDone == null ? void 0 : onDone(streamResult);
    return streamResult;
  } catch (error) {
    if (error instanceof StreamError) {
      onError == null ? void 0 : onError(error);
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      const err2 = new StreamError("流读取被中止");
      onError == null ? void 0 : onError(err2);
      throw err2;
    }
    const err = new StreamError(
      error instanceof Error ? error.message : "流读取未知错误"
    );
    onError == null ? void 0 : onError(err);
    throw err;
  } finally {
    reader.releaseLock();
  }
}
class StorageKeyManager {
  constructor() {
    this.cachedKey = null;
  }
  /**
   * 获取 API Key
   * 优先级: 1) 构造函数传入 2) 硬编码 Key 3) 环境变量 fallback
   */
  async getKey() {
    var _a2;
    if (this.cachedKey) return this.cachedKey;
    try {
      const env = (_a2 = globalThis == null ? void 0 : globalThis.process) == null ? void 0 : _a2.env;
      const envKey = env == null ? void 0 : env.DEEPSEEK_API_KEY;
      if (envKey && envKey.trim()) {
        this.cachedKey = envKey.trim();
        return this.cachedKey;
      }
    } catch {
    }
    throw new AuthError("API Key 未配置。请在环境变量 DEEPSEEK_API_KEY 中设置，或更新 llm/client.ts 中的 HARDCODED_API_KEY。");
  }
  /** 设置 API Key */
  async setKey(key) {
    const trimmed = key.trim();
    if (!trimmed) {
      throw new AuthError("API Key 不能为空");
    }
    this.cachedKey = trimmed;
    logger$1.info("[KeyManager] API Key 已更新");
  }
  /** 清除 API Key */
  async clearKey() {
    this.cachedKey = null;
    logger$1.info("[KeyManager] API Key 已清除");
  }
  /** 检查是否已配置 Key */
  async hasKey() {
    try {
      const key = await this.getKey();
      return key.length > 0;
    } catch {
      return false;
    }
  }
}
class DeepSeekClient {
  constructor(config) {
    this.keyManager = new StorageKeyManager();
    this.config = {
      baseUrl: DEFAULT_CONFIG$2.BASE_URL,
      model: DEFAULT_CONFIG$2.MODEL,
      maxTokens: DEFAULT_CONFIG$2.MAX_TOKENS,
      temperature: DEFAULT_CONFIG$2.TEMPERATURE,
      timeout: DEFAULT_CONFIG$2.TIMEOUT,
      ...config
    };
  }
  // ─── 配置 ──────────────────────────────────────────
  /** 更新客户端配置 */
  setConfig(partial) {
    this.config = { ...this.config, ...partial };
  }
  /** 获取 KeyManager 引用 */
  getKeyManager() {
    return this.keyManager;
  }
  // ─── 内部工具 ──────────────────────────────────────
  /** 构建请求头 */
  async buildHeaders() {
    const apiKey = this.config.apiKey || await this.keyManager.getKey();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    };
  }
  /** 构建请求体 */
  buildRequest(messages, options) {
    return {
      model: this.config.model ?? DEFAULT_CONFIG$2.MODEL,
      messages,
      stream: (options == null ? void 0 : options.stream) ?? false,
      max_tokens: this.config.maxTokens ?? DEFAULT_CONFIG$2.MAX_TOKENS,
      temperature: this.config.temperature ?? DEFAULT_CONFIG$2.TEMPERATURE
    };
  }
  /** 构建完整 messages（插入 system prompt） */
  buildMessages(userMessages) {
    return [
      { role: "system", content: SYSTEM_PROMPT },
      ...userMessages.map((m) => ({ role: m.role, content: m.content }))
    ];
  }
  /** 处理 HTTP 响应错误 → 抛出类型化错误 */
  async handleResponseError(response) {
    const status = response.status;
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "(无法读取响应体)";
    }
    if (status === 401) {
      throw new AuthError(
        bodyText.includes("Incorrect API key") ? "API Key 错误，请检查设置" : "API 认证失败"
      );
    }
    if (status === 429) {
      const retryAfter = response.headers.get("retry-after-ms") ? parseInt(response.headers.get("retry-after-ms"), 10) : response.headers.get("Retry-After") ? parseInt(response.headers.get("Retry-After"), 10) * 1e3 : void 0;
      throw new RateLimitError(retryAfter);
    }
    if (status >= 400 && status < 500) {
      throw new APIError(
        `请求被拒绝 (${status}): ${bodyText.slice(0, 300)}`,
        status,
        bodyText
      );
    }
    if (status >= 500) {
      throw new APIError(
        `DeepSeek 服务端错误 (${status})`,
        status,
        bodyText
      );
    }
    throw new APIError(`HTTP ${status}: ${bodyText.slice(0, 200)}`, status, bodyText);
  }
  // ─── 非流式调用 ────────────────────────────────────
  async chat(messages, options) {
    const timeoutMs = (options == null ? void 0 : options.timeout) ?? this.config.timeout ?? DEFAULT_CONFIG$2.TIMEOUT;
    const allMessages = this.buildMessages(messages);
    const body = this.buildRequest(allMessages, { stream: false });
    logger$1.debug("[DeepSeek] 非流式请求:", {
      model: body.model,
      messages: body.messages.length,
      maxTokens: body.max_tokens
    });
    const execute = async () => {
      var _a2, _b, _c, _d;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const combinedSignal = (options == null ? void 0 : options.signal) ? combineSignals(options.signal, controller.signal) : controller.signal;
      try {
        const headers = await this.buildHeaders();
        const response = await fetch(
          `${this.config.baseUrl ?? DEFAULT_CONFIG$2.BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: combinedSignal
          }
        );
        if (!response.ok) {
          await this.handleResponseError(response);
        }
        const data = await response.json();
        logger$1.debug("[DeepSeek] 非流式响应:", {
          id: data.id,
          model: data.model,
          usage: data.usage,
          contentLength: ((_d = (_c = (_b = (_a2 = data.choices) == null ? void 0 : _a2[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) == null ? void 0 : _d.length) ?? 0
        });
        return data;
      } catch (error) {
        if (error instanceof LLMError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new TimeoutError(timeoutMs);
        }
        throw new APIError(
          error instanceof Error ? error.message : "未知请求错误",
          0
        );
      } finally {
        clearTimeout(timeoutId);
      }
    };
    return withRetry(execute, {
      maxRetries: (options == null ? void 0 : options.retries) ?? DEFAULT_CONFIG$2.MAX_RETRIES,
      baseDelay: (options == null ? void 0 : options.retryBaseDelay) ?? DEFAULT_CONFIG$2.RETRY_BASE_DELAY,
      maxDelay: (options == null ? void 0 : options.retryMaxDelay) ?? DEFAULT_CONFIG$2.RETRY_MAX_DELAY,
      onRetry: (error, attempt) => {
        logger$1.warn(
          `[DeepSeek] 请求重试 #${attempt + 1} 原因: ${error.message}`
        );
      }
    });
  }
  async ask(userMessage, options) {
    var _a2, _b, _c;
    const response = await this.chat(
      [{ role: "user", content: userMessage }],
      options
    );
    return ((_c = (_b = (_a2 = response.choices) == null ? void 0 : _a2[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) ?? "";
  }
  // ─── 流式调用 ────────────────────────────────────
  async chatStream(messages, callbacks, options) {
    const timeoutMs = (options == null ? void 0 : options.timeout) ?? this.config.timeout ?? DEFAULT_CONFIG$2.STREAM_TIMEOUT;
    const allMessages = this.buildMessages(messages);
    const body = this.buildRequest(allMessages, { stream: true });
    logger$1.debug("[DeepSeek] 流式请求:", {
      model: body.model,
      messages: body.messages.length
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = (options == null ? void 0 : options.signal) ? combineSignals(options.signal, controller.signal) : controller.signal;
    try {
      const headers = await this.buildHeaders();
      const response = await fetch(
        `${this.config.baseUrl ?? DEFAULT_CONFIG$2.BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: combinedSignal
        }
      );
      if (!response.ok) {
        clearTimeout(timeoutId);
        await this.handleResponseError(response);
      }
      return await readStream(
        response,
        {
          onChunk: (chunk, accumulated) => {
            var _a2;
            (_a2 = callbacks == null ? void 0 : callbacks.onChunk) == null ? void 0 : _a2.call(callbacks, chunk, accumulated);
          },
          onDone: (result) => {
            var _a2;
            logger$1.debug("[DeepSeek] 流完成:", {
              id: result.id,
              model: result.model,
              contentLength: result.fullContent.length,
              finishReason: result.finishReason
            });
            (_a2 = callbacks == null ? void 0 : callbacks.onDone) == null ? void 0 : _a2.call(callbacks, result);
          },
          onError: (error) => {
            var _a2;
            logger$1.error("[DeepSeek] 流错误:", error.message);
            (_a2 = callbacks == null ? void 0 : callbacks.onError) == null ? void 0 : _a2.call(callbacks, error);
          }
        },
        combinedSignal
      );
    } catch (error) {
      if (error instanceof LLMError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError(timeoutMs);
      }
      throw new APIError(
        error instanceof Error ? error.message : "流式请求未知错误",
        0
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
  async askStream(userMessage, callbacks, options) {
    return this.chatStream(
      [{ role: "user", content: userMessage }],
      callbacks,
      options
    );
  }
}
function combineSignals(...signals) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      "abort",
      () => controller.abort(signal.reason),
      { once: true }
    );
  }
  return controller.signal;
}
new DeepSeekClient();
const KEY_AREA = {
  api_key: "sync",
  settings: "sync",
  watchlist: "local",
  history: "local"
};
const DEFAULT_SETTINGS$1 = {
  model: "deepseek-chat",
  temperature: 0.7,
  maxTokens: 4096,
  autoAnalyze: false,
  maxConcurrent: 3,
  debugMode: false
};
const DEFAULTS = {
  api_key: "",
  settings: { ...DEFAULT_SETTINGS$1 },
  watchlist: [],
  history: []
};
const META_KEYS = {
  VERSION: "meta_version",
  INSTALLED_AT: "meta_installed_at",
  LAST_ANALYSIS_AT: "meta_last_analysis_at",
  MIGRATED: "meta_migrated"
};
class StorageError extends Error {
  constructor(message, code, key) {
    super(message);
    this.code = code;
    this.key = key;
    this.name = "StorageError";
  }
}
class QuotaExceededError extends StorageError {
  constructor(key, sizeBytes, limitBytes) {
    super(
      `存储配额超限: "${key}" 大小 ${sizeBytes}B 超过限制 ${limitBytes}B`,
      "QUOTA_EXCEEDED",
      key
    );
    this.name = "QuotaExceededError";
  }
}
class ValidationError extends StorageError {
  constructor(key, reason) {
    super(`值校验失败: "${key}" — ${reason}`, "VALIDATION", key);
    this.name = "ValidationError";
  }
}
class StorageManager {
  // ═══════════════════════════════════════════════
  // 构造 & 初始化
  // ═══════════════════════════════════════════════
  /**
   * 创建 StorageManager 实例
   * 不自动初始化 —— 首次调用任意方法时会自动初始化
   */
  constructor() {
    this.memoryCache = /* @__PURE__ */ new Map();
    this.memorySync = /* @__PURE__ */ new Map();
    this.memoryLocal = /* @__PURE__ */ new Map();
    this.initialized = false;
    this.initPromise = null;
    this.changeListeners = /* @__PURE__ */ new Map();
    this.onChangeBound = false;
  }
  /**
   * 初始化存储
   * - 确保默认值存在于 storage 中（首次安装时写入）
   * - 绑定 chrome.storage.onChanged 监听
   *
   * 幂等，可重复调用
   */
  async init(options) {
    if (this.initialized && !(options == null ? void 0 : options.force)) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }
  async doInit() {
    if (!this.onChangeBound) {
      this.bindOnChange();
    }
    await this.ensureDefaults();
    await this.warmCache();
    this.initialized = true;
    logger$1.info("[StorageManager] 初始化完成");
  }
  /** 确保初始化（所有公开方法先调用此方法） */
  async ensureInit() {
    if (!this.initialized) {
      await this.init();
    }
  }
  // ═══════════════════════════════════════════════
  // 核心读写
  // ═══════════════════════════════════════════════
  /**
   * 读取指定键的值
   *
   * 自动识别存储区域（sync / local），也支持显式指定
   * 优先返回内存缓存中的数据（最新一次 set/get 后缓存）
   *
   * @param key   - 存储键
   * @param area  - 可选，显式指定存储区域（默认根据键名自动判断）
   *
   * @example
   * ```ts
   * const apiKey = await storage.get('api_key');
   * const settings = await storage.get('settings');
   * const history = await storage.get('history');
   * ```
   */
  async get(key, area) {
    await this.ensureInit();
    const cached = this.memoryCache.get(key);
    if (cached !== void 0) {
      return cached;
    }
    const storageArea = area ?? this.resolveArea(key);
    try {
      const storage = this.getChromeStorage(storageArea);
      const result = await storage.get(key);
      const value = result[key];
      this.memoryCache.set(key, value);
      return value ?? this.getDefault(key);
    } catch (err) {
      throw this.wrapError(err, "读取失败", key);
    }
  }
  /**
   * 批量读取多个键
   *
   * @example
   * ```ts
   * const { api_key, settings } = await storage.getMany(['api_key', 'settings']);
   * ```
   */
  async getMany(keys) {
    await this.ensureInit();
    const result = {};
    const syncKeys = [];
    const localKeys = [];
    for (const key of keys) {
      const area = this.resolveArea(key);
      if (area === "sync") {
        syncKeys.push(key);
      } else {
        localKeys.push(key);
      }
    }
    const [syncResult, localResult] = await Promise.all([
      syncKeys.length > 0 ? this.getChromeStorage("sync").get(syncKeys) : Promise.resolve({}),
      localKeys.length > 0 ? this.getChromeStorage("local").get(localKeys) : Promise.resolve({})
    ]);
    const merged = { ...syncResult, ...localResult };
    for (const key of keys) {
      const value = merged[key] ?? this.getDefault(key);
      result[key] = value;
      this.memoryCache.set(key, value);
    }
    return result;
  }
  /**
   * 写入指定键的值
   *
   * 自动识别存储区域，写入后更新内存缓存
   * 对 sync 区域做大小校验（防止静默失败）
   *
   * @param key   - 存储键
   * @param value - 要写入的值
   * @param area  - 可选，显式指定存储区域
   *
   * @throws {QuotaExceededError} sync 区域超出配额
   * @throws {ValidationError}    值校验失败
   */
  async set(key, value, area) {
    await this.ensureInit();
    this.validateValue(key, value);
    const storageArea = area ?? this.resolveArea(key);
    if (storageArea === "sync") {
      this.checkSyncQuota(key, value);
    }
    try {
      const storage = this.getChromeStorage(storageArea);
      await storage.set({ [key]: value });
      this.memoryCache.set(key, value);
      logger$1.debug(`[StorageManager] 已写入: ${key} → ${storageArea}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("QUOTA_BYTES_PER_ITEM")) {
        throw new QuotaExceededError(key, this.estimateSize(value), 8192);
      }
      throw this.wrapError(err, "写入失败", key);
    }
  }
  /**
   * 批量写入多个键
   *
   * 按区域分组后并行写入
   *
   * @example
   * ```ts
   * await storage.setMany({
   *   api_key: 'sk-xxx',
   *   settings: { model: 'deepseek-chat', ... },
   * });
   * ```
   */
  async setMany(entries) {
    await this.ensureInit();
    const syncPayload = {};
    const localPayload = {};
    for (const [key, value] of Object.entries(entries)) {
      this.validateValue(key, value);
      const area = this.resolveArea(key);
      if (area === "sync") {
        this.checkSyncQuota(key, value);
        syncPayload[key] = value;
      } else {
        localPayload[key] = value;
      }
      this.memoryCache.set(key, value);
    }
    await Promise.all([
      Object.keys(syncPayload).length > 0 ? this.getChromeStorage("sync").set(syncPayload) : Promise.resolve(),
      Object.keys(localPayload).length > 0 ? this.getChromeStorage("local").set(localPayload) : Promise.resolve()
    ]);
    logger$1.debug(`[StorageManager] 批量写入完成: sync=${Object.keys(syncPayload).length}, local=${Object.keys(localPayload).length}`);
  }
  /**
   * 删除指定键
   *
   * @param key  - 要删除的键
   * @param area - 可选，显式指定存储区域
   */
  async remove(key, area) {
    await this.ensureInit();
    const storageArea = area ?? this.resolveArea(key);
    try {
      const storage = this.getChromeStorage(storageArea);
      await storage.remove(key);
      this.memoryCache.delete(key);
      logger$1.debug(`[StorageManager] 已删除: ${key}`);
    } catch (err) {
      throw this.wrapError(err, "删除失败", key);
    }
  }
  /**
   * 清空所有存储数据
   *
   * ⚠️ 危险操作 — 会删除所有已知键 + 缓存 + 元数据
   * 不会删除其他扩展存储的数据（Chrome 自动隔离）
   *
   * @returns 被删除的键列表
   */
  async clear() {
    await this.ensureInit();
    const syncKeys = Object.keys(KEY_AREA).filter(
      (k) => KEY_AREA[k] === "sync"
    );
    const localKeys = [
      ...Object.keys(KEY_AREA).filter((k) => KEY_AREA[k] === "local"),
      ...this.collectCacheKeys(),
      ...this.collectMetaKeys()
    ];
    await Promise.all([
      this.getChromeStorage("sync").remove(syncKeys),
      this.getChromeStorage("local").remove(localKeys)
    ]);
    this.memoryCache.clear();
    this.initialized = false;
    const allKeys = [...syncKeys, ...localKeys];
    logger$1.info(`[StorageManager] 存储已清空: ${allKeys.length} 个键`);
    return allKeys;
  }
  /**
   * 检查键是否存在
   */
  async has(key) {
    await this.ensureInit();
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key) !== void 0;
    }
    const area = this.resolveArea(key);
    const storage = this.getChromeStorage(area);
    const result = await storage.get(key);
    return result[key] !== void 0;
  }
  // ═══════════════════════════════════════════════
  // 默认值管理
  // ═══════════════════════════════════════════════
  /**
   * 获取指定键的默认值
   */
  getDefault(key) {
    if (key in DEFAULTS) {
      const def = DEFAULTS[key];
      return deepClone(def);
    }
    if (key.startsWith("cache_")) {
      return null;
    }
    if (key.startsWith("meta_")) {
      return void 0;
    }
    return void 0;
  }
  /**
   * 重置指定键为默认值
   */
  async resetToDefault(key) {
    const defaultValue = this.getDefault(key);
    await this.set(key, defaultValue);
    logger$1.info(`[StorageManager] 已重置为默认值: ${key}`);
  }
  /**
   * 重置所有键为默认值
   */
  async resetAll() {
    const entries = {};
    for (const key of Object.keys(DEFAULTS)) {
      entries[key] = this.getDefault(key);
    }
    await this.setMany(entries);
    logger$1.info("[StorageManager] 所有键已重置为默认值");
  }
  /**
   * 获取所有已知键的当前值（含默认值回退）
   */
  async getAll() {
    const keys = Object.keys(KEY_AREA);
    const result = await this.getMany(keys);
    return result;
  }
  /**
   * 获取当前存储使用统计
   */
  async getStorageInfo() {
    const [syncBytes, localBytes] = await Promise.all([
      this.getChromeStorage("sync").getBytesInUse(null),
      this.getChromeStorage("local").getBytesInUse(null)
    ]);
    return {
      sync: {
        keys: Object.keys(KEY_AREA).filter((k) => KEY_AREA[k] === "sync").length,
        bytes: syncBytes
      },
      local: {
        keys: Object.keys(KEY_AREA).filter((k) => KEY_AREA[k] === "local").length,
        bytes: localBytes
      }
    };
  }
  // ═══════════════════════════════════════════════
  // 缓存管理
  // ═══════════════════════════════════════════════
  /**
   * 设置缓存条目
   *
   * @param name  - 缓存名（自动加 `cache_` 前缀）
   * @param data  - 要缓存的数据
   * @param ttl   - 过期时间 (ms)，默认 30 秒
   *
   * @example
   * ```ts
   * await storage.setCache('sectors', sectorData, 60_000);
   * ```
   */
  async setCache(name, data, ttl = 3e4) {
    const entry = {
      data,
      timestamp: Date.now(),
      ttl
    };
    const key = `cache_${name}`;
    await this.set(key, entry, "local");
  }
  /**
   * 读取缓存条目
   *
   * 如果缓存不存在或已过期，返回 null
   *
   * @param name - 缓存名
   *
   * @example
   * ```ts
   * const sectors = await storage.getCache<SectorData[]>('sectors');
   * if (sectors) { /* 使用缓存 * / }
   * ```
   */
  async getCache(name) {
    const key = `cache_${name}`;
    const entry = await this.get(key, "local");
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      await this.remove(key, "local").catch(() => {
      });
      return null;
    }
    return entry.data;
  }
  /**
   * 删除指定缓存
   */
  async removeCache(name) {
    const key = `cache_${name}`;
    await this.remove(key, "local");
  }
  /**
   * 清除所有过期缓存
   *
   * @returns 被清除的缓存数量
   */
  async clearExpiredCache() {
    const cacheKeys = this.collectCacheKeys();
    let cleared = 0;
    for (const key of cacheKeys) {
      try {
        const cacheKey = key;
        const entry = await this.get(cacheKey, "local");
        if (entry && Date.now() - entry.timestamp > entry.ttl) {
          await this.remove(cacheKey, "local");
          cleared++;
        }
      } catch {
      }
    }
    if (cleared > 0) {
      logger$1.info(`[StorageManager] 已清除 ${cleared} 条过期缓存`);
    }
    return cleared;
  }
  /**
   * 清除所有缓存（无论是否过期）
   *
   * @returns 被清除的缓存数量
   */
  async clearAllCache() {
    const cacheKeys = this.collectCacheKeys();
    if (cacheKeys.length > 0) {
      await this.getChromeStorage("local").remove(cacheKeys);
      for (const key of cacheKeys) {
        this.memoryCache.delete(key);
      }
    }
    logger$1.info(`[StorageManager] 已清除全部缓存: ${cacheKeys.length} 条`);
    return cacheKeys.length;
  }
  /**
   * 获取缓存统计信息
   */
  async getCacheStats() {
    const cacheKeys = this.collectCacheKeys();
    let expired = 0;
    let valid = 0;
    for (const key of cacheKeys) {
      try {
        const cacheKey = key;
        const entry = await this.get(cacheKey, "local");
        if (entry) {
          if (Date.now() - entry.timestamp > entry.ttl) {
            expired++;
          } else {
            valid++;
          }
        }
      } catch {
      }
    }
    return { total: cacheKeys.length, expired, valid };
  }
  // ═══════════════════════════════════════════════
  // 历史记录管理
  // ═══════════════════════════════════════════════
  /**
   * 添加一条分析记录到历史
   *
   * @param result - 分析结果
   * @param options - 可选：备注、标签
   * @returns 生成的记录 ID
   */
  async addHistory(result, options) {
    const record = {
      id: generateId(),
      createdAt: Date.now(),
      note: options == null ? void 0 : options.note,
      tags: options == null ? void 0 : options.tags,
      result
    };
    const history = await this.get("history");
    history.push(record);
    const MAX_HISTORY = 500;
    const trimmed = history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history;
    await this.set("history", trimmed);
    await this.setMeta("last_analysis_at", Date.now());
    logger$1.debug(`[StorageManager] 已添加分析记录: ${record.id}`);
    return record.id;
  }
  /**
   * 查询历史记录
   *
   * @param options - 查询条件
   * @returns 符合条件的记录列表
   *
   * @example
   * ```ts
   * // 最近 10 条
   * const recent = await storage.getHistory({ limit: 10 });
   *
   * // 分页
   * const page = await storage.getHistory({ offset: 20, limit: 10 });
   *
   * // 按日期范围
   * const today = await storage.getHistory({
   *   from: Date.now() - 86400000,
   *   to: Date.now(),
   * });
   * ```
   */
  async getHistory(options) {
    const history = await this.get("history");
    let filtered = history;
    if ((options == null ? void 0 : options.from) !== void 0) {
      filtered = filtered.filter((r) => r.createdAt >= options.from);
    }
    if ((options == null ? void 0 : options.to) !== void 0) {
      filtered = filtered.filter((r) => r.createdAt <= options.to);
    }
    if (options == null ? void 0 : options.verdict) {
      filtered = filtered.filter(
        (r) => r.result.conclusions.some((c) => c.verdict === options.verdict)
      );
    }
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    const offset = (options == null ? void 0 : options.offset) ?? 0;
    const limit = (options == null ? void 0 : options.limit) ?? filtered.length;
    return filtered.slice(offset, offset + limit);
  }
  /**
   * 删除单条历史记录
   *
   * @param recordId - 记录 ID
   * @returns 是否找到并删除
   */
  async removeHistory(recordId) {
    const history = await this.get("history");
    const idx = history.findIndex((r) => r.id === recordId);
    if (idx === -1) return false;
    history.splice(idx, 1);
    await this.set("history", history);
    logger$1.debug(`[StorageManager] 已删除分析记录: ${recordId}`);
    return true;
  }
  /**
   * 清空所有历史记录
   */
  async clearHistory() {
    await this.set("history", []);
    logger$1.info("[StorageManager] 分析历史已清空");
  }
  /**
   * 获取历史记录统计
   */
  async getHistoryStats() {
    const history = await this.get("history");
    const byVerdict = {};
    const oneWeekAgo = Date.now() - 7 * 864e5;
    const oneMonthAgo = Date.now() - 30 * 864e5;
    let lastWeek = 0;
    let lastMonth = 0;
    for (const record of history) {
      for (const c of record.result.conclusions) {
        byVerdict[c.verdict] = (byVerdict[c.verdict] ?? 0) + 1;
      }
      if (record.createdAt >= oneWeekAgo) lastWeek++;
      if (record.createdAt >= oneMonthAgo) lastMonth++;
    }
    return {
      total: history.length,
      byVerdict,
      lastWeek,
      lastMonth
    };
  }
  // ═══════════════════════════════════════════════
  // 元数据管理
  // ═══════════════════════════════════════════════
  /**
   * 设置元数据
   */
  async setMeta(name, value) {
    const key = `meta_${name}`;
    await this.set(key, value, "local");
  }
  /**
   * 读取元数据
   */
  async getMeta(name) {
    const key = `meta_${name}`;
    return this.get(key, "local");
  }
  /**
   * 删除元数据
   */
  async removeMeta(name) {
    const key = `meta_${name}`;
    await this.remove(key, "local");
  }
  // ═══════════════════════════════════════════════
  // 变更监听
  // ═══════════════════════════════════════════════
  /**
   * 监听指定键的变更
   *
   * @param key      - 要监听的键
   * @param callback - 变更回调 (newValue, oldValue)
   * @returns 取消监听的函数
   *
   * @example
   * ```ts
   * const unsub = storage.onChange('settings', (val, old) => {
   *   console.log('设置已更新', val);
   * });
   * // 不再需要时取消监听
   * unsub();
   * ```
   */
  onChange(key, callback) {
    if (!this.changeListeners.has(key)) {
      this.changeListeners.set(key, /* @__PURE__ */ new Set());
    }
    const listeners = this.changeListeners.get(key);
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.changeListeners.delete(key);
      }
    };
  }
  /**
   * 监听多个键的变更
   *
   * @param keys     - 要监听的键列表
   * @param callback - 变更回调 (changes)
   * @returns 取消监听的函数
   */
  onChangeMany(keys, callback) {
    const unsubs = keys.map(
      (key) => this.onChange(key, (newValue, oldValue) => {
        callback({ [key]: { newValue, oldValue } });
      })
    );
    return () => unsubs.forEach((unsub) => unsub());
  }
  // ═══════════════════════════════════════════════
  // 数据迁移
  // ═══════════════════════════════════════════════
  /**
   * 从旧版存储迁移数据到新版 StorageManager 架构
   *
   * 旧版使用 `xvqiu_` 前缀键，新版使用规范化键名
   *
   * 迁移映射:
   *   xvqiu_settings   → settings
   *   deepseek_api_key → api_key
   *   xvqiu_installed_at → meta_installed_at
   *   xvqiu_version    → meta_version
   *
   * 幂等 —— 检查 meta_migrated 标记，已迁移则跳过
   */
  async migrateFromLegacy() {
    const migrated = await this.getMeta("migrated");
    if (migrated) {
      logger$1.info("[StorageManager] 数据迁移已执行过，跳过");
      return { migrated: 0, skipped: 0 };
    }
    let count = 0;
    let skipped = 0;
    try {
      const legacyData = await this.getChromeStorage("local").get([
        "xvqiu_settings",
        "deepseek_api_key",
        "xvqiu_installed_at",
        "xvqiu_version"
      ]);
      if (legacyData.xvqiu_settings) {
        const oldSettings = legacyData.xvqiu_settings;
        const newSettings = {
          model: oldSettings.model ?? DEFAULT_SETTINGS$1.model,
          temperature: oldSettings.temperature ?? DEFAULT_SETTINGS$1.temperature,
          maxTokens: oldSettings.maxTokens ?? DEFAULT_SETTINGS$1.maxTokens,
          autoAnalyze: oldSettings.autoAnalyze ?? DEFAULT_SETTINGS$1.autoAnalyze,
          maxConcurrent: oldSettings.maxConcurrent ?? DEFAULT_SETTINGS$1.maxConcurrent,
          debugMode: oldSettings.debugMode ?? DEFAULT_SETTINGS$1.debugMode
        };
        await this.set("settings", newSettings);
        count++;
      } else {
        skipped++;
      }
      if (legacyData.deepseek_api_key) {
        const key = legacyData.deepseek_api_key;
        if (key.trim()) {
          await this.set("api_key", key.trim());
          count++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
      if (legacyData.xvqiu_installed_at) {
        await this.setMeta("installed_at", legacyData.xvqiu_installed_at);
        count++;
      } else {
        skipped++;
      }
      if (legacyData.xvqiu_version) {
        await this.setMeta("version", legacyData.xvqiu_version);
        count++;
      } else {
        skipped++;
      }
      await this.getChromeStorage("local").remove([
        "xvqiu_settings",
        "deepseek_api_key",
        "xvqiu_installed_at",
        "xvqiu_version"
      ]);
      await this.setMeta("migrated", true);
      logger$1.info(`[StorageManager] 数据迁移完成: 迁移 ${count} 项，跳过 ${skipped} 项`);
    } catch (err) {
      logger$1.error("[StorageManager] 数据迁移失败:", err);
      throw err;
    }
    return { migrated: count, skipped };
  }
  // ═══════════════════════════════════════════════
  // 内部工具
  // ═══════════════════════════════════════════════
  /**
   * 获取存储对象
   * Chrome 环境 → chrome.storage
   * Electron/其他环境 → 内存回退
   */
  getChromeStorage(area) {
    if (typeof chrome !== "undefined" && chrome.storage) {
      return area === "sync" ? chrome.storage.sync : chrome.storage.local;
    }
    return this.getMemoryFallback(area);
  }
  /**
   * 创建内存回退 StorageArea（用于 Electron 环境）
   */
  getMemoryFallback(_area) {
    const store = _area === "sync" ? this.memorySync : this.memoryLocal;
    return {
      get: async (keys) => {
        if (keys === null) {
          const result2 = {};
          store.forEach((v, k) => {
            result2[k] = v;
          });
          return result2;
        }
        if (typeof keys === "string") {
          return { [keys]: store.get(keys) };
        }
        if (Array.isArray(keys)) {
          const result2 = {};
          for (const key of keys) result2[key] = store.get(key);
          return result2;
        }
        const result = {};
        for (const [key, defaultValue] of Object.entries(keys)) {
          result[key] = store.has(key) ? store.get(key) : defaultValue;
        }
        return result;
      },
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) {
          store.set(key, value);
        }
      },
      remove: async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) store.delete(key);
      },
      clear: async () => store.clear(),
      getBytesInUse: async () => 0,
      onChanged: {
        addListener: () => {
        },
        removeListener: () => {
        },
        hasListener: () => false
      }
    };
  }
  /**
   * 解析键名对应的存储区域
   */
  resolveArea(key) {
    if (key in KEY_AREA) {
      return KEY_AREA[key];
    }
    if (key.startsWith("cache_") || key.startsWith("meta_")) {
      return "local";
    }
    return "local";
  }
  /**
   * 写入默认值（首次安装时）
   */
  async ensureDefaults() {
    const keys = Object.keys(KEY_AREA);
    const syncKeys = keys.filter((k) => KEY_AREA[k] === "sync");
    const localKeys = keys.filter((k) => KEY_AREA[k] === "local");
    const [syncResult, localResult] = await Promise.all([
      syncKeys.length > 0 ? this.getChromeStorage("sync").get(syncKeys) : Promise.resolve({}),
      localKeys.length > 0 ? this.getChromeStorage("local").get(localKeys) : Promise.resolve({})
    ]);
    const allExisting = { ...syncResult, ...localResult };
    const toSet = {};
    for (const key of keys) {
      const knownKey = key;
      if (allExisting[key] === void 0) {
        toSet[key] = this.getDefault(knownKey);
      }
    }
    if (Object.keys(toSet).length === 0) {
      logger$1.debug("[StorageManager] 所有默认值已存在");
      return;
    }
    const syncToSet = {};
    const localToSet = {};
    for (const [key, value] of Object.entries(toSet)) {
      const area = this.resolveArea(key);
      if (area === "sync") {
        syncToSet[key] = value;
      } else {
        localToSet[key] = value;
      }
    }
    await Promise.all([
      Object.keys(syncToSet).length > 0 ? this.getChromeStorage("sync").set(syncToSet) : Promise.resolve(),
      Object.keys(localToSet).length > 0 ? this.getChromeStorage("local").set(localToSet) : Promise.resolve()
    ]);
    await Promise.all([
      this.getChromeStorage("local").set({
        [META_KEYS.VERSION]: "1.0.0",
        [META_KEYS.INSTALLED_AT]: Date.now()
      })
    ]);
    logger$1.info(`[StorageManager] 默认值已写入: ${Object.keys(toSet).length} 项`);
  }
  /**
   * 预热内存缓存 — 从 Chrome Storage 读取所有已知键
   */
  async warmCache() {
    const knownKeys = Object.keys(KEY_AREA);
    const syncKeys = knownKeys.filter((k) => KEY_AREA[k] === "sync");
    const localKeys = knownKeys.filter((k) => KEY_AREA[k] === "local");
    const [syncResult, localResult] = await Promise.all([
      syncKeys.length > 0 ? this.getChromeStorage("sync").get(syncKeys) : Promise.resolve({}),
      localKeys.length > 0 ? this.getChromeStorage("local").get(localKeys) : Promise.resolve({})
    ]);
    const all = { ...syncResult, ...localResult };
    for (const key of knownKeys) {
      this.memoryCache.set(key, all[key] ?? this.getDefault(key));
    }
    logger$1.debug(`[StorageManager] 内存缓存已预热: ${knownKeys.length} 个键`);
  }
  /**
   * 收集所有缓存键
   */
  collectCacheKeys() {
    const keys = [];
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith("cache_")) {
        keys.push(key);
      }
    }
    return keys;
  }
  /**
   * 收集所有元数据键
   */
  collectMetaKeys() {
    const keys = [];
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith("meta_")) {
        keys.push(key);
      }
    }
    for (const value of Object.values(META_KEYS)) {
      if (!keys.includes(value)) {
        keys.push(value);
      }
    }
    return keys;
  }
  /**
   * 绑定 chrome.storage.onChanged 监听
   */
  bindOnChange() {
    var _a2;
    if (typeof chrome === "undefined" || !((_a2 = chrome.storage) == null ? void 0 : _a2.onChanged)) {
      logger$1.warn("[StorageManager] chrome.storage.onChanged 不可用");
      return;
    }
    chrome.storage.onChanged.addListener(
      (changes, areaName) => {
        for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
          if (!this.isManagedKey(key)) continue;
          this.memoryCache.set(key, newValue);
          const listeners = this.changeListeners.get(key);
          if (listeners && listeners.size > 0) {
            for (const callback of listeners) {
              try {
                callback(newValue, oldValue);
              } catch (err) {
                logger$1.error(`[StorageManager] 变更监听回调出错 (${key}):`, err);
              }
            }
          }
        }
      }
    );
    this.onChangeBound = true;
    logger$1.debug("[StorageManager] onChanged 监听已绑定");
  }
  /**
   * 判断键是否由 StorageManager 管理
   */
  isManagedKey(key) {
    return key in KEY_AREA || key.startsWith("cache_") || key.startsWith("meta_");
  }
  /**
   * 校验值的合法性
   *
   * @throws {ValidationError} 校验不通过
   */
  validateValue(key, value) {
    if (value === null || value === void 0) {
      return;
    }
    switch (key) {
      case "api_key": {
        if (typeof value !== "string") {
          throw new ValidationError(key, "API Key 必须是字符串");
        }
        if (value.length > 2048) {
          throw new ValidationError(key, "API Key 长度超过 2048 字符");
        }
        break;
      }
      case "settings": {
        if (typeof value !== "object" || value === null) {
          throw new ValidationError(key, "设置必须是对象");
        }
        const s = value;
        if (typeof s.model !== "string") {
          throw new ValidationError(key, "model 必须是字符串");
        }
        if (typeof s.temperature !== "number" || s.temperature < 0 || s.temperature > 2) {
          throw new ValidationError(key, "temperature 必须在 0-2 范围内");
        }
        if (typeof s.maxTokens !== "number" || s.maxTokens < 1 || s.maxTokens > 128e3) {
          throw new ValidationError(key, "maxTokens 必须在 1-128000 范围内");
        }
        break;
      }
      case "watchlist": {
        if (!Array.isArray(value)) {
          throw new ValidationError(key, "自选股必须是数组");
        }
        if (value.length > 200) {
          throw new ValidationError(key, "自选股数量超过 200 上限");
        }
        for (const item of value) {
          if (typeof item !== "string") {
            throw new ValidationError(key, "自选股元素必须是字符串");
          }
        }
        break;
      }
      case "history": {
        if (!Array.isArray(value)) {
          throw new ValidationError(key, "历史记录必须是数组");
        }
        break;
      }
      default: {
        if (key.startsWith("cache_")) {
          if (typeof value !== "object" || value === null) {
            throw new ValidationError(key, "缓存值必须是对象（CacheEntry）");
          }
        }
        break;
      }
    }
  }
  /**
   * 检查 sync 区域配额
   *
   * chrome.storage.sync 限制:
   *   - QUOTA_BYTES_PER_ITEM = 8,192 (每项 8KB)
   *   - QUOTA_BYTES = 102,400 (总计 100KB)
   *
   * @throws {QuotaExceededError} 超出配额
   */
  checkSyncQuota(key, value) {
    const size = this.estimateSize(value);
    if (size > 8192) {
      throw new QuotaExceededError(key, size, 8192);
    }
  }
  /**
   * 估算值的 JSON 序列化大小（字节）
   */
  estimateSize(value) {
    try {
      const json = JSON.stringify(value);
      return new TextEncoder().encode(json).length;
    } catch {
      return 0;
    }
  }
  /**
   * 将错误包装为 StorageError
   */
  wrapError(err, fallbackMsg, key) {
    if (err instanceof StorageError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new StorageError(
      `${fallbackMsg}: ${message}`,
      "UNKNOWN",
      key
    );
  }
}
function generateId() {
  const chars = "0123456789abcdef";
  const sections = [8, 4, 4, 4, 12];
  return sections.map((len) => {
    let s = "";
    for (let i = 0; i < len; i++) {
      s += chars[Math.floor(Math.random() * 16)];
    }
    return s;
  }).join("-");
}
function deepClone(value) {
  if (value === null || value === void 0) return value;
  return JSON.parse(JSON.stringify(value));
}
const storageManager = new StorageManager();
const CACHE_KEYS = {
  /** 个股行情 */
  QUOTE: "quote",
  /** 大盘指数 */
  MARKET_INDEX: "market_index",
  /** 板块列表 */
  SECTORS: "sectors",
  /** 板块明细 */
  SECTOR_DETAIL: "sector_detail",
  /** 热门题材 */
  HOT_TOPICS: "hot_topics",
  /** 分析结果 */
  ANALYSIS: "analysis"
};
const CACHE_TTL = {
  [CACHE_KEYS.QUOTE]: { t1: 1e4, t2: 3e4 },
  [CACHE_KEYS.MARKET_INDEX]: { t1: 15e3, t2: 45e3 },
  [CACHE_KEYS.SECTORS]: { t1: 15e3, t2: 6e4 },
  [CACHE_KEYS.SECTOR_DETAIL]: { t1: 15e3, t2: 6e4 },
  [CACHE_KEYS.HOT_TOPICS]: { t1: 15e3, t2: 6e4 },
  [CACHE_KEYS.ANALYSIS]: { t1: 6e4, t2: 3e5 }
};
const DEFAULT_CONFIG$1 = {
  t1DefaultTTL: 1e4,
  t2DefaultTTL: 3e4,
  t1MaxSize: 500,
  enabled: true
};
const CLEANUP_INTERVAL = 6e4;
class CacheManager {
  constructor(config, storage) {
    this.tier1 = /* @__PURE__ */ new Map();
    this.stats = {
      tier1Size: 0,
      tier1Hits: 0,
      tier1Misses: 0,
      tier2Hits: 0,
      tier2Misses: 0,
      sets: 0,
      evictions: 0
    };
    this.cleanupTimer = null;
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG$1, ...config };
    this.storage = storage ?? storageManager;
  }
  // ─── 初始化 / 销毁 ──────────────────────────────────
  /** 启动定期清理 */
  async init() {
    if (this.initialized) return;
    if (typeof setInterval !== "undefined") {
      this.cleanupTimer = setInterval(() => {
        this.evictExpired();
      }, CLEANUP_INTERVAL);
    }
    this.initialized = true;
    logger$1.debug("[CacheManager] 已初始化");
  }
  /** 释放资源 */
  destroy() {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.tier1.clear();
    this.initialized = false;
    logger$1.debug("[CacheManager] 已销毁");
  }
  // ─── 核心读写 ──────────────────────────────────────
  /**
   * 读取缓存
   *
   * 策略:
   *   1. 查 Tier-1 (内存) → 命中则返回
   *   2. 未命中 → 查 Tier-2 (Storage) → 命中则回填 Tier-1 并返回
   *   3. 均未命中 → 返回 null
   *
   * @param cacheKey 缓存键（自动加类型前缀）
   * @returns 缓存数据，未命中返回 null
   */
  async get(cacheKey) {
    if (!this.config.enabled) return null;
    const t1Entry = this.tier1.get(cacheKey);
    if (t1Entry) {
      if (Date.now() < t1Entry.expiresAt) {
        this.stats.tier1Hits++;
        return t1Entry.data;
      }
      this.tier1.delete(cacheKey);
      this.stats.evictions++;
    } else {
      this.stats.tier1Misses++;
    }
    try {
      const t2Data = await this.storage.getCache(cacheKey);
      if (t2Data !== null) {
        this.stats.tier2Hits++;
        const ttl = this.getT2TTL(cacheKey);
        this.setT1(cacheKey, t2Data, ttl);
        return t2Data;
      }
    } catch {
      logger$1.warn(`[CacheManager] Tier-2 读取失败: ${cacheKey}`);
    }
    this.stats.tier2Misses++;
    return null;
  }
  /**
   * 写入缓存 (Tier-1 + Tier-2)
   *
   * @param cacheKey 缓存键
   * @param data     数据
   * @param customTTL 可选 — 自定义 TTL { t1?, t2? }
   */
  async set(cacheKey, data, customTTL) {
    if (!this.config.enabled) return;
    this.stats.sets++;
    const t1TTL = (customTTL == null ? void 0 : customTTL.t1) ?? this.getT1TTL(cacheKey);
    this.setT1(cacheKey, data, t1TTL);
    try {
      const t2TTL = (customTTL == null ? void 0 : customTTL.t2) ?? this.getT2TTL(cacheKey);
      await this.storage.setCache(cacheKey, data, t2TTL);
    } catch (err) {
      logger$1.warn(`[CacheManager] Tier-2 写入失败: ${cacheKey}`, err);
    }
  }
  /**
   * 删除缓存 (Tier-1 + Tier-2)
   */
  async delete(cacheKey) {
    this.tier1.delete(cacheKey);
    try {
      await this.storage.removeCache(cacheKey);
    } catch {
    }
  }
  /**
   * 判断缓存是否存在且有效
   */
  async has(cacheKey) {
    const t1Entry = this.tier1.get(cacheKey);
    if (t1Entry && Date.now() < t1Entry.expiresAt) {
      return true;
    }
    try {
      const t2Data = await this.storage.getCache(cacheKey);
      return t2Data !== null;
    } catch {
      return false;
    }
  }
  // ─── 批量操作 ──────────────────────────────────────
  /**
   * 批量读取缓存
   * 返回 Map<cacheKey, T | null>
   */
  async getMany(cacheKeys) {
    const result = /* @__PURE__ */ new Map();
    const remaining = [];
    for (const key of cacheKeys) {
      const t1Entry = this.tier1.get(key);
      if (t1Entry && Date.now() < t1Entry.expiresAt) {
        result.set(key, t1Entry.data);
        this.stats.tier1Hits++;
      } else {
        remaining.push(key);
        this.stats.tier1Misses++;
      }
    }
    if (remaining.length === 0) return result;
    for (const key of remaining) {
      try {
        const t2Data = await this.storage.getCache(key);
        if (t2Data !== null) {
          result.set(key, t2Data);
          this.stats.tier2Hits++;
          const ttl = this.getT2TTL(key);
          this.setT1(key, t2Data, ttl);
        } else {
          result.set(key, null);
          this.stats.tier2Misses++;
        }
      } catch {
        result.set(key, null);
        this.stats.tier2Misses++;
      }
    }
    return result;
  }
  /**
   * 清除所有缓存 (Tier-1 + Tier-2)
   */
  async clear() {
    this.tier1.clear();
    this.stats.evictions += this.tier1.size;
    await this.storage.clearAllCache().catch(() => {
    });
    logger$1.info("[CacheManager] 缓存已全部清除");
  }
  /**
   * 清除指定类型的缓存
   *
   * @param type 缓存类型前缀，如 'quote' | 'sectors'
   */
  async clearByType(type) {
    const prefix = `cache_${type}`;
    for (const key of this.tier1.keys()) {
      if (key.startsWith(prefix)) {
        this.tier1.delete(key);
      }
    }
    logger$1.debug(`[CacheManager] 清除类型缓存: ${type}`);
  }
  // ─── 统计 & 管理 ──────────────────────────────────
  /** 获取缓存统计 */
  getStats() {
    return {
      ...this.stats,
      tier1Size: this.tier1.size
    };
  }
  /** 重置统计 */
  resetStats() {
    this.stats = {
      tier1Size: this.tier1.size,
      tier1Hits: 0,
      tier1Misses: 0,
      tier2Hits: 0,
      tier2Misses: 0,
      sets: 0,
      evictions: 0
    };
  }
  /** 获取 Tier-1 缓存键列表 */
  getT1Keys() {
    return Array.from(this.tier1.keys());
  }
  /** 配置运行中更新 */
  setConfig(partial) {
    this.config = { ...this.config, ...partial };
  }
  /** 获取当前配置 */
  getConfig() {
    return { ...this.config };
  }
  // ─── 内部方法 ──────────────────────────────────────
  /** 写入 Tier-1 (内存) */
  setT1(key, data, ttlMs) {
    if (this.tier1.size >= this.config.t1MaxSize) {
      const oldestKey = this.tier1.keys().next().value;
      if (oldestKey !== void 0) {
        this.tier1.delete(oldestKey);
        this.stats.evictions++;
      }
    }
    this.tier1.set(key, {
      data,
      expiresAt: Date.now() + ttlMs
    });
  }
  /** 惰性淘汰过期条目 */
  evictExpired() {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.tier1.entries()) {
      if (now >= entry.expiresAt) {
        this.tier1.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.stats.evictions += evicted;
      logger$1.debug(`[CacheManager] 淘汰 ${evicted} 条过期缓存`);
    }
  }
  /** 根据缓存键推测 Tier-1 TTL */
  getT1TTL(cacheKey) {
    for (const [type, ttl] of Object.entries(CACHE_TTL)) {
      if (cacheKey.startsWith(`cache_${type}`) || cacheKey.startsWith(type)) {
        return ttl.t1;
      }
    }
    return this.config.t1DefaultTTL;
  }
  /** 根据缓存键推测 Tier-2 TTL */
  getT2TTL(cacheKey) {
    for (const [type, ttl] of Object.entries(CACHE_TTL)) {
      if (cacheKey.startsWith(`cache_${type}`) || cacheKey.startsWith(type)) {
        return ttl.t2;
      }
    }
    return this.config.t2DefaultTTL;
  }
  /**
   * 生成标准缓存键
   *
   * @example
   * ```ts
   * cache.key('quote', '600519')   → 'quote:600519'
   * cache.key('sectors')            → 'sectors'
   * cache.key('analysis', 'pool')   → 'analysis:pool'
   * ```
   */
  static makeKey(type, ...parts) {
    if (parts.length === 0) return type;
    return `${type}:${parts.join(":")}`;
  }
}
const cacheManager = new CacheManager();
const DEFAULT_CONFIG = {
  maxConcurrent: 10,
  enableLocalPreAnalysis: true,
  useCache: true,
  model: "deepseek-chat",
  temperature: 0.7,
  maxTokens: 4096
};
class AnalysisEngine {
  constructor(config, deps) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.marketAnalyzer = (deps == null ? void 0 : deps.marketAnalyzer) ?? new L1MarketAnalyzer();
    this.directionAnalyzer = (deps == null ? void 0 : deps.directionAnalyzer) ?? new L2DirectionAnalyzer();
    this.stockAnalyzer = (deps == null ? void 0 : deps.stockAnalyzer) ?? new L3StockAnalyzer();
    this.conclusionEngine = (deps == null ? void 0 : deps.conclusionEngine) ?? new L4ConclusionEngine();
    this.promptBuilder = (deps == null ? void 0 : deps.promptBuilder) ?? new PromptBuilder();
    this.dataSource = (deps == null ? void 0 : deps.dataSource) ?? new EastMoneyAdapter();
    this.llmClient = (deps == null ? void 0 : deps.llmClient) ?? new DeepSeekClient();
    this.cache = (deps == null ? void 0 : deps.cache) ?? cacheManager;
  }
  // ═════════════════════════════════════════════════════════════
  // 入口方法
  // ═════════════════════════════════════════════════════════════
  /**
   * 股票池批量分析（完整四层）
   *
   * 流程:
   *   1. 获取市场数据
   *   2. L1 → 市场环境
   *   3. L2 → 方向判断
   *   4. L3 → 个股分析
   *   5. 构建 Prompt → 调用 DeepSeek
   *   6. L4 → 解析结论
   *
   * @param options - 分析参数
   * @returns 完整分析结果
   */
  async analyzePool(options) {
    const { stocks, forceRefresh, streamCallbacks, signal } = options;
    if (!stocks || stocks.length === 0) {
      throw new Error("股票列表为空");
    }
    if (stocks.length > 50) {
      throw new Error("单次分析最多支持 50 只股票");
    }
    logger$1.info(`[Engine] 开始分析股票池: ${stocks.length} 只`, stocks);
    const marketData = await this.fetchMarketData(forceRefresh);
    signal == null ? void 0 : signal.throwIfAborted();
    const envResult = await this.runL1(marketData.indices, marketData.sectors);
    signal == null ? void 0 : signal.throwIfAborted();
    const directions = await this.runL2(marketData.sectors, marketData.topics);
    signal == null ? void 0 : signal.throwIfAborted();
    const stockAnalyses = await this.runL3(
      stocks,
      marketData.indices,
      marketData.sectors
    );
    signal == null ? void 0 : signal.throwIfAborted();
    const llmResult = await this.callLLM(
      {
        indices: marketData.indices,
        sectors: marketData.sectors,
        topics: marketData.topics,
        quotes: marketData.quotes,
        stocksToAnalyze: stocks.map((c) => ({
          code: c,
          name: this.findStockName(c, marketData.quotes)
        })),
        envResult,
        directions,
        stockAnalyses
      },
      { streamCallbacks, signal }
    );
    const result = await this.runL4(llmResult, {
      envLevel: envResult.envLevel,
      stockCodes: stocks
    });
    logger$1.info("[Engine] 分析完成:", {
      stocks: stocks.length,
      envLevel: result.marketEnv.envLevel,
      conclusions: result.conclusions.length,
      buyCount: result.conclusions.filter((c) => c.verdict === "BUY").length
    });
    return result;
  }
  /**
   * 环境诊断（仅 L1）
   *
   * 快速获取市场环境评级，不分析个股
   */
  async envCheck(options) {
    var _a2;
    logger$1.info("[Engine] 环境诊断");
    const marketData = await this.fetchMarketData(options == null ? void 0 : options.forceRefresh);
    (_a2 = options == null ? void 0 : options.signal) == null ? void 0 : _a2.throwIfAborted();
    const envResult = await this.runL1(marketData.indices, marketData.sectors);
    return {
      ...envResult,
      indices: marketData.indices,
      sectors: marketData.sectors,
      topics: marketData.topics
    };
  }
  /**
   * 单只股票快速分析
   *
   * 流程:
   *   1. 获取市场数据 + 目标个股行情
   *   2. L1 → 环境判断
   *   3. L2 → 方向判断
   *   4. 构建单票 Prompt → LLM
   *   5. L4 → 解析结论
   */
  async analyzeSingle(options) {
    var _a2, _b, _c;
    const { code, forceRefresh, streamCallbacks, signal } = options;
    if (!code) {
      throw new Error("请提供股票代码");
    }
    logger$1.info(`[Engine] 单票分析: ${code}`);
    const [marketData, quote] = await Promise.all([
      this.fetchMarketData(forceRefresh),
      this.dataSource.getQuote(code)
    ]);
    signal == null ? void 0 : signal.throwIfAborted();
    const [envResult, directions] = await Promise.all([
      this.runL1(marketData.indices, marketData.sectors),
      this.runL2(marketData.sectors, marketData.topics)
    ]);
    signal == null ? void 0 : signal.throwIfAborted();
    const messages = this.promptBuilder.buildSingleStockPrompt({
      quote,
      indices: marketData.indices,
      sectors: marketData.sectors
    });
    let llmOutput;
    if (streamCallbacks) {
      const streamResult = await this.llmClient.chatStream(
        messages,
        streamCallbacks,
        { signal }
      );
      llmOutput = streamResult.fullContent;
    } else {
      const response = await this.llmClient.chat(messages, { signal });
      llmOutput = ((_c = (_b = (_a2 = response.choices) == null ? void 0 : _a2[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) ?? "";
    }
    const result = await this.runL4(llmOutput, {
      envLevel: envResult.envLevel,
      stockCodes: [code]
    });
    logger$1.info(`[Engine] 单票分析完成: ${quote.name}(${code})`);
    return result;
  }
  // ═════════════════════════════════════════════════════════════
  // 数据获取
  // ═════════════════════════════════════════════════════════════
  /**
   * 获取所有市场数据（并行）
   */
  async fetchMarketData(forceRefresh) {
    const cacheOpts = forceRefresh ? { useCache: false } : { useCache: this.config.useCache };
    const [indices, sectors, topics] = await Promise.all([
      this.dataSource.getMarketIndex(cacheOpts),
      this.dataSource.getSectors(cacheOpts),
      this.dataSource.getHotTopics(cacheOpts)
    ]);
    return {
      indices,
      sectors,
      topics,
      quotes: []
      // 个股行情在 L3 阶段按需获取
    };
  }
  /**
   * 获取个股行情（缓存）
   */
  async fetchQuotes(codes, forceRefresh) {
    const cacheOpts = forceRefresh ? { useCache: false } : { useCache: this.config.useCache };
    if (codes.length <= 50) {
      return await this.dataSource.getQuotes(codes, cacheOpts);
    }
    const results = [];
    for (let i = 0; i < codes.length; i += 50) {
      const batch = codes.slice(i, i + 50);
      const batchResults = await this.dataSource.getQuotes(batch, cacheOpts);
      results.push(...batchResults);
    }
    return results;
  }
  // ═════════════════════════════════════════════════════════════
  // 引擎层执行
  // ═════════════════════════════════════════════════════════════
  /** L1: 市场环境 */
  async runL1(indices, sectors) {
    return this.marketAnalyzer.analyze(indices, sectors);
  }
  /** L2: 方向判断 */
  async runL2(sectors, topics) {
    return this.directionAnalyzer.analyze(sectors, topics);
  }
  /** L3: 个股分析 */
  async runL3(stockCodes, indices, sectors) {
    const quotes = await this.fetchQuotes(stockCodes);
    if (quotes.length === 0) {
      logger$1.warn("[Engine] 无法获取个股行情");
      return [];
    }
    const maxBatch = this.config.maxConcurrent;
    const results = [];
    for (let i = 0; i < quotes.length; i += maxBatch) {
      const batch = quotes.slice(i, i + maxBatch);
      const batchResults = await this.stockAnalyzer.analyze(batch, indices, sectors);
      results.push(...batchResults);
    }
    return results;
  }
  /** L4: 结论解析 */
  async runL4(llmOutput, fallback) {
    return this.conclusionEngine.process(llmOutput, fallback);
  }
  // ═════════════════════════════════════════════════════════════
  // LLM 调用
  // ═════════════════════════════════════════════════════════════
  /**
   * 构建 Prompt 并调用 LLM
   */
  async callLLM(data, options) {
    var _a2, _b, _c;
    const messages = this.promptBuilder.buildAnalysisPrompt({
      indices: data.indices,
      sectors: data.sectors,
      topics: data.topics,
      quotes: data.quotes,
      stocksToAnalyze: data.stocksToAnalyze
    });
    if (this.config.enableLocalPreAnalysis) {
      const localContext = this.buildLocalAnalysisContext(
        data.envResult,
        data.directions,
        data.stockAnalyses
      );
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.content += `

【本地预处理结果（仅供参考）】
${localContext}

请基于以上信息进行完整四层分析，并输出最终 JSON 结论。`;
      }
    }
    let llmOutput;
    const signal = options == null ? void 0 : options.signal;
    if (options == null ? void 0 : options.streamCallbacks) {
      const streamResult = await this.llmClient.chatStream(
        messages,
        options.streamCallbacks,
        { signal }
      );
      llmOutput = streamResult.fullContent;
    } else {
      const response = await this.llmClient.chat(messages, {
        signal
      });
      llmOutput = ((_c = (_b = (_a2 = response.choices) == null ? void 0 : _a2[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) ?? "";
    }
    return llmOutput;
  }
  /**
   * 构建设本地预处理分析上下文
   * 将 L1/L2/L3 的分析结果转为自然语言，注入 LLM prompt
   */
  buildLocalAnalysisContext(envResult, directions, stockAnalyses) {
    const parts = [];
    parts.push(
      `[L1 市场环境] 评级: ${envResult.envLevel} | 情绪: ${envResult.sentiment} | 建议: ${envResult.suggestion}`
    );
    if (directions.length > 0) {
      const dirLines = directions.map(
        (d, i) => `  ${i + 1}. 主线: ${d.mainLine} | 次线: ${d.subLine}`
      );
      parts.push(`[L2 方向判断]
${dirLines.join("\n")}`);
    }
    if (stockAnalyses.length > 0) {
      const stockLines = stockAnalyses.map(
        (s) => `  ${s.stock}(${s.code}): 位置=${s.position} | 强度=${s.strength} | 量价=${s.volumeAnalysis}`
      );
      parts.push(`[L3 个股技术面]
${stockLines.join("\n")}`);
    }
    return parts.join("\n\n");
  }
  // ═════════════════════════════════════════════════════════════
  // 辅助方法
  // ═════════════════════════════════════════════════════════════
  /** 从行情列表中查找股票名称 */
  findStockName(code, quotes) {
    const quote = quotes.find((q) => q.code === code);
    return (quote == null ? void 0 : quote.name) ?? code;
  }
  /**
   * 更新引擎配置
   */
  setConfig(partial) {
    this.config = { ...this.config, ...partial };
    this.llmClient.setConfig({
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens
    });
  }
  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }
}
new AnalysisEngine();
const SW_VERSION = "1.0.0";
const eastMoney = new EastMoneyAdapter();
const analysisEngine = new AnalysisEngine();
function registerIpcHandlers() {
  ipcMain.handle("PING", async () => {
    return { status: "ok", version: SW_VERSION };
  });
  ipcMain.handle("ENV_CHECK", async () => {
    logger$1.info("[IPC] 环境诊断请求");
    const envResult = await analysisEngine.envCheck();
    const l2 = new L2DirectionAnalyzer();
    const directions = await l2.analyze(envResult.sectors, envResult.topics);
    logger$1.info(`[IPC] 环境诊断完成: 级别 ${envResult.envLevel}`);
    return {
      envLevel: envResult.envLevel,
      sentiment: envResult.sentiment,
      suggestion: envResult.suggestion,
      indices: envResult.indices,
      sectors: envResult.sectors,
      topics: envResult.topics,
      directions
    };
  });
  ipcMain.handle("ANALYZE_POOL", async (_event, payload) => {
    const stockList = (payload == null ? void 0 : payload.stocks) ?? [];
    logger$1.info(`[IPC] 股票池分析请求: ${stockList.length} 只股票`);
    if (stockList.length === 0) {
      throw new Error("股票列表为空，请提供待分析的股票代码");
    }
    if (stockList.length > 50) {
      throw new Error("单次分析最多支持 50 只股票");
    }
    const result = await analysisEngine.analyzePool({ stocks: stockList });
    logger$1.info(`[IPC] 股票池分析完成: ${result.conclusions.length} 条结论`);
    return result;
  });
  ipcMain.handle("ANALYZE_SINGLE", async (_event, payload) => {
    const stockName = (payload == null ? void 0 : payload.stock) ?? "未知";
    const stockCode = (payload == null ? void 0 : payload.code) ?? "";
    logger$1.info(`[IPC] 单票分析请求: ${stockName} (${stockCode || "无代码"})`);
    if (!stockCode && !stockName) {
      throw new Error("请提供股票代码或名称");
    }
    return {
      message: "单票分析已实现",
      stock: stockName,
      code: stockCode
    };
  });
  ipcMain.handle("GET_QUOTE", async (_event, payload) => {
    const stockCode = (payload == null ? void 0 : payload.code) ?? "";
    logger$1.info(`[IPC] 行情查询请求: ${stockCode}`);
    if (!stockCode) {
      throw new Error("请提供股票代码");
    }
    const quote = await eastMoney.getQuote(stockCode);
    return quote;
  });
  ipcMain.handle("GET_MARKET", async () => {
    logger$1.info("[IPC] 大盘数据请求");
    const indices = await eastMoney.getMarketIndex();
    return indices;
  });
  ipcMain.handle("GET_SECTOR", async (_event, payload) => {
    const subType = payload == null ? void 0 : payload.type;
    logger$1.info(`[IPC] 板块数据请求: type=${subType}`);
    switch (subType) {
      case "sectors": {
        const sectors = await eastMoney.getSectors();
        return sectors;
      }
      case "detail": {
        const code = payload == null ? void 0 : payload.code;
        if (!code) throw new Error("板块明细查询需要提供 code 参数");
        const detail = await eastMoney.getSectorDetail(code);
        return detail;
      }
      case "topics": {
        const topics = await eastMoney.getHotTopics();
        return topics;
      }
      default:
        throw new Error(`未知的 GET_SECTOR 子命令: ${subType}`);
    }
  });
}
async function startStreamPoolAnalysis(win, payload) {
  const stocks = (payload == null ? void 0 : payload.stocks) ?? [];
  logger$1.info(`[IPC-Stream] 流式股票池分析: ${stocks.length} 只`);
  if (stocks.length === 0) {
    win.webContents.send("stream:event", {
      event: "stream:error",
      data: "股票列表为空"
    });
    return;
  }
  try {
    sendProgress(win, "fetching", "正在获取市场数据...", 5);
    const result = await analysisEngine.analyzePool({
      stocks,
      streamCallbacks: {
        onChunk: (_chunk) => {
          var _a2, _b, _c;
          const content = ((_c = (_b = (_a2 = _chunk.choices) == null ? void 0 : _a2[0]) == null ? void 0 : _b.delta) == null ? void 0 : _c.content) ?? "";
          if (content) {
            win.webContents.send("stream:event", {
              event: "stream:chunk",
              data: content
            });
          }
        }
      }
    });
    win.webContents.send("stream:event", {
      event: "stream:env-level",
      data: result.marketEnv
    });
    sendProgress(win, "l4", "正在生成结论...", 90);
    for (const c of result.conclusions) {
      win.webContents.send("stream:event", {
        event: "stream:conclusion",
        data: {
          stockCode: c.stockCode,
          stockName: c.stockName,
          verdict: c.verdict,
          reason: c.reason,
          riskPoints: c.riskPoints,
          priority: c.priority
        }
      });
    }
    sendProgress(win, "done", "分析完成", 100);
    win.webContents.send("stream:event", {
      event: "stream:done",
      data: result
    });
    logger$1.info(`[IPC-Stream] 流式分析完成: ${stocks.length} 只股票`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger$1.error("[IPC-Stream] 流式分析错误:", errMsg);
    win.webContents.send("stream:event", {
      event: "stream:error",
      data: errMsg
    });
  }
}
async function startStreamSingleAnalysis(win, payload) {
  const code = (payload == null ? void 0 : payload.code) ?? (payload == null ? void 0 : payload.stock) ?? "";
  logger$1.info(`[IPC-Stream] 流式单票分析: ${code}`);
  if (!code) {
    win.webContents.send("stream:event", {
      event: "stream:error",
      data: "请提供股票代码"
    });
    return;
  }
  try {
    sendProgress(win, "fetching", "正在获取数据...", 10);
    const result = await analysisEngine.analyzeSingle({
      code,
      streamCallbacks: {
        onChunk: (_chunk) => {
          var _a2, _b, _c;
          const content = ((_c = (_b = (_a2 = _chunk.choices) == null ? void 0 : _a2[0]) == null ? void 0 : _b.delta) == null ? void 0 : _c.content) ?? "";
          if (content) {
            win.webContents.send("stream:event", {
              event: "stream:chunk",
              data: content
            });
          }
        }
      }
    });
    win.webContents.send("stream:event", {
      event: "stream:env-level",
      data: result.marketEnv
    });
    for (const c of result.conclusions) {
      win.webContents.send("stream:event", {
        event: "stream:conclusion",
        data: {
          stockCode: c.stockCode,
          stockName: c.stockName,
          verdict: c.verdict,
          reason: c.reason,
          riskPoints: c.riskPoints,
          priority: c.priority
        }
      });
    }
    win.webContents.send("stream:event", {
      event: "stream:done",
      data: result
    });
    logger$1.info(`[IPC-Stream] 流式单票分析完成: ${code}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger$1.error("[IPC-Stream] 流式分析错误:", errMsg);
    win.webContents.send("stream:event", {
      event: "stream:error",
      data: errMsg
    });
  }
}
function sendProgress(win, stage, message, percent) {
  const progress = { stage, message, percent };
  win.webContents.send("stream:event", {
    event: "stream:progress",
    data: progress
  });
}
function registerStreamIpcHandlers() {
  ipcMain.on("stream:start", (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const { type, payload: data } = payload;
    switch (type) {
      case "ANALYZE_POOL_STREAM":
        startStreamPoolAnalysis(win, data);
        break;
      case "ANALYZE_SINGLE_STREAM":
        startStreamSingleAnalysis(win, data);
        break;
      default:
        win.webContents.send("stream:event", {
          event: "stream:error",
          data: `未知流式类型: ${type}`
        });
    }
  });
}
const DEFAULT_SETTINGS = {
  model: "deepseek-chat",
  temperature: 0.7,
  maxTokens: 4096,
  autoAnalyze: false,
  maxConcurrent: 3,
  debugMode: false
};
const DEFAULT_DATA = {
  api_key: "",
  settings: { ...DEFAULT_SETTINGS },
  watchlist: [],
  history: [],
  meta: {
    installed_at: Date.now(),
    version: "1.0.0"
  },
  cache: {}
};
class FileStore {
  constructor() {
    this.dirty = false;
    this.saveTimer = null;
    const userDataPath = app.getPath("userData");
    this.filePath = path.join(userDataPath, "xvqiu-data.json");
    this.data = this.load();
  }
  // ─── 文件读写 ──────────────────────────────────
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_DATA, ...parsed };
      }
    } catch (err) {
      console.error("[FileStore] 读取失败，使用默认值:", err);
    }
    return { ...DEFAULT_DATA, meta: { ...DEFAULT_DATA.meta } };
  }
  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
      this.dirty = false;
    } catch (err) {
      console.error("[FileStore] 写入失败:", err);
    }
  }
  scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.dirty) this.save();
    }, 500);
  }
  // ─── 通用读写 ──────────────────────────────────
  get(key) {
    return this.data[key];
  }
  set(key, value) {
    this.data[key] = value;
    this.scheduleSave();
  }
  remove(key) {
    delete this.data[key];
    this.scheduleSave();
  }
  has(key) {
    return key in this.data;
  }
  getAll() {
    return { ...this.data };
  }
  resetAll() {
    this.data = { ...DEFAULT_DATA, meta: { ...DEFAULT_DATA.meta } };
    this.save();
  }
  // ─── 缓存 ──────────────────────────────────────
  getCache(name) {
    const entry = this.data.cache[name];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      delete this.data.cache[name];
      this.scheduleSave();
      return null;
    }
    return entry.data;
  }
  setCache(name, data, ttl = 3e4) {
    this.data.cache[name] = { data, timestamp: Date.now(), ttl };
    this.scheduleSave();
  }
  removeCache(name) {
    delete this.data.cache[name];
    this.scheduleSave();
  }
  clearCache() {
    this.data.cache = {};
    this.scheduleSave();
  }
  // ─── 历史记录 ──────────────────────────────────
  getHistory(options) {
    let filtered = [...this.data.history];
    if ((options == null ? void 0 : options.from) !== void 0) {
      filtered = filtered.filter((r) => r.createdAt >= options.from);
    }
    if ((options == null ? void 0 : options.to) !== void 0) {
      filtered = filtered.filter((r) => r.createdAt <= options.to);
    }
    if (options == null ? void 0 : options.verdict) {
      filtered = filtered.filter(
        (r) => r.result.conclusions.some((c) => c.verdict === options.verdict)
      );
    }
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    const offset = (options == null ? void 0 : options.offset) ?? 0;
    const limit = (options == null ? void 0 : options.limit) ?? filtered.length;
    return filtered.slice(offset, offset + limit);
  }
  addHistory(record, note, tags) {
    const id = this.generateId();
    const entry = {
      id,
      createdAt: Date.now(),
      note,
      tags,
      result: record
    };
    this.data.history.push(entry);
    if (this.data.history.length > 500) {
      this.data.history = this.data.history.slice(-500);
    }
    this.scheduleSave();
    return id;
  }
  removeHistory(id) {
    const idx = this.data.history.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.data.history.splice(idx, 1);
    this.scheduleSave();
    return true;
  }
  clearHistory() {
    this.data.history = [];
    this.scheduleSave();
  }
  // ─── 元数据 ──────────────────────────────────
  setMeta(name, value) {
    this.data.meta[name] = value;
    this.scheduleSave();
  }
  getMeta(name) {
    return this.data.meta[name];
  }
  removeMeta(name) {
    delete this.data.meta[name];
    this.scheduleSave();
  }
  // ─── 工具 ────────────────────────────────────
  generateId() {
    const chars = "0123456789abcdef";
    const sections = [8, 4, 4, 4, 12];
    return sections.map((len) => {
      let s = "";
      for (let i = 0; i < len; i++) {
        s += chars[Math.floor(Math.random() * 16)];
      }
      return s;
    }).join("-");
  }
  close() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    if (this.dirty) {
      this.save();
    }
  }
}
let storeInstance = null;
function getStore() {
  if (!storeInstance) {
    storeInstance = new FileStore();
  }
  return storeInstance;
}
function logger(info, ...args) {
  console.log(`[Main] ${info}`, ...args);
}
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
const isDev = !app.isPackaged;
const APP_NAME = "xvqiu - A股短线交易决策助手";
let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    icon: path.join(__dirname$1, "../icons/icon-128.png"),
    width: 420,
    height: 720,
    minWidth: 360,
    minHeight: 500,
    resizable: true,
    frame: true,
    titleBarStyle: "default",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173/");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://platform.deepseek.com")) {
      return { action: "allow" };
    }
    return { action: "deny" };
  });
  logger(`窗口已创建 (${isDev ? "开发" : "生产"}模式)`);
}
function registerStoreIpcHandlers() {
  const store = getStore();
  ipcMain.handle("store:get", (_event, key) => {
    return store.get(key);
  });
  ipcMain.handle("store:set", (_event, key, value) => {
    store.set(key, value);
  });
  ipcMain.handle("store:remove", (_event, key) => {
    store.remove(key);
  });
  ipcMain.handle("store:getWatchlist", () => {
    return store.get("watchlist") ?? [];
  });
  ipcMain.handle("store:setWatchlist", (_event, list) => {
    store.set("watchlist", list);
  });
  ipcMain.handle("store:getHistory", (_event, options) => {
    return store.getHistory(options);
  });
  ipcMain.handle("store:addHistory", (_event, record, note, tags) => {
    return store.addHistory(record, note, tags);
  });
  ipcMain.handle("store:removeHistory", (_event, id) => {
    return store.removeHistory(id);
  });
  ipcMain.handle("store:clearHistory", () => {
    store.clearHistory();
  });
  logger("Storage IPC handlers 已注册");
}
app.whenReady().then(() => {
  logger(`${APP_NAME} 启动中...`);
  registerIpcHandlers();
  registerStreamIpcHandlers();
  registerStoreIpcHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    const store = getStore();
    store.close();
    app.quit();
  }
});
app.on("before-quit", () => {
  const store = getStore();
  store.close();
});
