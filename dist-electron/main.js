import { ipcMain as w, BrowserWindow as ce, app as P } from "electron";
import * as R from "path";
import { fileURLToPath as Ye } from "url";
import * as O from "fs";
async function Ne(i, e = {}) {
  const {
    maxRetries: t = 3,
    baseDelay: s = 1e3,
    maxDelay: n = 1e4,
    onRetry: r
  } = e;
  let o;
  for (let c = 0; c <= t; c++)
    try {
      return await i();
    } catch (a) {
      if (o = a, c < t) {
        const u = Math.min(s * Math.pow(2, c), n);
        r == null || r(o, c), await new Promise((l) => setTimeout(l, u));
      }
    }
  throw o;
}
const Je = {
  maxRequests: 5,
  windowMs: 1e3
  // 5 req / sec
}, we = 8e3, qe = 3e4, Ve = 3, Qe = 6e4;
class Ge {
  constructor(e = Je) {
    this.rateLimit = e, this.cache = /* @__PURE__ */ new Map(), this.rateLimitQueue = [], this.lastRequestTime = 0, this.processingQueue = !1, this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedRequests: 0,
      rateLimited: 0
    }, this.cleanupTimer = null, typeof setInterval < "u" && (this.cleanupTimer = setInterval(
      () => this.evictExpired(),
      Qe
    ));
  }
  // ─── 公开 API ──────────────────────────────────────────
  /**
   * 发起 HTTP 请求，返回解析后的 JSON 数据
   * 集成：速率限制 → 缓存检查 → 超时 → 重试
   */
  async fetchJSON(e, t = {}) {
    this.stats.totalRequests++;
    const {
      useCache: s = !0,
      ttl: n = qe,
      timeout: r = we,
      retry: o = Ve,
      headers: c = {}
    } = t;
    if (s) {
      const a = this.getFromCache(e);
      if (a !== null)
        return this.stats.cacheHits++, a;
    }
    this.stats.cacheMisses++;
    try {
      const a = await this.executeWithRateLimit(e, r, o, c);
      return s && this.setCache(e, a, n), a;
    } catch (a) {
      throw this.stats.failedRequests++, a;
    }
  }
  /**
   * 发起原始 HTTP 请求，返回 Response（不缓存、不限速）
   * 适用于流式或非 JSON 场景
   */
  async fetchRaw(e, t = we) {
    const s = new AbortController(), n = setTimeout(() => s.abort(), t);
    try {
      return await fetch(e, {
        signal: s.signal
      });
    } finally {
      clearTimeout(n);
    }
  }
  // ─── 缓存管理 ──────────────────────────────────────────
  /** 清空所有缓存 */
  clearCache() {
    this.cache.clear(), this.stats.cacheHits = 0, this.stats.cacheMisses = 0;
  }
  /** 删除指定 URL 的缓存 */
  invalidateCache(e) {
    this.cache.delete(e);
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
    this.cleanupTimer !== null && (clearInterval(this.cleanupTimer), this.cleanupTimer = null), this.cache.clear();
  }
  // ─── 内部实现 ──────────────────────────────────────────
  /**
   * 执行带速率限制的请求
   * 使用队列确保不超过 rateLimit.maxRequests / rateLimit.windowMs
   */
  async executeWithRateLimit(e, t, s, n) {
    return await this.enqueue(), Ne(
      async () => {
        const r = new AbortController(), o = setTimeout(() => r.abort(), t);
        try {
          const c = await fetch(e, {
            signal: r.signal,
            headers: {
              Accept: "application/json",
              "Accept-Language": "zh-CN,zh;q=0.9",
              Referer: "https://quote.eastmoney.com/",
              ...n
            }
          });
          if (!c.ok)
            throw new Error(
              `HTTP ${c.status}: ${c.statusText} (${e})`
            );
          const a = await c.text();
          if (!a || a.trim().length === 0)
            throw new Error("东方财富 API 返回空数据");
          return JSON.parse(a);
        } catch (c) {
          throw c instanceof DOMException && c.name === "AbortError" ? new Error(`请求超时 (${t}ms): ${e}`) : c;
        } finally {
          clearTimeout(o);
        }
      },
      {
        maxRetries: s,
        baseDelay: 500,
        maxDelay: 5e3,
        onRetry: (r, o) => {
          console.warn(
            `[DataFetcher] 重试 #${o + 1}/${s}: ${e}`,
            r.message
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
    return new Promise((e) => {
      this.rateLimitQueue.push(e), this.processingQueue || this.processQueue();
    });
  }
  async processQueue() {
    for (this.processingQueue = !0; this.rateLimitQueue.length > 0; ) {
      const t = Date.now() - this.lastRequestTime, s = this.rateLimit.windowMs / this.rateLimit.maxRequests;
      t < s && await Xe(s - t);
      const n = this.rateLimitQueue.shift();
      n && (this.lastRequestTime = Date.now(), n());
    }
    this.processingQueue = !1;
  }
  // ─── 缓存操作 ──────────────────────────────────────────
  getFromCache(e) {
    const t = this.cache.get(e);
    return t ? Date.now() - t.timestamp > t.ttl ? (this.cache.delete(e), null) : t.data : null;
  }
  setCache(e, t, s) {
    this.cache.set(e, {
      data: t,
      timestamp: Date.now(),
      ttl: s
    });
  }
  /** 清理过期缓存条目 */
  evictExpired() {
    const e = Date.now();
    for (const [t, s] of this.cache.entries())
      e - s.timestamp > s.ttl && this.cache.delete(t);
  }
}
function Xe(i) {
  return new Promise((e) => setTimeout(e, i));
}
const he = "https://push2.eastmoney.com/api/qt", Ze = "/stock/get", et = "/ulist.np/get", tt = "/clist/get", X = "f2,f3,f4,f12,f14,f20,f62,f104,f128,f140,f141,f142", st = "f2,f3,f4,f5,f6,f12,f14", Ue = "f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f55,f57,f58,f60,f116,f117,f162,f167", nt = "f43,f44,f45,f46,f47,f48,f50,f52,f55,f57,f58,f60,f62,f115,f128,f140", rt = [
  "1.000001",
  // 上证指数
  "0.399001",
  // 深证成指
  "0.399006",
  // 创业板指
  "1.000688"
  // 科创50
], it = {
  6: 1,
  // SH
  5: 1,
  // SH 基金/债券
  0: 0,
  // SZ 主板
  3: 0,
  // SZ 创业板
  4: 0,
  // BJ / 新三板
  8: 0
  // BJ 北交所
}, b = 1e4, ot = 15e3;
class He {
  /**
   * @param fetcher 可注入自定义 DataFetcher（便于测试 / 共享限制器）
   */
  constructor(e) {
    this.fetcher = e ?? new Ge();
  }
  // ─── 公开接口 ──────────────────────────────────────────
  /**
   * 获取个股实时行情
   *
   * @param code 股票代码（6 位数字，如 "600519"）
   * @returns StockQuote
   * @throws 股票代码无效 / 网络异常 / API 返回空数据
   */
  async getQuote(e, t) {
    const s = e.replace(/^(SH|SZ|BJ)/i, "").trim();
    if (!/^\d{6}$/.test(s))
      throw new Error(`无效的股票代码: ${e}，应为 6 位数字`);
    const n = ve(s), r = ct(n), o = await this.fetcher.fetchJSON(r, {
      useCache: !0,
      ttl: b,
      ...t
    });
    if (!o.data)
      throw new Error(`东方财富 API 返回空数据: code=${e}`);
    return Ee(o.data, s);
  }
  /**
   * 批量获取个股实时行情
   *
   * @param codes 股票代码数组（每个 6 位数字）
   * @param options 可选覆写请求配置
   * @returns StockQuote[] — 成功解析的行情列表（失败的静默忽略）
   */
  async getQuotes(e, t) {
    if (e.length === 0) return [];
    if (e.length > 50)
      throw new Error("批量查询最多支持 50 只股票");
    const s = e.map((c) => c.replace(/^(SH|SZ|BJ)/i, "").trim()).filter((c) => /^\d{6}$/.test(c));
    if (s.length === 0) return [];
    const n = s.map(ve), r = ee(n, Ue), o = await this.fetcher.fetchJSON(r, {
      useCache: !0,
      ttl: b,
      ...t
    });
    return !o.data || !o.data.diff ? [] : o.data.diff.filter((c) => c !== null && c.f57 !== null).map((c) => Ee(c));
  }
  /**
   * 获取大盘指数数据
   * 返回 [上证指数, 深证成指, 创业板指, 科创50]
   */
  async getMarketIndex(e) {
    const t = ee([...rt], nt), s = await this.fetcher.fetchJSON(t, {
      useCache: !0,
      ttl: ot,
      ...e
    });
    return !s.data || !s.data.diff ? [] : s.data.diff.filter((n) => n !== null && n.f57 !== null).map(ht);
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
  async getSectors(e) {
    const t = Z("m:90+t:2", 20, X, "f3"), s = await this.fetcher.fetchJSON(t, {
      useCache: !0,
      ttl: b,
      ...e
    });
    return !s.data || !s.data.diff ? [] : s.data.diff.filter((n) => n !== null && n.f12 !== null).map(Ae);
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
  async getSectorDetail(e, t) {
    var m, d, y;
    const n = `BK${e.replace(/^BK/i, "").trim().toUpperCase()}`;
    if (!/^BK\d{4}$/i.test(n))
      throw new Error(
        `无效的板块代码: ${e}，应为 BK + 4 位数字（如 BK0477）`
      );
    const r = `90.${n}`, o = ee([r], X), c = await this.fetcher.fetchJSON(o, {
      useCache: !0,
      ttl: b,
      ...t
    });
    if (!((d = (m = c.data) == null ? void 0 : m.diff) != null && d[0]))
      throw new Error(`板块不存在: ${n}`);
    const a = Ae(c.data.diff[0]), u = Z(`b:${n}`, 50, st, "f3"), g = (((y = (await this.fetcher.fetchJSON(u, {
      useCache: !0,
      ttl: b,
      ...t
    })).data) == null ? void 0 : y.diff) ?? []).filter((p) => p !== null && p.f12 !== null).map(lt);
    return { sector: a, stocks: g };
  }
  /**
   * 获取热门题材/概念列表
   *
   * 请求东方财富概念板块（m:90+t:3），按涨幅降序返回前 20
   *
   * @param options 可选覆写请求配置
   * @returns HotTopic[]
   */
  async getHotTopics(e) {
    const t = Z("m:90+t:3", 20, X, "f3"), s = await this.fetcher.fetchJSON(t, {
      useCache: !0,
      ttl: b,
      ...e
    });
    return !s.data || !s.data.diff ? [] : s.data.diff.filter((n) => n !== null && n.f12 !== null).map(ut);
  }
  /**
   * 获取底层 DataFetcher 实例
   * 用于统计 / 缓存操作
   */
  getFetcher() {
    return this.fetcher;
  }
}
function at(i) {
  const e = i.charAt(0);
  return it[e] ?? 0;
}
function ve(i) {
  return `${at(i)}.${i}`;
}
function ct(i) {
  const e = new URLSearchParams({
    fltt: "2",
    secid: i,
    fields: Ue,
    _: String(Date.now())
  });
  return `${he}${Ze}?${e.toString()}`;
}
function Z(i, e, t, s = "f3", n = 1) {
  const r = new URLSearchParams({
    pn: "1",
    pz: String(e),
    po: String(n),
    np: "1",
    fltt: "2",
    invt: "2",
    fid: s,
    fs: i,
    fields: t,
    _: String(Date.now())
  });
  return `${he}${tt}?${r.toString()}`;
}
function ee(i, e) {
  const t = new URLSearchParams({
    fltt: "2",
    secids: i.join(","),
    fields: e,
    _: String(Date.now())
  });
  return `${he}${et}?${t.toString()}`;
}
function Ee(i, e) {
  const t = i.f57 ?? e ?? "000000", s = f(i.f43, 0);
  f(i.f60, s);
  const n = f(i.f52, 0), r = f(i.f55, 0);
  return {
    code: t,
    name: i.f58 ?? "",
    price: s,
    change: n,
    changePercent: r,
    volume: f(i.f47, 0),
    turnover: f(i.f48, 0),
    high: f(i.f44, s),
    low: f(i.f45, s),
    open: f(i.f46, s),
    amplitude: f(i.f49, 0),
    turnoverRate: f(i.f50, 0)
  };
}
function ht(i) {
  const e = f(i.f43, 0), t = f(i.f52, 0);
  return {
    code: i.f57 ?? "000000",
    name: i.f58 ?? "",
    price: e,
    change: t,
    changePercent: f(i.f55, 0),
    volume: f(i.f47, 0),
    amount: f(i.f48, 0)
  };
}
function Ae(i) {
  const e = i.f12 ?? "BK0000", t = i.f62 != null ? String(i.f62).padStart(6, "0") : "";
  return {
    code: e,
    name: i.f14 ?? "",
    changePercent: f(i.f3, 0),
    change: f(i.f4, 0),
    indexValue: f(i.f2, 0),
    leadingStock: i.f104 ?? "",
    leadingStockCode: t,
    leadingChange: f(i.f128, 0),
    upCount: f(i.f140, 0),
    downCount: f(i.f141, 0),
    capitalFlow: f(i.f142, 0)
  };
}
function lt(i) {
  return {
    code: i.f12 ?? "000000",
    name: i.f14 ?? "",
    price: f(i.f2, 0),
    changePercent: f(i.f3, 0),
    change: f(i.f4, 0),
    volume: f(i.f5, 0),
    turnover: f(i.f6, 0)
  };
}
function ut(i) {
  const e = i.f12 ?? "BK0000", t = i.f62 != null ? String(i.f62).padStart(6, "0") : "";
  return {
    code: e,
    name: i.f14 ?? "",
    changePercent: f(i.f3, 0),
    change: f(i.f4, 0),
    leadingStock: i.f104 ?? "",
    leadingStockCode: t,
    leadingChange: f(i.f128, 0),
    upCount: f(i.f140, 0),
    downCount: f(i.f141, 0),
    capitalFlow: f(i.f142, 0)
  };
}
function f(i, e) {
  if (i == null) return e;
  if (typeof i == "number")
    return Number.isFinite(i) ? i : e;
  const t = Number(i);
  return Number.isFinite(t) ? t : e;
}
const ft = "[xvqiu]", pe = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var Oe;
const gt = typeof window < "u" && (window.location.search.includes("debug=true") || ((Oe = window.localStorage) == null ? void 0 : Oe.getItem("xvqiu_debug")) === "true") ? "debug" : "info";
function W(i, ...e) {
  if (pe[i] < pe[gt]) return;
  (i === "error" ? console.error : i === "warn" ? console.warn : i === "info" ? console.info : console.log)(ft, `[${i.toUpperCase()}]`, ...e);
}
const h = {
  debug: (...i) => W("debug", ...i),
  info: (...i) => W("info", ...i),
  warn: (...i) => W("warn", ...i),
  error: (...i) => W("error", ...i)
}, Y = {
  INDEX_TREND: 0.35,
  // 指数趋势权重
  SECTOR_EFFECT: 0.25,
  // 板块效应权重
  VOLUME: 0.2,
  // 成交量能权重
  MARKET_BREADTH: 0.2
  // 市场宽度（涨跌家数等）
};
class mt {
  /**
   * 全量分析市场环境
   *
   * @param indices  - 大盘指数列表（上证/深证/创业板/科创50）
   * @param sectors  - 板块行情列表（用于判断板块效应）
   * @param prevIndices - 前一日指数数据（用于判断趋势变化，可选）
   * @returns MarketEnvResult
   */
  async analyze(e, t, s) {
    if (e.length === 0)
      return h.warn("[L1] 无指数数据，返回默认环境"), {
        envLevel: "B",
        sentiment: "数据不足",
        suggestion: "等待数据更新后再做判断"
      };
    const n = this.scoreIndexTrend(e, s), r = this.scoreSectorEffect(t), o = this.scoreVolume(e), c = this.scoreMarketBreadth(e, t), a = n * Y.INDEX_TREND + r * Y.SECTOR_EFFECT + o * Y.VOLUME + c * Y.MARKET_BREADTH, u = this.scoreToLevel(a), l = this.describeSentiment(e, u), g = this.getSuggestion(u, a, e);
    return h.debug("[L1] 环境评分结果:", {
      indexScore: n.toFixed(1),
      sectorScore: r.toFixed(1),
      volumeScore: o.toFixed(1),
      breadthScore: c.toFixed(1),
      totalScore: a.toFixed(1),
      envLevel: u
    }), { envLevel: u, sentiment: l, suggestion: g };
  }
  /**
   * 快速判断 — 只给评级，不做详细打分
   * 用于获取数据的模块内部快速判断
   */
  quickAssess(e) {
    if (e.length === 0) return "B";
    try {
      const t = this.averageChange(e);
      return t >= 1.5 ? "S" : t >= 0.5 ? "A" : t >= -0.5 ? "B" : t >= -1.5 ? "C" : "D";
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
  scoreIndexTrend(e, t) {
    if (e.length === 0) return 50;
    const s = this.averageChange(e);
    let n = 50 + s / 3 * 50;
    if (n = Math.max(0, Math.min(100, n)), t && t.length > 0) {
      const r = this.averageChange(t), o = s - r;
      o > 0.5 ? n += 10 : o < -0.5 && (n -= 10);
    }
    return Math.max(0, Math.min(100, n));
  }
  /**
   * 板块效应评分 (0-100)
   * - 上涨板块比例
   * - 领涨板块的涨幅强度
   */
  scoreSectorEffect(e) {
    if (e.length === 0) return 50;
    const s = e.filter((c) => c.changePercent > 0).length / e.length, n = e.slice(0, 3).reduce((c, a) => c + Math.max(0, a.changePercent), 0) / 3, r = s * 100, o = Math.min(100, n / 5 * 100);
    return r * 0.6 + o * 0.4;
  }
  /**
   * 成交量能评分 (0-100)
   * - 比较各指数的成交量与成交额变化
   * - 放量上涨 = 健康
   * - 缩量下跌 = 弱势
   */
  scoreVolume(e) {
    if (e.length === 0) return 50;
    e.find(
      (s) => s.code === "000001" || s.name.includes("上证")
    ), e.find(
      (s) => s.code === "399001" || s.name.includes("深证")
    );
    const t = this.averageChange(e);
    return t > 1 ? 70 : t > 0 ? 60 : t > -0.5 ? 50 : t > -1.5 ? 30 : 20;
  }
  /**
   * 市场宽度评分 (0-100)
   * - 上涨/下跌家数比（通过板块数据估算）
   * - 涨停/跌停数量
   */
  scoreMarketBreadth(e, t) {
    if (e.length === 0 && t.length === 0) return 50;
    let s = 0.5;
    t.length > 0 && (s = t.filter((a) => a.changePercent > 0).length / t.length);
    const n = s * 100;
    let r = 0;
    const o = t.filter(
      (c) => c.upCount > 0 || c.downCount > 0
    );
    return o.length > 0 && (r = (o.reduce((a, u) => {
      const l = u.upCount + u.downCount;
      return l > 0 ? a + u.upCount / l : a;
    }, 0) / o.length - 0.5) * 40), Math.max(0, Math.min(100, n * 0.7 + r));
  }
  // ─── 辅助方法 ──────────────────────────────────────
  /** 计算指数平均涨跌幅 */
  averageChange(e) {
    return e.length === 0 ? 0 : e.reduce((t, s) => t + s.changePercent, 0) / e.length;
  }
  /** 分数 → 环境评级 */
  scoreToLevel(e) {
    return e >= 80 ? "S" : e >= 60 ? "A" : e >= 40 ? "B" : e >= 20 ? "C" : "D";
  }
  /** 生成情绪描述 */
  describeSentiment(e, t) {
    const s = this.averageChange(e), r = {
      S: ["情绪亢奋", "赚钱效应强", "市场全面活跃"],
      A: ["情绪偏多", "赚钱效应较好", "市场健康"],
      B: ["情绪中性", "赚钱效应一般", "市场震荡"],
      C: ["情绪偏空", "亏钱效应明显", "市场低迷"],
      D: ["情绪恐慌", "系统性风险", "市场极端弱势"]
    }[t];
    return s > 2 ? r[0] : s > 0.5 ? r[1] : r[2];
  }
  /** 获取仓位/风格建议 */
  getSuggestion(e, t, s) {
    const n = this.averageChange(s);
    switch (e) {
      case "S":
        return n > 2 ? "可积极做多，仓位 7-8 成，追涨需谨慎" : "可适当加仓，仓位 5-7 成，围绕主线操作";
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
const J = {
  CHANGE: 0.3,
  // 涨幅权重
  BREADTH: 0.25,
  // 广度（涨跌比）权重
  CAPITAL: 0.25,
  // 资金流向权重
  LEADING: 0.2
  // 领涨股强度权重
}, Le = {
  MAIN_LINE: 65,
  // ≥65分 → 主线
  SUB_LINE: 40
  // ≥40分 → 次线
  // <40分 → 一般方向
}, dt = 3;
class Be {
  /**
   * 分析当前市场方向
   *
   * @param sectors - 行业板块行情列表（从东方财富获取）
   * @param topics  - 概念/题材列表
   * @returns DirectionResult[] — 按优先级排序的方向列表
   */
  async analyze(e, t) {
    if (e.length === 0 && (!t || t.length === 0))
      return h.warn("[L2] 无板块/题材数据，返回空方向"), [];
    const s = [];
    for (const a of e) {
      const u = this.calculateCompositeScore(a);
      s.push({
        name: a.name,
        code: a.code,
        changePercent: a.changePercent,
        upRatio: a.upCount + a.downCount > 0 ? a.upCount / (a.upCount + a.downCount) : 0.5,
        capitalFlow: a.capitalFlow,
        compositeScore: u,
        type: "sector"
      });
    }
    if (t)
      for (const a of t) {
        const u = this.calculateTopicScore(a);
        s.push({
          name: a.name,
          code: a.code,
          changePercent: a.changePercent,
          upRatio: a.upCount + a.downCount > 0 ? a.upCount / (a.upCount + a.downCount) : 0.5,
          capitalFlow: a.capitalFlow,
          compositeScore: u,
          type: "topic"
        });
      }
    s.sort((a, u) => u.compositeScore - a.compositeScore);
    const n = [], r = [];
    for (const a of s.slice(0, 10))
      a.compositeScore >= Le.MAIN_LINE ? this.isDuplicateDirection(n, a) || n.push(a) : a.compositeScore >= Le.SUB_LINE && (this.isDuplicateDirection(r, a) || r.push(a));
    const o = [];
    let c = 0;
    for (const a of n.slice(0, 2))
      c++, o.push({
        mainLine: a.name,
        subLine: c === 1 ? "主线核心" : "主线延伸/补涨",
        recommendations: []
        // L3 分析后填充
      });
    if (r.length > 0 && o.length < dt) {
      const a = r[0];
      o.push({
        mainLine: a.name,
        subLine: "次线/轮动方向",
        recommendations: []
      });
    }
    return o.length === 0 && o.push({
      mainLine: "无明显主线",
      subLine: "快速轮动/防守",
      recommendations: []
    }), h.debug("[L2] 方向分析结果:", {
      analyzed: s.length,
      mainLines: n.map((a) => `${a.name}(${a.compositeScore.toFixed(0)}分)`),
      subLines: r.map((a) => `${a.name}(${a.compositeScore.toFixed(0)}分)`)
    }), o;
  }
  /**
   * 获取当前最强方向（仅返回第一条主线）
   * 用于快速判断方向偏好
   */
  async getPrimaryDirection(e, t) {
    const s = await this.analyze(e, t);
    return s.length > 0 ? s[0] : null;
  }
  // ─── 评分方法 ──────────────────────────────────────
  /**
   * 计算板块方向的综合评分 (0-100)
   */
  calculateCompositeScore(e) {
    const t = Math.max(0, Math.min(
      100,
      30 + e.changePercent / 5 * 70
    )), s = e.upCount + e.downCount, n = s > 0 ? e.upCount / s * 100 : 50, r = Math.max(0, Math.min(
      100,
      50 + e.capitalFlow / 1e5 * 50
    )), o = Math.max(0, Math.min(
      100,
      50 + e.leadingChange / 10 * 50
    ));
    return t * J.CHANGE + n * J.BREADTH + r * J.CAPITAL + o * J.LEADING;
  }
  /**
   * 计算概念题材的综合评分 (0-100)
   * 概念数据结构与板块略有不同
   */
  calculateTopicScore(e) {
    const t = Math.max(0, Math.min(
      100,
      30 + e.changePercent / 5 * 70
    )), s = e.upCount + e.downCount, n = s > 0 ? e.upCount / s * 100 : 50, r = Math.max(0, Math.min(
      100,
      50 + e.capitalFlow / 1e5 * 50
    )), o = Math.max(0, Math.min(
      100,
      50 + e.leadingChange / 10 * 50
    ));
    return t * 0.35 + n * 0.3 + r * 0.2 + o * 0.15;
  }
  // ─── 辅助方法 ──────────────────────────────────────
  /**
   * 检查是否为重复方向（名称相似的主题/板块去重）
   */
  isDuplicateDirection(e, t) {
    return e.some((s) => {
      const n = s.name.replace(/[板块概念题材]/g, ""), r = t.name.replace(/[板块概念题材]/g, "");
      return n.includes(r) || r.includes(n);
    });
  }
}
const q = 9.8, yt = -9.8, S = {
  LOW: 3,
  // <3% 低换手
  MEDIUM: 8,
  // 3-8% 正常换手
  HIGH: 15
  // 8-15% 活跃换手
  // >15% 极高换手
}, N = {
  // <3% 窄幅
  NORMAL: 6,
  // 3-6% 正常
  WIDE: 10
  // 6-10% 宽幅
  // >10% 巨幅
};
class St {
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
  async analyze(e, t, s) {
    if (e.length === 0) return [];
    const n = this.getAvgMarketChange(t), r = this.buildSectorMap(s), o = [];
    for (const c of e)
      try {
        const a = this.analyzeSingle(
          c,
          n,
          r
        );
        o.push(a);
      } catch (a) {
        h.warn(`[L3] 分析 ${c.code} 失败:`, a), o.push({
          stock: c.name,
          code: c.code,
          position: "数据不足",
          strength: "--",
          volumeAnalysis: "--",
          logic: "待 LLM 补充",
          risk: ["数据不完整"],
          buyPoint: "待定"
        });
      }
    return h.debug(`[L3] 个股分析完成: ${o.length} 只`), o;
  }
  /**
   * 分析单只个股
   */
  analyzeSingle(e, t, s) {
    const n = this.assessPosition(e), r = this.assessStrength(e, t), o = this.assessVolumePrice(e), c = this.inferLogic(e), a = this.assessRisk(e), u = this.suggestBuyPoint(e, n);
    return {
      stock: e.name,
      code: e.code,
      position: n,
      strength: r,
      volumeAnalysis: o,
      logic: c,
      risk: a,
      buyPoint: u
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
  assessPosition(e) {
    const { changePercent: t, turnoverRate: s, amplitude: n } = e;
    return t >= q ? s > S.HIGH ? "放量涨停(高位)" : s > S.MEDIUM ? "涨停(中位)" : "缩量涨停(强势)" : t <= yt ? s > S.MEDIUM ? "放量跌停(危险)" : "跌停(弱势)" : t > 3 ? n > N.WIDE ? "宽幅上涨(突破区)" : n > N.NORMAL ? "震荡上涨(中位)" : "稳步上涨(趋势中)" : t > 0 ? s < S.LOW ? "缩量微涨(低位盘整)" : "温和上涨(中位)" : t > -3 ? s < S.LOW ? "缩量微跌(低位)" : "放量微跌(承压)" : s > S.MEDIUM ? "放量下跌(破位)" : "缩量下跌(回调)";
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
  assessStrength(e, t) {
    const s = e.changePercent - t;
    return e.changePercent >= q ? "极强(涨停)" : s > 3 ? "强(远超大盘)" : s > 0 ? "偏强(强于大盘)" : s > -2 ? "中性(与大盘同步)" : s > -5 ? "偏弱(弱于大盘)" : "弱(远弱于大盘)";
  }
  // ─── 量价分析 ──────────────────────────────────────
  /**
   * 量价配合关系分析
   */
  assessVolumePrice(e) {
    const { changePercent: t, turnoverRate: s, amplitude: n } = e;
    return t >= q ? s < S.LOW ? "缩量涨停(筹码锁定好)" : s < S.MEDIUM ? "温和放量涨停(健康)" : "放量涨停(分歧大)" : t > 3 ? s > S.HIGH ? "放量上攻(资金活跃)" : s > S.MEDIUM ? "量价配合(正常)" : "缩量上涨(抛压轻)" : t > 0 ? s > S.MEDIUM ? "放量滞涨(需警惕)" : "量平价稳(正常)" : t > -3 ? s > S.MEDIUM ? "放量滞跌(有承接)" : "缩量微跌(正常调整)" : s > S.MEDIUM ? "放量下跌(资金出逃)" : n > N.WIDE ? "宽幅震荡下跌(分歧)" : "缩量下跌(无人接盘)";
  }
  // ─── 逻辑推断（数据层面） ──────────────────────────
  /**
   * 基于数据推断可能的上涨逻辑
   * 具体逻辑需 LLM 补充，这里只做数据层面的提示
   */
  inferLogic(e) {
    const { changePercent: t, turnoverRate: s, amplitude: n } = e;
    return t >= q ? "涨停 — 可能有消息/题材驱动，需 LLM 确认具体逻辑" : t > 5 ? "大幅上涨 — 资金主动买入，需 LLM 确认驱动因素" : t > 2 ? s > S.MEDIUM ? "放量上涨 — 资金介入明显，需 LLM 判断题材属性" : "温和上涨 — 趋势延续，需 LLM 判断逻辑强度" : Math.abs(t) <= 2 ? s < S.LOW ? "缩量整理 — 等待方向选择，需 LLM 判断中期逻辑" : "震荡 — 多空平衡，需 LLM 分析题材催化" : "下跌 — 需 LLM 判断是洗盘还是出货";
  }
  // ─── 风险评估 ──────────────────────────────────────
  /**
   * 数据层面的风险识别
   */
  assessRisk(e) {
    const t = [], { changePercent: s, turnoverRate: n, amplitude: r, high: o, low: c, price: a } = e;
    return s > 7 && t.push("短线涨幅已大，追高有回调风险"), n > S.HIGH && t.push("换手率过高，筹码松动"), r > N.WIDE && t.push("波动剧烈，多空分歧大"), s < -5 && t.push("趋势走弱，下方支撑不明"), s < -2 && n > S.MEDIUM && t.push("放量下跌，资金出逃"), s > 3 && n < S.LOW && t.push("缩量上涨，持续性存疑"), r > N.NORMAL && s < 0 && o > a * 1.03 && t.push("高开低走，抛压沉重"), t.length === 0 && t.push("大盘系统性风险"), t;
  }
  // ─── 买入点位建议 ──────────────────────────────────
  /**
   * 基于当前位置和状态建议买入点位
   */
  suggestBuyPoint(e, t) {
    const { price: s, low: n, high: r } = e;
    return t.includes("涨停") ? "打板确认/排板，不低吸" : t.includes("高位") || t.includes("突破") ? `回调至 ${n.toFixed(2)} 附近低吸` : t.includes("低位") || t.includes("盘整") ? `现价附近分批建仓 ${(s * 0.98).toFixed(2)}-${(s * 1.02).toFixed(2)}` : t.includes("回调") || t.includes("下跌") ? `等待企稳信号，关注 ${n.toFixed(2)} 支撑` : `现价 ${s} 附近观察`;
  }
  // ─── 辅助方法 ──────────────────────────────────────
  /** 获取大盘平均涨跌幅 */
  getAvgMarketChange(e) {
    return !e || e.length === 0 ? 0 : e.reduce((t, s) => t + s.changePercent, 0) / e.length;
  }
  /** 构建板块代码→涨跌幅 映射 */
  buildSectorMap(e) {
    const t = /* @__PURE__ */ new Map();
    if (e)
      for (const s of e)
        t.set(s.code, s.changePercent);
    return t;
  }
}
class Me extends Error {
  constructor(e, t, s) {
    super(e), this.rawText = t, this.parseStage = s, this.name = "L4ParseError";
  }
}
const Ct = ["S", "A", "B", "C", "D"], wt = ["BUY", "COND_BUY", "WATCH", "NO_BUY"];
class vt {
  /**
   * 解析并处理 LLM 输出
   *
   * @param llmOutput - DeepSeek 返回的 content 字符串（预期为 JSON）
   * @param fallback  - 可选 fallback 数据（用于 LLM 部分失败时的降级）
   * @returns 完整的 AnalysisResult
   * @throws L4ParseError 当 JSON 解析完全失败时
   */
  async process(e, t) {
    if (!e || e.trim().length === 0)
      throw new Me("LLM 输出为空", e, "empty");
    const s = this.cleanLLMOutput(e);
    let n;
    try {
      n = JSON.parse(s);
    } catch (l) {
      const g = this.attemptJSONRepair(s);
      if (g !== null)
        n = g;
      else
        throw new Me(
          `JSON 解析失败: ${l instanceof Error ? l.message : String(l)}`,
          e,
          "json-parse"
        );
    }
    const r = this.parseMarketEnv(n.marketEnv, t == null ? void 0 : t.envLevel), o = this.parseDirections(n.directions), c = this.parseStocks(n.stocks), a = this.parseConclusions(
      n.conclusions,
      t == null ? void 0 : t.stockCodes
    );
    if (a.length === 0 && (t != null && t.stockCodes)) {
      h.warn("[L4] LLM 未输出结论，使用 fallback");
      for (const l of t.stockCodes)
        a.push({
          stockCode: l,
          stockName: l,
          verdict: "WATCH",
          reason: "LLM 未给出结论，默认观察",
          riskPoints: ["数据不足"],
          priority: 99
        });
    }
    a.sort((l, g) => l.priority - g.priority), this.normalizePriorities(a);
    const u = {
      marketEnv: r,
      directions: o,
      stocks: c,
      conclusions: a,
      timestamp: Date.now()
    };
    return h.debug("[L4] 结论处理完成:", {
      envLevel: r.envLevel,
      directions: o.length,
      stocks: c.length,
      conclusions: a.length,
      buyCount: a.filter((l) => l.verdict === "BUY").length
    }), u;
  }
  /**
   * 快速校验 LLM 输出是否为有效 JSON
   * 用于流式场景下的实时校验
   */
  validateChunk(e) {
    const t = this.cleanLLMOutput(e);
    try {
      const s = JSON.parse(t);
      return !s || typeof s != "object" ? { valid: !1, reason: "非对象" } : { valid: !0 };
    } catch {
      return { valid: !1, reason: "JSON 语法错误" };
    }
  }
  // ─── 内部解析方法 ──────────────────────────────────
  /**
   * 解析市场环境部分
   */
  parseMarketEnv(e, t) {
    var c, a;
    const s = {
      envLevel: t ?? "B",
      sentiment: "数据不足",
      suggestion: "等待数据更新"
    };
    if (!e) return s;
    const n = this.normalizeEnvLevel(e.envLevel) ?? s.envLevel, r = ((c = e.sentiment) == null ? void 0 : c.trim()) || s.sentiment, o = ((a = e.suggestion) == null ? void 0 : a.trim()) || s.suggestion;
    return { envLevel: n, sentiment: r, suggestion: o };
  }
  /**
   * 解析方向部分
   */
  parseDirections(e) {
    return !e || !Array.isArray(e) || e.length === 0 ? [] : e.filter((t) => t && t.mainLine).map((t) => ({
      mainLine: t.mainLine ?? "未知方向",
      subLine: t.subLine ?? "",
      recommendations: Array.isArray(t.recommendations) ? t.recommendations : []
    }));
  }
  /**
   * 解析个股分析部分
   */
  parseStocks(e) {
    return !e || !Array.isArray(e) || e.length === 0 ? [] : e.filter((t) => t && (t.stock || t.code)).map((t) => ({
      stock: t.stock ?? t.code ?? "未知",
      code: t.code ?? "",
      position: t.position ?? "--",
      strength: t.strength ?? "--",
      volumeAnalysis: t.volumeAnalysis ?? "--",
      logic: t.logic ?? "--",
      risk: Array.isArray(t.risk) ? t.risk : ["未知风险"],
      buyPoint: t.buyPoint ?? "--"
    }));
  }
  /**
   * 解析结论部分
   */
  parseConclusions(e, t) {
    var n;
    if (!e || !Array.isArray(e) || e.length === 0)
      return [];
    const s = [];
    for (const r of e) {
      if (!r || !r.stockCode && !r.stockName) continue;
      const o = this.normalizeVerdict(r.verdict);
      if (!o) {
        h.warn(`[L4] 忽略无效 verdict: ${r.verdict}`);
        continue;
      }
      s.push({
        stockCode: r.stockCode ?? r.stockName ?? "未知",
        stockName: r.stockName ?? r.stockCode ?? "未知",
        verdict: o,
        reason: ((n = r.reason) == null ? void 0 : n.trim()) || "无说明",
        riskPoints: Array.isArray(r.riskPoints) && r.riskPoints.length > 0 ? r.riskPoints : ["未指明风险"],
        priority: typeof r.priority == "number" ? r.priority : 999
      });
    }
    return s;
  }
  // ─── 规范化 ──────────────────────────────────────────
  /** 规范化环境评级 */
  normalizeEnvLevel(e) {
    if (!e) return null;
    const t = e.toUpperCase().trim();
    return Ct.includes(t) ? t : null;
  }
  /** 规范化结论 */
  normalizeVerdict(e) {
    if (!e) return null;
    const t = e.toUpperCase().trim();
    return wt.includes(t) ? t : t.includes("BUY") || t.includes("买") ? "COND_BUY" : t.includes("WATCH") || t.includes("观") || t.includes("察") ? "WATCH" : t.includes("NO") || t.includes("不") || t.includes("放弃") ? "NO_BUY" : null;
  }
  /**
   * 规范化结论优先级
   * 确保：1) 连续无断档 2) BUY 最高优先级
   */
  normalizePriorities(e) {
    e.sort((s, n) => {
      const r = this.verdictWeight(s.verdict), o = this.verdictWeight(n.verdict);
      return r !== o ? r - o : (s.priority ?? 999) - (n.priority ?? 999);
    }).forEach((s, n) => {
      s.priority = n + 1;
    });
  }
  /** 结论类型权重（用于排序） */
  verdictWeight(e) {
    switch (e) {
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
  cleanLLMOutput(e) {
    let t = e.trim();
    t.charCodeAt(0) === 65279 && (t = t.slice(1));
    const s = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    return s && (t = s[1].trim()), t = t.replace(/^```(?:json)?\s*/gm, "").replace(/```\s*$/gm, ""), t.trim();
  }
  /**
   * 尝试修复常见 JSON 错误
   * - 末尾多余的逗号
   * - 单引号代替双引号
   * - 缺少引号的键名
   * - 注释
   */
  attemptJSONRepair(e) {
    let t = e;
    t = t.replace(/\/\/.*$/gm, ""), t = t.replace(/\/\*[\s\S]*?\*\//g, ""), t = t.replace(/'/g, '"'), t = t.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":'), t = t.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }
}
const ze = `你是一位A股短线交易决策助手，专注于A股沪深主板/创业板/科创板的短线交易机会识别。

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
function Et(i) {
  const e = [ze];
  return i != null && i.dynamicContext && e.push(`

【当前市场数据上下文】
${i.dynamicContext}`), i != null && i.selectedStocks && e.push(`

【待分析股票池】
${i.selectedStocks}`), e.push(`

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
- riskPoints 不能为空数组（每只票至少1个风险点）`), e.join(`
`);
}
function At(i) {
  const e = [
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
  return i != null && i.dynamicContext && e.push(`

【当前市场数据】
${i.dynamicContext}`), e.join(`
`);
}
function pt(i) {
  return `你是一位A股短线交易决策助手。请分析给定的单只股票。

${i != null && i.dynamicContext ? `

【当前市场数据】
${i.dynamicContext}` : `

【注意】未提供市场环境数据，请仅根据个股数据做技术面和基本面分析。`}

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
function te(i) {
  return i.length === 0 ? "暂无大盘指数数据" : i.map((e) => `${e.changePercent >= 0 ? "📈" : "📉"} ${e.name}(${e.code}): ${e.price}点 ${e.changePercent >= 0 ? "+" : ""}${e.changePercent.toFixed(2)}% | 成交额 ${Fe(e.amount)}`).join(`
`);
}
function se(i) {
  if (i.length === 0) return "暂无板块数据";
  const e = i.slice(0, 5), t = e.map((s, n) => (s.changePercent >= 0, `  ${n + 1}. ${s.name}(${s.code}) ${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}% | 领涨:${s.leadingStock}(${s.leadingChange >= 0 ? "+" : ""}${s.leadingChange.toFixed(2)}%) | 涨${s.upCount}/跌${s.downCount} | 资金流:${Mt(s.capitalFlow)}`));
  return `【板块表现 Top ${e.length}】
${t.join(`
`)}`;
}
function Te(i) {
  if (i.length === 0) return "暂无题材数据";
  const e = i.slice(0, 5), t = e.map((s, n) => (s.changePercent >= 0, `  ${n + 1}. ${s.name}(${s.code}) ${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}% | 领涨:${s.leadingStock} | 涨${s.upCount}/跌${s.downCount}`));
  return `【热门题材 Top ${e.length}】
${t.join(`
`)}`;
}
function ke(i) {
  return i.length === 0 ? "暂无个股数据" : i.map((e) => `${e.changePercent >= 0 ? "📈" : "📉"} ${e.name}(${e.code}): ¥${e.price} ${e.changePercent >= 0 ? "+" : ""}${e.changePercent.toFixed(2)}% | 量:${(e.volume / 1e4).toFixed(1)}万手 | 额:${Fe(e.turnover)} | 换手:${e.turnoverRate.toFixed(1)}% | 振幅:${e.amplitude.toFixed(1)}% | 高低:${e.high}/${e.low}`).join(`
`);
}
class Lt {
  /**
   * 组装完整分析 Prompt（四层全量分析）
   *
   * @param data - 当前市场数据
   * @returns messages 数组，可直接传给 DeepSeekClient.chat()
   */
  buildAnalysisPrompt(e) {
    var a;
    const t = [];
    e.indices && e.indices.length > 0 && t.push(te(e.indices)), e.sectors && e.sectors.length > 0 && t.push(se(e.sectors)), e.topics && e.topics.length > 0 && t.push(Te(e.topics)), e.quotes && e.quotes.length > 0 && t.push(`【个股行情】
${ke(e.quotes)}`);
    const s = t.join(`

`), n = e.stocksToAnalyze ? e.stocksToAnalyze.map((u) => `${u.name}(${u.code})`).join("、") : "", r = n ? `请分析以下股票：${n}` : void 0, o = Et({
      dynamicContext: s || void 0,
      selectedStocks: r
    }), c = this.buildUserAnalysisPrompt(
      e.stocksToAnalyze ?? [],
      (a = e.indices) != null && a.length ? "已有市场数据" : "无市场数据"
    );
    return [
      { role: "system", content: o },
      { role: "user", content: c }
    ];
  }
  /**
   * 构建环境诊断 Prompt（仅 L1 层面）
   */
  buildEnvCheckPrompt(e) {
    const t = [];
    e.indices && e.indices.length > 0 && t.push(te(e.indices)), e.sectors && e.sectors.length > 0 && t.push(se(e.sectors)), e.topics && e.topics.length > 0 && t.push(Te(e.topics));
    const s = t.join(`

`);
    return [
      { role: "system", content: At({
        dynamicContext: s || void 0
      }) },
      {
        role: "user",
        content: "请基于以上市场数据分析当前市场环境，输出环境评级、情绪描述和仓位建议。"
      }
    ];
  }
  /**
   * 构建单票快速分析 Prompt
   */
  buildSingleStockPrompt(e) {
    const t = [];
    e.indices && e.indices.length > 0 && t.push(te(e.indices)), e.sectors && e.sectors.length > 0 && t.push(se(e.sectors)), t.push(
      `【目标个股】
${ke([e.quote])}`
    );
    const s = t.join(`

`);
    return [
      { role: "system", content: pt({
        dynamicContext: s
      }) },
      {
        role: "user",
        content: `请详细分析 ${e.quote.name}(${e.quote.code})，输出完整的五维评估和交易结论。`
      }
    ];
  }
  /**
   * 内部：构建 User Prompt（分析指令部分）
   */
  buildUserAnalysisPrompt(e, t) {
    const s = e.map(
      (n, r) => `  ${r + 1}. ${n.name}(${n.code})`
    );
    return e.length === 0 ? "请分析当前市场环境，并给出交易建议。" : [
      `请严格按照四层分析框架，分析以下股票池中的 ${e.length} 只股票：`,
      "",
      s.join(`
`),
      "",
      `市场数据状态: ${t}`,
      "",
      "要求:",
      "- 先分析市场环境 (L1)",
      "- 再判断主线方向 (L2)",
      "- 再逐只个股五维评估 (L3)",
      "- 最后输出四类结论并排序 (L4)"
    ].join(`
`);
  }
  // ─── 工具方法 ──────────────────────────────────────
  /**
   * 组合多段 context 文本
   */
  static joinContext(...e) {
    return e.filter(Boolean).join(`

`);
  }
  /**
   * 从用户输入文本中提取股票代码
   * 支持格式: "600519"、"贵州茅台"、"600519贵州茅台"、"600519,000858"
   */
  static extractStocks(e) {
    const t = /\b\d{6}\b/g, s = e.match(t);
    return s ? [...new Set(s)] : [];
  }
}
function Fe(i) {
  return i >= 1e8 ? `${(i / 1e8).toFixed(1)}亿` : i >= 1e4 ? `${(i / 1e4).toFixed(1)}万` : `${i.toFixed(0)}元`;
}
function Mt(i) {
  const e = Math.abs(i), t = i >= 0 ? "+" : "-";
  return e >= 1e4 ? `${t}${(e / 1e4).toFixed(2)}亿` : `${t}${e.toFixed(0)}万`;
}
const A = {
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
class D extends Error {
  constructor(e, t, s, n = !1) {
    super(e), this.code = t, this.statusCode = s, this.retryable = n, this.name = "LLMError";
  }
}
class U extends D {
  constructor(e, t, s) {
    super(e, "API_ERROR", t, t >= 500), this.body = s, this.name = "APIError";
  }
}
class _e extends D {
  constructor(e) {
    super(
      `请求超时 (${e}ms)`,
      "TIMEOUT",
      void 0,
      !0
      // 超时可重试
    ), this.name = "TimeoutError";
  }
}
class I extends D {
  constructor(e, t) {
    super(e, "STREAM_ERROR", void 0, !1), this.rawLine = t, this.name = "StreamError";
  }
}
class ae extends D {
  constructor(e = "API Key 无效或未配置") {
    super(e, "AUTH_ERROR", 401, !1), this.name = "AuthError";
  }
}
class Tt extends D {
  constructor(e = 6e4) {
    super(
      `API 速率限制，建议等待 ${e}ms`,
      "RATE_LIMIT",
      429,
      !0
    ), this.retryAfterMs = e, this.name = "RateLimitError";
  }
}
function $e(i) {
  const e = i.trim();
  if (!e || e.startsWith(":"))
    return { type: "skip" };
  if (e.startsWith("data: ")) {
    const t = e.slice(6);
    return t === "[DONE]" ? { type: "done" } : { type: "data", value: t };
  }
  if (e.startsWith("data:")) {
    const t = e.slice(5);
    return t === "[DONE]" ? { type: "done" } : { type: "data", value: t };
  }
  return e.startsWith("event: ") ? { type: "event", value: e.slice(7) } : { type: "skip" };
}
function Pe(i) {
  try {
    const e = JSON.parse(i);
    return e && typeof e == "object" && Array.isArray(e.choices) ? e : (h.warn("[Stream] 收到非标准 chunk 结构:", i.slice(0, 200)), null);
  } catch {
    return h.warn("[Stream] JSON 解析失败:", i.slice(0, 200)), null;
  }
}
async function kt(i, e, t) {
  var y, p, M, fe, ge, me, de, ye;
  const { onChunk: s, onDone: n, onError: r } = e;
  let o = "", c = "", a = "", u = 0, l = "stop";
  if (t != null && t.aborted) {
    const v = new I("流已被外部中止");
    throw r == null || r(v), v;
  }
  const g = (y = i.body) == null ? void 0 : y.getReader();
  if (!g) {
    const v = new I("响应体不可读（body 为 null）");
    throw r == null || r(v), v;
  }
  const m = new TextDecoder();
  let d = "";
  try {
    for (; ; ) {
      if (t != null && t.aborted) {
        const F = new I("流已被外部中止");
        throw r == null || r(F), F;
      }
      const { done: k, value: E } = await g.read();
      if (k) break;
      const z = m.decode(E, { stream: !0 });
      d += z;
      const Se = d.split(`
`);
      d = Se.pop() ?? "";
      for (const F of Se) {
        const K = $e(F);
        switch (K.type) {
          case "skip":
            break;
          case "done":
            l = "stop";
            break;
          case "data": {
            const T = Pe(K.value);
            if (!T) break;
            !c && T.id && (c = T.id), !a && T.model && (a = T.model), !u && T.created && (u = T.created);
            const j = (p = T.choices) == null ? void 0 : p[0];
            if (j) {
              const Ce = ((M = j.delta) == null ? void 0 : M.content) ?? "";
              Ce && (o += Ce), j.finish_reason && (l = j.finish_reason);
            }
            s == null || s(T, o);
            break;
          }
          case "event":
            h.debug("[Stream] SSE event:", K.value);
            break;
          case "error":
            h.warn("[Stream] 行解析警告:", K.message);
            break;
        }
      }
    }
    if (d.trim()) {
      const k = $e(d);
      if (k.type === "data") {
        const E = Pe(k.value);
        if (E) {
          const z = ((me = (ge = (fe = E.choices) == null ? void 0 : fe[0]) == null ? void 0 : ge.delta) == null ? void 0 : me.content) ?? "";
          z && (o += z), (ye = (de = E.choices) == null ? void 0 : de[0]) != null && ye.finish_reason && (l = E.choices[0].finish_reason), !c && E.id && (c = E.id), !a && E.model && (a = E.model), !u && E.created && (u = E.created), s == null || s(E, o);
        }
      } else k.type === "done" && (l = "stop");
    }
    const v = {
      fullContent: o,
      id: c,
      model: a,
      created: u,
      finishReason: l
    };
    return n == null || n(v), v;
  } catch (v) {
    if (v instanceof I)
      throw r == null || r(v), v;
    if (v instanceof DOMException && v.name === "AbortError") {
      const E = new I("流读取被中止");
      throw r == null || r(E), E;
    }
    const k = new I(
      v instanceof Error ? v.message : "流读取未知错误"
    );
    throw r == null || r(k), k;
  } finally {
    g.releaseLock();
  }
}
class _t {
  constructor() {
    this.cachedKey = null;
  }
  /**
   * 获取 API Key
   * 优先级: 1) 构造函数传入 2) 硬编码 Key 3) 环境变量 fallback
   */
  async getKey() {
    var e;
    if (this.cachedKey) return this.cachedKey;
    try {
      const t = (e = globalThis == null ? void 0 : globalThis.process) == null ? void 0 : e.env, s = t == null ? void 0 : t.DEEPSEEK_API_KEY;
      if (s && s.trim())
        return this.cachedKey = s.trim(), this.cachedKey;
    } catch {
    }
    throw new ae("API Key 未配置。请在环境变量 DEEPSEEK_API_KEY 中设置，或更新 llm/client.ts 中的 HARDCODED_API_KEY。");
  }
  /** 设置 API Key */
  async setKey(e) {
    const t = e.trim();
    if (!t)
      throw new ae("API Key 不能为空");
    this.cachedKey = t, h.info("[KeyManager] API Key 已更新");
  }
  /** 清除 API Key */
  async clearKey() {
    this.cachedKey = null, h.info("[KeyManager] API Key 已清除");
  }
  /** 检查是否已配置 Key */
  async hasKey() {
    try {
      return (await this.getKey()).length > 0;
    } catch {
      return !1;
    }
  }
}
class Ke {
  constructor(e) {
    this.keyManager = new _t(), this.config = {
      baseUrl: A.BASE_URL,
      model: A.MODEL,
      maxTokens: A.MAX_TOKENS,
      temperature: A.TEMPERATURE,
      timeout: A.TIMEOUT,
      ...e
    };
  }
  // ─── 配置 ──────────────────────────────────────────
  /** 更新客户端配置 */
  setConfig(e) {
    this.config = { ...this.config, ...e };
  }
  /** 获取 KeyManager 引用 */
  getKeyManager() {
    return this.keyManager;
  }
  // ─── 内部工具 ──────────────────────────────────────
  /** 构建请求头 */
  async buildHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey || await this.keyManager.getKey()}`
    };
  }
  /** 构建请求体 */
  buildRequest(e, t) {
    return {
      model: this.config.model ?? A.MODEL,
      messages: e,
      stream: (t == null ? void 0 : t.stream) ?? !1,
      max_tokens: this.config.maxTokens ?? A.MAX_TOKENS,
      temperature: this.config.temperature ?? A.TEMPERATURE
    };
  }
  /** 构建完整 messages（插入 system prompt） */
  buildMessages(e) {
    return [
      { role: "system", content: ze },
      ...e.map((t) => ({ role: t.role, content: t.content }))
    ];
  }
  /** 处理 HTTP 响应错误 → 抛出类型化错误 */
  async handleResponseError(e) {
    const t = e.status;
    let s = "";
    try {
      s = await e.text();
    } catch {
      s = "(无法读取响应体)";
    }
    if (t === 401)
      throw new ae(
        s.includes("Incorrect API key") ? "API Key 错误，请检查设置" : "API 认证失败"
      );
    if (t === 429) {
      const n = e.headers.get("retry-after-ms") ? parseInt(e.headers.get("retry-after-ms"), 10) : e.headers.get("Retry-After") ? parseInt(e.headers.get("Retry-After"), 10) * 1e3 : void 0;
      throw new Tt(n);
    }
    throw t >= 400 && t < 500 ? new U(
      `请求被拒绝 (${t}): ${s.slice(0, 300)}`,
      t,
      s
    ) : t >= 500 ? new U(
      `DeepSeek 服务端错误 (${t})`,
      t,
      s
    ) : new U(`HTTP ${t}: ${s.slice(0, 200)}`, t, s);
  }
  // ─── 非流式调用 ────────────────────────────────────
  async chat(e, t) {
    const s = (t == null ? void 0 : t.timeout) ?? this.config.timeout ?? A.TIMEOUT, n = this.buildMessages(e), r = this.buildRequest(n, { stream: !1 });
    return h.debug("[DeepSeek] 非流式请求:", {
      model: r.model,
      messages: r.messages.length,
      maxTokens: r.max_tokens
    }), Ne(async () => {
      var l, g, m, d;
      const c = new AbortController(), a = setTimeout(() => c.abort(), s), u = t != null && t.signal ? De(t.signal, c.signal) : c.signal;
      try {
        const y = await this.buildHeaders(), p = await fetch(
          `${this.config.baseUrl ?? A.BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers: y,
            body: JSON.stringify(r),
            signal: u
          }
        );
        p.ok || await this.handleResponseError(p);
        const M = await p.json();
        return h.debug("[DeepSeek] 非流式响应:", {
          id: M.id,
          model: M.model,
          usage: M.usage,
          contentLength: ((d = (m = (g = (l = M.choices) == null ? void 0 : l[0]) == null ? void 0 : g.message) == null ? void 0 : m.content) == null ? void 0 : d.length) ?? 0
        }), M;
      } catch (y) {
        throw y instanceof D ? y : y instanceof DOMException && y.name === "AbortError" ? new _e(s) : new U(
          y instanceof Error ? y.message : "未知请求错误",
          0
        );
      } finally {
        clearTimeout(a);
      }
    }, {
      maxRetries: (t == null ? void 0 : t.retries) ?? A.MAX_RETRIES,
      baseDelay: (t == null ? void 0 : t.retryBaseDelay) ?? A.RETRY_BASE_DELAY,
      maxDelay: (t == null ? void 0 : t.retryMaxDelay) ?? A.RETRY_MAX_DELAY,
      onRetry: (c, a) => {
        h.warn(
          `[DeepSeek] 请求重试 #${a + 1} 原因: ${c.message}`
        );
      }
    });
  }
  async ask(e, t) {
    var n, r, o;
    return ((o = (r = (n = (await this.chat(
      [{ role: "user", content: e }],
      t
    )).choices) == null ? void 0 : n[0]) == null ? void 0 : r.message) == null ? void 0 : o.content) ?? "";
  }
  // ─── 流式调用 ────────────────────────────────────
  async chatStream(e, t, s) {
    const n = (s == null ? void 0 : s.timeout) ?? this.config.timeout ?? A.STREAM_TIMEOUT, r = this.buildMessages(e), o = this.buildRequest(r, { stream: !0 });
    h.debug("[DeepSeek] 流式请求:", {
      model: o.model,
      messages: o.messages.length
    });
    const c = new AbortController(), a = setTimeout(() => c.abort(), n), u = s != null && s.signal ? De(s.signal, c.signal) : c.signal;
    try {
      const l = await this.buildHeaders(), g = await fetch(
        `${this.config.baseUrl ?? A.BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: l,
          body: JSON.stringify(o),
          signal: u
        }
      );
      return g.ok || (clearTimeout(a), await this.handleResponseError(g)), await kt(
        g,
        {
          onChunk: (m, d) => {
            var y;
            (y = t == null ? void 0 : t.onChunk) == null || y.call(t, m, d);
          },
          onDone: (m) => {
            var d;
            h.debug("[DeepSeek] 流完成:", {
              id: m.id,
              model: m.model,
              contentLength: m.fullContent.length,
              finishReason: m.finishReason
            }), (d = t == null ? void 0 : t.onDone) == null || d.call(t, m);
          },
          onError: (m) => {
            var d;
            h.error("[DeepSeek] 流错误:", m.message), (d = t == null ? void 0 : t.onError) == null || d.call(t, m);
          }
        },
        u
      );
    } catch (l) {
      throw l instanceof D ? l : l instanceof DOMException && l.name === "AbortError" ? new _e(n) : new U(
        l instanceof Error ? l.message : "流式请求未知错误",
        0
      );
    } finally {
      clearTimeout(a);
    }
  }
  async askStream(e, t, s) {
    return this.chatStream(
      [{ role: "user", content: e }],
      t,
      s
    );
  }
}
function De(...i) {
  const e = new AbortController();
  for (const t of i) {
    if (t.aborted)
      return e.abort(t.reason), e.signal;
    t.addEventListener(
      "abort",
      () => e.abort(t.reason),
      { once: !0 }
    );
  }
  return e.signal;
}
new Ke();
const C = {
  api_key: "sync",
  settings: "sync",
  watchlist: "local",
  history: "local"
}, $ = {
  model: "deepseek-chat",
  temperature: 0.7,
  maxTokens: 4096,
  autoAnalyze: !1,
  maxConcurrent: 3,
  debugMode: !1
}, ne = {
  api_key: "",
  settings: { ...$ },
  watchlist: [],
  history: []
}, re = {
  VERSION: "meta_version",
  INSTALLED_AT: "meta_installed_at",
  LAST_ANALYSIS_AT: "meta_last_analysis_at",
  MIGRATED: "meta_migrated"
};
class Q extends Error {
  constructor(e, t, s) {
    super(e), this.code = t, this.key = s, this.name = "StorageError";
  }
}
class be extends Q {
  constructor(e, t, s) {
    super(
      `存储配额超限: "${e}" 大小 ${t}B 超过限制 ${s}B`,
      "QUOTA_EXCEEDED",
      e
    ), this.name = "QuotaExceededError";
  }
}
class L extends Q {
  constructor(e, t) {
    super(`值校验失败: "${e}" — ${t}`, "VALIDATION", e), this.name = "ValidationError";
  }
}
class $t {
  // ═══════════════════════════════════════════════
  // 构造 & 初始化
  // ═══════════════════════════════════════════════
  /**
   * 创建 StorageManager 实例
   * 不自动初始化 —— 首次调用任意方法时会自动初始化
   */
  constructor() {
    this.memoryCache = /* @__PURE__ */ new Map(), this.memorySync = /* @__PURE__ */ new Map(), this.memoryLocal = /* @__PURE__ */ new Map(), this.initialized = !1, this.initPromise = null, this.changeListeners = /* @__PURE__ */ new Map(), this.onChangeBound = !1;
  }
  /**
   * 初始化存储
   * - 确保默认值存在于 storage 中（首次安装时写入）
   * - 绑定 chrome.storage.onChanged 监听
   *
   * 幂等，可重复调用
   */
  async init(e) {
    if (!(this.initialized && !(e != null && e.force))) {
      if (this.initPromise) return this.initPromise;
      this.initPromise = this.doInit();
      try {
        await this.initPromise;
      } finally {
        this.initPromise = null;
      }
    }
  }
  async doInit() {
    this.onChangeBound || this.bindOnChange(), await this.ensureDefaults(), await this.warmCache(), this.initialized = !0, h.info("[StorageManager] 初始化完成");
  }
  /** 确保初始化（所有公开方法先调用此方法） */
  async ensureInit() {
    this.initialized || await this.init();
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
  async get(e, t) {
    await this.ensureInit();
    const s = this.memoryCache.get(e);
    if (s !== void 0)
      return s;
    const n = t ?? this.resolveArea(e);
    try {
      const c = (await this.getChromeStorage(n).get(e))[e];
      return this.memoryCache.set(e, c), c ?? this.getDefault(e);
    } catch (r) {
      throw this.wrapError(r, "读取失败", e);
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
  async getMany(e) {
    await this.ensureInit();
    const t = {}, s = [], n = [];
    for (const a of e)
      this.resolveArea(a) === "sync" ? s.push(a) : n.push(a);
    const [r, o] = await Promise.all([
      s.length > 0 ? this.getChromeStorage("sync").get(s) : Promise.resolve({}),
      n.length > 0 ? this.getChromeStorage("local").get(n) : Promise.resolve({})
    ]), c = { ...r, ...o };
    for (const a of e) {
      const u = c[a] ?? this.getDefault(a);
      t[a] = u, this.memoryCache.set(a, u);
    }
    return t;
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
  async set(e, t, s) {
    await this.ensureInit(), this.validateValue(e, t);
    const n = s ?? this.resolveArea(e);
    n === "sync" && this.checkSyncQuota(e, t);
    try {
      await this.getChromeStorage(n).set({ [e]: t }), this.memoryCache.set(e, t), h.debug(`[StorageManager] 已写入: ${e} → ${n}`);
    } catch (r) {
      throw r instanceof Error && r.message.includes("QUOTA_BYTES_PER_ITEM") ? new be(e, this.estimateSize(t), 8192) : this.wrapError(r, "写入失败", e);
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
  async setMany(e) {
    await this.ensureInit();
    const t = {}, s = {};
    for (const [n, r] of Object.entries(e))
      this.validateValue(n, r), this.resolveArea(n) === "sync" ? (this.checkSyncQuota(n, r), t[n] = r) : s[n] = r, this.memoryCache.set(n, r);
    await Promise.all([
      Object.keys(t).length > 0 ? this.getChromeStorage("sync").set(t) : Promise.resolve(),
      Object.keys(s).length > 0 ? this.getChromeStorage("local").set(s) : Promise.resolve()
    ]), h.debug(`[StorageManager] 批量写入完成: sync=${Object.keys(t).length}, local=${Object.keys(s).length}`);
  }
  /**
   * 删除指定键
   *
   * @param key  - 要删除的键
   * @param area - 可选，显式指定存储区域
   */
  async remove(e, t) {
    await this.ensureInit();
    const s = t ?? this.resolveArea(e);
    try {
      await this.getChromeStorage(s).remove(e), this.memoryCache.delete(e), h.debug(`[StorageManager] 已删除: ${e}`);
    } catch (n) {
      throw this.wrapError(n, "删除失败", e);
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
    const e = Object.keys(C).filter(
      (n) => C[n] === "sync"
    ), t = [
      ...Object.keys(C).filter((n) => C[n] === "local"),
      ...this.collectCacheKeys(),
      ...this.collectMetaKeys()
    ];
    await Promise.all([
      this.getChromeStorage("sync").remove(e),
      this.getChromeStorage("local").remove(t)
    ]), this.memoryCache.clear(), this.initialized = !1;
    const s = [...e, ...t];
    return h.info(`[StorageManager] 存储已清空: ${s.length} 个键`), s;
  }
  /**
   * 检查键是否存在
   */
  async has(e) {
    if (await this.ensureInit(), this.memoryCache.has(e))
      return this.memoryCache.get(e) !== void 0;
    const t = this.resolveArea(e);
    return (await this.getChromeStorage(t).get(e))[e] !== void 0;
  }
  // ═══════════════════════════════════════════════
  // 默认值管理
  // ═══════════════════════════════════════════════
  /**
   * 获取指定键的默认值
   */
  getDefault(e) {
    if (e in ne) {
      const t = ne[e];
      return Dt(t);
    }
    if (e.startsWith("cache_"))
      return null;
    e.startsWith("meta_");
  }
  /**
   * 重置指定键为默认值
   */
  async resetToDefault(e) {
    const t = this.getDefault(e);
    await this.set(e, t), h.info(`[StorageManager] 已重置为默认值: ${e}`);
  }
  /**
   * 重置所有键为默认值
   */
  async resetAll() {
    const e = {};
    for (const t of Object.keys(ne))
      e[t] = this.getDefault(t);
    await this.setMany(e), h.info("[StorageManager] 所有键已重置为默认值");
  }
  /**
   * 获取所有已知键的当前值（含默认值回退）
   */
  async getAll() {
    const e = Object.keys(C);
    return await this.getMany(e);
  }
  /**
   * 获取当前存储使用统计
   */
  async getStorageInfo() {
    const [e, t] = await Promise.all([
      this.getChromeStorage("sync").getBytesInUse(null),
      this.getChromeStorage("local").getBytesInUse(null)
    ]);
    return {
      sync: {
        keys: Object.keys(C).filter((s) => C[s] === "sync").length,
        bytes: e
      },
      local: {
        keys: Object.keys(C).filter((s) => C[s] === "local").length,
        bytes: t
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
  async setCache(e, t, s = 3e4) {
    const n = {
      data: t,
      timestamp: Date.now(),
      ttl: s
    }, r = `cache_${e}`;
    await this.set(r, n, "local");
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
  async getCache(e) {
    const t = `cache_${e}`, s = await this.get(t, "local");
    return s ? Date.now() - s.timestamp > s.ttl ? (await this.remove(t, "local").catch(() => {
    }), null) : s.data : null;
  }
  /**
   * 删除指定缓存
   */
  async removeCache(e) {
    const t = `cache_${e}`;
    await this.remove(t, "local");
  }
  /**
   * 清除所有过期缓存
   *
   * @returns 被清除的缓存数量
   */
  async clearExpiredCache() {
    const e = this.collectCacheKeys();
    let t = 0;
    for (const s of e)
      try {
        const n = s, r = await this.get(n, "local");
        r && Date.now() - r.timestamp > r.ttl && (await this.remove(n, "local"), t++);
      } catch {
      }
    return t > 0 && h.info(`[StorageManager] 已清除 ${t} 条过期缓存`), t;
  }
  /**
   * 清除所有缓存（无论是否过期）
   *
   * @returns 被清除的缓存数量
   */
  async clearAllCache() {
    const e = this.collectCacheKeys();
    if (e.length > 0) {
      await this.getChromeStorage("local").remove(e);
      for (const t of e)
        this.memoryCache.delete(t);
    }
    return h.info(`[StorageManager] 已清除全部缓存: ${e.length} 条`), e.length;
  }
  /**
   * 获取缓存统计信息
   */
  async getCacheStats() {
    const e = this.collectCacheKeys();
    let t = 0, s = 0;
    for (const n of e)
      try {
        const r = n, o = await this.get(r, "local");
        o && (Date.now() - o.timestamp > o.ttl ? t++ : s++);
      } catch {
      }
    return { total: e.length, expired: t, valid: s };
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
  async addHistory(e, t) {
    const s = {
      id: Pt(),
      createdAt: Date.now(),
      note: t == null ? void 0 : t.note,
      tags: t == null ? void 0 : t.tags,
      result: e
    }, n = await this.get("history");
    n.push(s);
    const r = 500, o = n.length > r ? n.slice(n.length - r) : n;
    return await this.set("history", o), await this.setMeta("last_analysis_at", Date.now()), h.debug(`[StorageManager] 已添加分析记录: ${s.id}`), s.id;
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
  async getHistory(e) {
    let s = await this.get("history");
    (e == null ? void 0 : e.from) !== void 0 && (s = s.filter((o) => o.createdAt >= e.from)), (e == null ? void 0 : e.to) !== void 0 && (s = s.filter((o) => o.createdAt <= e.to)), e != null && e.verdict && (s = s.filter(
      (o) => o.result.conclusions.some((c) => c.verdict === e.verdict)
    )), s.sort((o, c) => c.createdAt - o.createdAt);
    const n = (e == null ? void 0 : e.offset) ?? 0, r = (e == null ? void 0 : e.limit) ?? s.length;
    return s.slice(n, n + r);
  }
  /**
   * 删除单条历史记录
   *
   * @param recordId - 记录 ID
   * @returns 是否找到并删除
   */
  async removeHistory(e) {
    const t = await this.get("history"), s = t.findIndex((n) => n.id === e);
    return s === -1 ? !1 : (t.splice(s, 1), await this.set("history", t), h.debug(`[StorageManager] 已删除分析记录: ${e}`), !0);
  }
  /**
   * 清空所有历史记录
   */
  async clearHistory() {
    await this.set("history", []), h.info("[StorageManager] 分析历史已清空");
  }
  /**
   * 获取历史记录统计
   */
  async getHistoryStats() {
    const e = await this.get("history"), t = {}, s = Date.now() - 7 * 864e5, n = Date.now() - 30 * 864e5;
    let r = 0, o = 0;
    for (const c of e) {
      for (const a of c.result.conclusions)
        t[a.verdict] = (t[a.verdict] ?? 0) + 1;
      c.createdAt >= s && r++, c.createdAt >= n && o++;
    }
    return {
      total: e.length,
      byVerdict: t,
      lastWeek: r,
      lastMonth: o
    };
  }
  // ═══════════════════════════════════════════════
  // 元数据管理
  // ═══════════════════════════════════════════════
  /**
   * 设置元数据
   */
  async setMeta(e, t) {
    const s = `meta_${e}`;
    await this.set(s, t, "local");
  }
  /**
   * 读取元数据
   */
  async getMeta(e) {
    const t = `meta_${e}`;
    return this.get(t, "local");
  }
  /**
   * 删除元数据
   */
  async removeMeta(e) {
    const t = `meta_${e}`;
    await this.remove(t, "local");
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
  onChange(e, t) {
    this.changeListeners.has(e) || this.changeListeners.set(e, /* @__PURE__ */ new Set());
    const s = this.changeListeners.get(e);
    return s.add(t), () => {
      s.delete(t), s.size === 0 && this.changeListeners.delete(e);
    };
  }
  /**
   * 监听多个键的变更
   *
   * @param keys     - 要监听的键列表
   * @param callback - 变更回调 (changes)
   * @returns 取消监听的函数
   */
  onChangeMany(e, t) {
    const s = e.map(
      (n) => this.onChange(n, (r, o) => {
        t({ [n]: { newValue: r, oldValue: o } });
      })
    );
    return () => s.forEach((n) => n());
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
    if (await this.getMeta("migrated"))
      return h.info("[StorageManager] 数据迁移已执行过，跳过"), { migrated: 0, skipped: 0 };
    let t = 0, s = 0;
    try {
      const n = await this.getChromeStorage("local").get([
        "xvqiu_settings",
        "deepseek_api_key",
        "xvqiu_installed_at",
        "xvqiu_version"
      ]);
      if (n.xvqiu_settings) {
        const r = n.xvqiu_settings, o = {
          model: r.model ?? $.model,
          temperature: r.temperature ?? $.temperature,
          maxTokens: r.maxTokens ?? $.maxTokens,
          autoAnalyze: r.autoAnalyze ?? $.autoAnalyze,
          maxConcurrent: r.maxConcurrent ?? $.maxConcurrent,
          debugMode: r.debugMode ?? $.debugMode
        };
        await this.set("settings", o), t++;
      } else
        s++;
      if (n.deepseek_api_key) {
        const r = n.deepseek_api_key;
        r.trim() ? (await this.set("api_key", r.trim()), t++) : s++;
      } else
        s++;
      n.xvqiu_installed_at ? (await this.setMeta("installed_at", n.xvqiu_installed_at), t++) : s++, n.xvqiu_version ? (await this.setMeta("version", n.xvqiu_version), t++) : s++, await this.getChromeStorage("local").remove([
        "xvqiu_settings",
        "deepseek_api_key",
        "xvqiu_installed_at",
        "xvqiu_version"
      ]), await this.setMeta("migrated", !0), h.info(`[StorageManager] 数据迁移完成: 迁移 ${t} 项，跳过 ${s} 项`);
    } catch (n) {
      throw h.error("[StorageManager] 数据迁移失败:", n), n;
    }
    return { migrated: t, skipped: s };
  }
  // ═══════════════════════════════════════════════
  // 内部工具
  // ═══════════════════════════════════════════════
  /**
   * 获取存储对象
   * Chrome 环境 → chrome.storage
   * Electron/其他环境 → 内存回退
   */
  getChromeStorage(e) {
    return typeof chrome < "u" && chrome.storage ? e === "sync" ? chrome.storage.sync : chrome.storage.local : this.getMemoryFallback(e);
  }
  /**
   * 创建内存回退 StorageArea（用于 Electron 环境）
   */
  getMemoryFallback(e) {
    const t = e === "sync" ? this.memorySync : this.memoryLocal;
    return {
      get: async (s) => {
        if (s === null) {
          const r = {};
          return t.forEach((o, c) => {
            r[c] = o;
          }), r;
        }
        if (typeof s == "string")
          return { [s]: t.get(s) };
        if (Array.isArray(s)) {
          const r = {};
          for (const o of s) r[o] = t.get(o);
          return r;
        }
        const n = {};
        for (const [r, o] of Object.entries(s))
          n[r] = t.has(r) ? t.get(r) : o;
        return n;
      },
      set: async (s) => {
        for (const [n, r] of Object.entries(s))
          t.set(n, r);
      },
      remove: async (s) => {
        const n = Array.isArray(s) ? s : [s];
        for (const r of n) t.delete(r);
      },
      clear: async () => t.clear(),
      getBytesInUse: async () => 0,
      onChanged: {
        addListener: () => {
        },
        removeListener: () => {
        },
        hasListener: () => !1
      }
    };
  }
  /**
   * 解析键名对应的存储区域
   */
  resolveArea(e) {
    return e in C ? C[e] : (e.startsWith("cache_") || e.startsWith("meta_"), "local");
  }
  /**
   * 写入默认值（首次安装时）
   */
  async ensureDefaults() {
    const e = Object.keys(C), t = e.filter((l) => C[l] === "sync"), s = e.filter((l) => C[l] === "local"), [n, r] = await Promise.all([
      t.length > 0 ? this.getChromeStorage("sync").get(t) : Promise.resolve({}),
      s.length > 0 ? this.getChromeStorage("local").get(s) : Promise.resolve({})
    ]), o = { ...n, ...r }, c = {};
    for (const l of e) {
      const g = l;
      o[l] === void 0 && (c[l] = this.getDefault(g));
    }
    if (Object.keys(c).length === 0) {
      h.debug("[StorageManager] 所有默认值已存在");
      return;
    }
    const a = {}, u = {};
    for (const [l, g] of Object.entries(c))
      this.resolveArea(l) === "sync" ? a[l] = g : u[l] = g;
    await Promise.all([
      Object.keys(a).length > 0 ? this.getChromeStorage("sync").set(a) : Promise.resolve(),
      Object.keys(u).length > 0 ? this.getChromeStorage("local").set(u) : Promise.resolve()
    ]), await Promise.all([
      this.getChromeStorage("local").set({
        [re.VERSION]: "1.0.0",
        [re.INSTALLED_AT]: Date.now()
      })
    ]), h.info(`[StorageManager] 默认值已写入: ${Object.keys(c).length} 项`);
  }
  /**
   * 预热内存缓存 — 从 Chrome Storage 读取所有已知键
   */
  async warmCache() {
    const e = Object.keys(C), t = e.filter((c) => C[c] === "sync"), s = e.filter((c) => C[c] === "local"), [n, r] = await Promise.all([
      t.length > 0 ? this.getChromeStorage("sync").get(t) : Promise.resolve({}),
      s.length > 0 ? this.getChromeStorage("local").get(s) : Promise.resolve({})
    ]), o = { ...n, ...r };
    for (const c of e)
      this.memoryCache.set(c, o[c] ?? this.getDefault(c));
    h.debug(`[StorageManager] 内存缓存已预热: ${e.length} 个键`);
  }
  /**
   * 收集所有缓存键
   */
  collectCacheKeys() {
    const e = [];
    for (const t of this.memoryCache.keys())
      t.startsWith("cache_") && e.push(t);
    return e;
  }
  /**
   * 收集所有元数据键
   */
  collectMetaKeys() {
    const e = [];
    for (const t of this.memoryCache.keys())
      t.startsWith("meta_") && e.push(t);
    for (const t of Object.values(re))
      e.includes(t) || e.push(t);
    return e;
  }
  /**
   * 绑定 chrome.storage.onChanged 监听
   */
  bindOnChange() {
    var e;
    if (typeof chrome > "u" || !((e = chrome.storage) != null && e.onChanged)) {
      h.warn("[StorageManager] chrome.storage.onChanged 不可用");
      return;
    }
    chrome.storage.onChanged.addListener(
      (t, s) => {
        for (const [n, { oldValue: r, newValue: o }] of Object.entries(t)) {
          if (!this.isManagedKey(n)) continue;
          this.memoryCache.set(n, o);
          const c = this.changeListeners.get(n);
          if (c && c.size > 0)
            for (const a of c)
              try {
                a(o, r);
              } catch (u) {
                h.error(`[StorageManager] 变更监听回调出错 (${n}):`, u);
              }
        }
      }
    ), this.onChangeBound = !0, h.debug("[StorageManager] onChanged 监听已绑定");
  }
  /**
   * 判断键是否由 StorageManager 管理
   */
  isManagedKey(e) {
    return e in C || e.startsWith("cache_") || e.startsWith("meta_");
  }
  /**
   * 校验值的合法性
   *
   * @throws {ValidationError} 校验不通过
   */
  validateValue(e, t) {
    if (t != null)
      switch (e) {
        case "api_key": {
          if (typeof t != "string")
            throw new L(e, "API Key 必须是字符串");
          if (t.length > 2048)
            throw new L(e, "API Key 长度超过 2048 字符");
          break;
        }
        case "settings": {
          if (typeof t != "object" || t === null)
            throw new L(e, "设置必须是对象");
          const s = t;
          if (typeof s.model != "string")
            throw new L(e, "model 必须是字符串");
          if (typeof s.temperature != "number" || s.temperature < 0 || s.temperature > 2)
            throw new L(e, "temperature 必须在 0-2 范围内");
          if (typeof s.maxTokens != "number" || s.maxTokens < 1 || s.maxTokens > 128e3)
            throw new L(e, "maxTokens 必须在 1-128000 范围内");
          break;
        }
        case "watchlist": {
          if (!Array.isArray(t))
            throw new L(e, "自选股必须是数组");
          if (t.length > 200)
            throw new L(e, "自选股数量超过 200 上限");
          for (const s of t)
            if (typeof s != "string")
              throw new L(e, "自选股元素必须是字符串");
          break;
        }
        case "history": {
          if (!Array.isArray(t))
            throw new L(e, "历史记录必须是数组");
          break;
        }
        default: {
          if (e.startsWith("cache_") && (typeof t != "object" || t === null))
            throw new L(e, "缓存值必须是对象（CacheEntry）");
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
  checkSyncQuota(e, t) {
    const s = this.estimateSize(t);
    if (s > 8192)
      throw new be(e, s, 8192);
  }
  /**
   * 估算值的 JSON 序列化大小（字节）
   */
  estimateSize(e) {
    try {
      const t = JSON.stringify(e);
      return new TextEncoder().encode(t).length;
    } catch {
      return 0;
    }
  }
  /**
   * 将错误包装为 StorageError
   */
  wrapError(e, t, s) {
    if (e instanceof Q) return e;
    const n = e instanceof Error ? e.message : String(e);
    return new Q(
      `${t}: ${n}`,
      "UNKNOWN",
      s
    );
  }
}
function Pt() {
  const i = "0123456789abcdef";
  return [8, 4, 4, 4, 12].map((t) => {
    let s = "";
    for (let n = 0; n < t; n++)
      s += i[Math.floor(Math.random() * 16)];
    return s;
  }).join("-");
}
function Dt(i) {
  return i == null ? i : JSON.parse(JSON.stringify(i));
}
const bt = new $t(), x = {
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
}, Ie = {
  [x.QUOTE]: { t1: 1e4, t2: 3e4 },
  [x.MARKET_INDEX]: { t1: 15e3, t2: 45e3 },
  [x.SECTORS]: { t1: 15e3, t2: 6e4 },
  [x.SECTOR_DETAIL]: { t1: 15e3, t2: 6e4 },
  [x.HOT_TOPICS]: { t1: 15e3, t2: 6e4 },
  [x.ANALYSIS]: { t1: 6e4, t2: 3e5 }
}, It = {
  t1DefaultTTL: 1e4,
  t2DefaultTTL: 3e4,
  t1MaxSize: 500,
  enabled: !0
}, xt = 6e4;
class Rt {
  constructor(e, t) {
    this.tier1 = /* @__PURE__ */ new Map(), this.stats = {
      tier1Size: 0,
      tier1Hits: 0,
      tier1Misses: 0,
      tier2Hits: 0,
      tier2Misses: 0,
      sets: 0,
      evictions: 0
    }, this.cleanupTimer = null, this.initialized = !1, this.config = { ...It, ...e }, this.storage = t ?? bt;
  }
  // ─── 初始化 / 销毁 ──────────────────────────────────
  /** 启动定期清理 */
  async init() {
    this.initialized || (typeof setInterval < "u" && (this.cleanupTimer = setInterval(() => {
      this.evictExpired();
    }, xt)), this.initialized = !0, h.debug("[CacheManager] 已初始化"));
  }
  /** 释放资源 */
  destroy() {
    this.cleanupTimer !== null && (clearInterval(this.cleanupTimer), this.cleanupTimer = null), this.tier1.clear(), this.initialized = !1, h.debug("[CacheManager] 已销毁");
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
  async get(e) {
    if (!this.config.enabled) return null;
    const t = this.tier1.get(e);
    if (t) {
      if (Date.now() < t.expiresAt)
        return this.stats.tier1Hits++, t.data;
      this.tier1.delete(e), this.stats.evictions++;
    } else
      this.stats.tier1Misses++;
    try {
      const s = await this.storage.getCache(e);
      if (s !== null) {
        this.stats.tier2Hits++;
        const n = this.getT2TTL(e);
        return this.setT1(e, s, n), s;
      }
    } catch {
      h.warn(`[CacheManager] Tier-2 读取失败: ${e}`);
    }
    return this.stats.tier2Misses++, null;
  }
  /**
   * 写入缓存 (Tier-1 + Tier-2)
   *
   * @param cacheKey 缓存键
   * @param data     数据
   * @param customTTL 可选 — 自定义 TTL { t1?, t2? }
   */
  async set(e, t, s) {
    if (!this.config.enabled) return;
    this.stats.sets++;
    const n = (s == null ? void 0 : s.t1) ?? this.getT1TTL(e);
    this.setT1(e, t, n);
    try {
      const r = (s == null ? void 0 : s.t2) ?? this.getT2TTL(e);
      await this.storage.setCache(e, t, r);
    } catch (r) {
      h.warn(`[CacheManager] Tier-2 写入失败: ${e}`, r);
    }
  }
  /**
   * 删除缓存 (Tier-1 + Tier-2)
   */
  async delete(e) {
    this.tier1.delete(e);
    try {
      await this.storage.removeCache(e);
    } catch {
    }
  }
  /**
   * 判断缓存是否存在且有效
   */
  async has(e) {
    const t = this.tier1.get(e);
    if (t && Date.now() < t.expiresAt)
      return !0;
    try {
      return await this.storage.getCache(e) !== null;
    } catch {
      return !1;
    }
  }
  // ─── 批量操作 ──────────────────────────────────────
  /**
   * 批量读取缓存
   * 返回 Map<cacheKey, T | null>
   */
  async getMany(e) {
    const t = /* @__PURE__ */ new Map(), s = [];
    for (const n of e) {
      const r = this.tier1.get(n);
      r && Date.now() < r.expiresAt ? (t.set(n, r.data), this.stats.tier1Hits++) : (s.push(n), this.stats.tier1Misses++);
    }
    if (s.length === 0) return t;
    for (const n of s)
      try {
        const r = await this.storage.getCache(n);
        if (r !== null) {
          t.set(n, r), this.stats.tier2Hits++;
          const o = this.getT2TTL(n);
          this.setT1(n, r, o);
        } else
          t.set(n, null), this.stats.tier2Misses++;
      } catch {
        t.set(n, null), this.stats.tier2Misses++;
      }
    return t;
  }
  /**
   * 清除所有缓存 (Tier-1 + Tier-2)
   */
  async clear() {
    this.tier1.clear(), this.stats.evictions += this.tier1.size, await this.storage.clearAllCache().catch(() => {
    }), h.info("[CacheManager] 缓存已全部清除");
  }
  /**
   * 清除指定类型的缓存
   *
   * @param type 缓存类型前缀，如 'quote' | 'sectors'
   */
  async clearByType(e) {
    const t = `cache_${e}`;
    for (const s of this.tier1.keys())
      s.startsWith(t) && this.tier1.delete(s);
    h.debug(`[CacheManager] 清除类型缓存: ${e}`);
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
  setConfig(e) {
    this.config = { ...this.config, ...e };
  }
  /** 获取当前配置 */
  getConfig() {
    return { ...this.config };
  }
  // ─── 内部方法 ──────────────────────────────────────
  /** 写入 Tier-1 (内存) */
  setT1(e, t, s) {
    if (this.tier1.size >= this.config.t1MaxSize) {
      const n = this.tier1.keys().next().value;
      n !== void 0 && (this.tier1.delete(n), this.stats.evictions++);
    }
    this.tier1.set(e, {
      data: t,
      expiresAt: Date.now() + s
    });
  }
  /** 惰性淘汰过期条目 */
  evictExpired() {
    const e = Date.now();
    let t = 0;
    for (const [s, n] of this.tier1.entries())
      e >= n.expiresAt && (this.tier1.delete(s), t++);
    t > 0 && (this.stats.evictions += t, h.debug(`[CacheManager] 淘汰 ${t} 条过期缓存`));
  }
  /** 根据缓存键推测 Tier-1 TTL */
  getT1TTL(e) {
    for (const [t, s] of Object.entries(Ie))
      if (e.startsWith(`cache_${t}`) || e.startsWith(t))
        return s.t1;
    return this.config.t1DefaultTTL;
  }
  /** 根据缓存键推测 Tier-2 TTL */
  getT2TTL(e) {
    for (const [t, s] of Object.entries(Ie))
      if (e.startsWith(`cache_${t}`) || e.startsWith(t))
        return s.t2;
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
  static makeKey(e, ...t) {
    return t.length === 0 ? e : `${e}:${t.join(":")}`;
  }
}
const Ot = new Rt(), Nt = {
  maxConcurrent: 10,
  enableLocalPreAnalysis: !0,
  useCache: !0,
  model: "deepseek-chat",
  temperature: 0.7,
  maxTokens: 4096
};
class je {
  constructor(e, t) {
    this.config = { ...Nt, ...e }, this.marketAnalyzer = (t == null ? void 0 : t.marketAnalyzer) ?? new mt(), this.directionAnalyzer = (t == null ? void 0 : t.directionAnalyzer) ?? new Be(), this.stockAnalyzer = (t == null ? void 0 : t.stockAnalyzer) ?? new St(), this.conclusionEngine = (t == null ? void 0 : t.conclusionEngine) ?? new vt(), this.promptBuilder = (t == null ? void 0 : t.promptBuilder) ?? new Lt(), this.dataSource = (t == null ? void 0 : t.dataSource) ?? new He(), this.llmClient = (t == null ? void 0 : t.llmClient) ?? new Ke(), this.cache = (t == null ? void 0 : t.cache) ?? Ot;
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
  async analyzePool(e) {
    const { stocks: t, forceRefresh: s, streamCallbacks: n, signal: r } = e;
    if (!t || t.length === 0)
      throw new Error("股票列表为空");
    if (t.length > 50)
      throw new Error("单次分析最多支持 50 只股票");
    h.info(`[Engine] 开始分析股票池: ${t.length} 只`, t);
    const o = await this.fetchMarketData(s);
    r == null || r.throwIfAborted();
    const c = await this.runL1(o.indices, o.sectors);
    r == null || r.throwIfAborted();
    const a = await this.runL2(o.sectors, o.topics);
    r == null || r.throwIfAborted();
    const u = await this.runL3(
      t,
      o.indices,
      o.sectors
    );
    r == null || r.throwIfAborted();
    const l = await this.callLLM(
      {
        indices: o.indices,
        sectors: o.sectors,
        topics: o.topics,
        quotes: o.quotes,
        stocksToAnalyze: t.map((m) => ({
          code: m,
          name: this.findStockName(m, o.quotes)
        })),
        envResult: c,
        directions: a,
        stockAnalyses: u
      },
      { streamCallbacks: n, signal: r }
    ), g = await this.runL4(l, {
      envLevel: c.envLevel,
      stockCodes: t
    });
    return h.info("[Engine] 分析完成:", {
      stocks: t.length,
      envLevel: g.marketEnv.envLevel,
      conclusions: g.conclusions.length,
      buyCount: g.conclusions.filter((m) => m.verdict === "BUY").length
    }), g;
  }
  /**
   * 环境诊断（仅 L1）
   *
   * 快速获取市场环境评级，不分析个股
   */
  async envCheck(e) {
    var n;
    h.info("[Engine] 环境诊断");
    const t = await this.fetchMarketData(e == null ? void 0 : e.forceRefresh);
    return (n = e == null ? void 0 : e.signal) == null || n.throwIfAborted(), {
      ...await this.runL1(t.indices, t.sectors),
      indices: t.indices,
      sectors: t.sectors,
      topics: t.topics
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
  async analyzeSingle(e) {
    var d, y, p;
    const { code: t, forceRefresh: s, streamCallbacks: n, signal: r } = e;
    if (!t)
      throw new Error("请提供股票代码");
    h.info(`[Engine] 单票分析: ${t}`);
    const [o, c] = await Promise.all([
      this.fetchMarketData(s),
      this.dataSource.getQuote(t)
    ]);
    r == null || r.throwIfAborted();
    const [a, u] = await Promise.all([
      this.runL1(o.indices, o.sectors),
      this.runL2(o.sectors, o.topics)
    ]);
    r == null || r.throwIfAborted();
    const l = this.promptBuilder.buildSingleStockPrompt({
      quote: c,
      indices: o.indices,
      sectors: o.sectors
    });
    let g;
    n ? g = (await this.llmClient.chatStream(
      l,
      n,
      { signal: r }
    )).fullContent : g = ((p = (y = (d = (await this.llmClient.chat(l, { signal: r })).choices) == null ? void 0 : d[0]) == null ? void 0 : y.message) == null ? void 0 : p.content) ?? "";
    const m = await this.runL4(g, {
      envLevel: a.envLevel,
      stockCodes: [t]
    });
    return h.info(`[Engine] 单票分析完成: ${c.name}(${t})`), m;
  }
  // ═════════════════════════════════════════════════════════════
  // 数据获取
  // ═════════════════════════════════════════════════════════════
  /**
   * 获取所有市场数据（并行）
   */
  async fetchMarketData(e) {
    const t = e ? { useCache: !1 } : { useCache: this.config.useCache }, [s, n, r] = await Promise.all([
      this.dataSource.getMarketIndex(t),
      this.dataSource.getSectors(t),
      this.dataSource.getHotTopics(t)
    ]);
    return {
      indices: s,
      sectors: n,
      topics: r,
      quotes: []
      // 个股行情在 L3 阶段按需获取
    };
  }
  /**
   * 获取个股行情（缓存）
   */
  async fetchQuotes(e, t) {
    const s = t ? { useCache: !1 } : { useCache: this.config.useCache };
    if (e.length <= 50)
      return await this.dataSource.getQuotes(e, s);
    const n = [];
    for (let r = 0; r < e.length; r += 50) {
      const o = e.slice(r, r + 50), c = await this.dataSource.getQuotes(o, s);
      n.push(...c);
    }
    return n;
  }
  // ═════════════════════════════════════════════════════════════
  // 引擎层执行
  // ═════════════════════════════════════════════════════════════
  /** L1: 市场环境 */
  async runL1(e, t) {
    return this.marketAnalyzer.analyze(e, t);
  }
  /** L2: 方向判断 */
  async runL2(e, t) {
    return this.directionAnalyzer.analyze(e, t);
  }
  /** L3: 个股分析 */
  async runL3(e, t, s) {
    const n = await this.fetchQuotes(e);
    if (n.length === 0)
      return h.warn("[Engine] 无法获取个股行情"), [];
    const r = this.config.maxConcurrent, o = [];
    for (let c = 0; c < n.length; c += r) {
      const a = n.slice(c, c + r), u = await this.stockAnalyzer.analyze(a, t, s);
      o.push(...u);
    }
    return o;
  }
  /** L4: 结论解析 */
  async runL4(e, t) {
    return this.conclusionEngine.process(e, t);
  }
  // ═════════════════════════════════════════════════════════════
  // LLM 调用
  // ═════════════════════════════════════════════════════════════
  /**
   * 构建 Prompt 并调用 LLM
   */
  async callLLM(e, t) {
    var o, c, a;
    const s = this.promptBuilder.buildAnalysisPrompt({
      indices: e.indices,
      sectors: e.sectors,
      topics: e.topics,
      quotes: e.quotes,
      stocksToAnalyze: e.stocksToAnalyze
    });
    if (this.config.enableLocalPreAnalysis) {
      const u = this.buildLocalAnalysisContext(
        e.envResult,
        e.directions,
        e.stockAnalyses
      ), l = s[s.length - 1];
      l.role === "user" && (l.content += `

【本地预处理结果（仅供参考）】
${u}

请基于以上信息进行完整四层分析，并输出最终 JSON 结论。`);
    }
    let n;
    const r = t == null ? void 0 : t.signal;
    return t != null && t.streamCallbacks ? n = (await this.llmClient.chatStream(
      s,
      t.streamCallbacks,
      { signal: r }
    )).fullContent : n = ((a = (c = (o = (await this.llmClient.chat(s, {
      signal: r
    })).choices) == null ? void 0 : o[0]) == null ? void 0 : c.message) == null ? void 0 : a.content) ?? "", n;
  }
  /**
   * 构建设本地预处理分析上下文
   * 将 L1/L2/L3 的分析结果转为自然语言，注入 LLM prompt
   */
  buildLocalAnalysisContext(e, t, s) {
    const n = [];
    if (n.push(
      `[L1 市场环境] 评级: ${e.envLevel} | 情绪: ${e.sentiment} | 建议: ${e.suggestion}`
    ), t.length > 0) {
      const r = t.map(
        (o, c) => `  ${c + 1}. 主线: ${o.mainLine} | 次线: ${o.subLine}`
      );
      n.push(`[L2 方向判断]
${r.join(`
`)}`);
    }
    if (s.length > 0) {
      const r = s.map(
        (o) => `  ${o.stock}(${o.code}): 位置=${o.position} | 强度=${o.strength} | 量价=${o.volumeAnalysis}`
      );
      n.push(`[L3 个股技术面]
${r.join(`
`)}`);
    }
    return n.join(`

`);
  }
  // ═════════════════════════════════════════════════════════════
  // 辅助方法
  // ═════════════════════════════════════════════════════════════
  /** 从行情列表中查找股票名称 */
  findStockName(e, t) {
    const s = t.find((n) => n.code === e);
    return (s == null ? void 0 : s.name) ?? e;
  }
  /**
   * 更新引擎配置
   */
  setConfig(e) {
    this.config = { ...this.config, ...e }, this.llmClient.setConfig({
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
new je();
const Ut = "1.0.0", H = new He(), G = new je();
function Ht() {
  w.handle("PING", async () => ({ status: "ok", version: Ut })), w.handle("ENV_CHECK", async () => {
    h.info("[IPC] 环境诊断请求");
    const i = await G.envCheck(), t = await new Be().analyze(i.sectors, i.topics);
    return h.info(`[IPC] 环境诊断完成: 级别 ${i.envLevel}`), {
      envLevel: i.envLevel,
      sentiment: i.sentiment,
      suggestion: i.suggestion,
      indices: i.indices,
      sectors: i.sectors,
      topics: i.topics,
      directions: t
    };
  }), w.handle("ANALYZE_POOL", async (i, e) => {
    const t = (e == null ? void 0 : e.stocks) ?? [];
    if (h.info(`[IPC] 股票池分析请求: ${t.length} 只股票`), t.length === 0)
      throw new Error("股票列表为空，请提供待分析的股票代码");
    if (t.length > 50)
      throw new Error("单次分析最多支持 50 只股票");
    const s = await G.analyzePool({ stocks: t });
    return h.info(`[IPC] 股票池分析完成: ${s.conclusions.length} 条结论`), s;
  }), w.handle("ANALYZE_SINGLE", async (i, e) => {
    const t = (e == null ? void 0 : e.stock) ?? "未知", s = (e == null ? void 0 : e.code) ?? "";
    if (h.info(`[IPC] 单票分析请求: ${t} (${s || "无代码"})`), !s && !t)
      throw new Error("请提供股票代码或名称");
    return {
      message: "单票分析已实现",
      stock: t,
      code: s
    };
  }), w.handle("GET_QUOTE", async (i, e) => {
    const t = (e == null ? void 0 : e.code) ?? "";
    if (h.info(`[IPC] 行情查询请求: ${t}`), !t)
      throw new Error("请提供股票代码");
    return await H.getQuote(t);
  }), w.handle("GET_MARKET", async () => (h.info("[IPC] 大盘数据请求"), await H.getMarketIndex())), w.handle("GET_SECTOR", async (i, e) => {
    const t = e == null ? void 0 : e.type;
    switch (h.info(`[IPC] 板块数据请求: type=${t}`), t) {
      case "sectors":
        return await H.getSectors();
      case "detail": {
        const s = e == null ? void 0 : e.code;
        if (!s) throw new Error("板块明细查询需要提供 code 参数");
        return await H.getSectorDetail(s);
      }
      case "topics":
        return await H.getHotTopics();
      default:
        throw new Error(`未知的 GET_SECTOR 子命令: ${t}`);
    }
  });
}
async function Bt(i, e) {
  const t = (e == null ? void 0 : e.stocks) ?? [];
  if (h.info(`[IPC-Stream] 流式股票池分析: ${t.length} 只`), t.length === 0) {
    i.webContents.send("stream:event", {
      event: "stream:error",
      data: "股票列表为空"
    });
    return;
  }
  try {
    V(i, "fetching", "正在获取市场数据...", 5);
    const s = await G.analyzePool({
      stocks: t,
      streamCallbacks: {
        onChunk: (n) => {
          var o, c, a;
          const r = ((a = (c = (o = n.choices) == null ? void 0 : o[0]) == null ? void 0 : c.delta) == null ? void 0 : a.content) ?? "";
          r && i.webContents.send("stream:event", {
            event: "stream:chunk",
            data: r
          });
        }
      }
    });
    i.webContents.send("stream:event", {
      event: "stream:env-level",
      data: s.marketEnv
    }), V(i, "l4", "正在生成结论...", 90);
    for (const n of s.conclusions)
      i.webContents.send("stream:event", {
        event: "stream:conclusion",
        data: {
          stockCode: n.stockCode,
          stockName: n.stockName,
          verdict: n.verdict,
          reason: n.reason,
          riskPoints: n.riskPoints,
          priority: n.priority
        }
      });
    V(i, "done", "分析完成", 100), i.webContents.send("stream:event", {
      event: "stream:done",
      data: s
    }), h.info(`[IPC-Stream] 流式分析完成: ${t.length} 只股票`);
  } catch (s) {
    const n = s instanceof Error ? s.message : String(s);
    h.error("[IPC-Stream] 流式分析错误:", n), i.webContents.send("stream:event", {
      event: "stream:error",
      data: n
    });
  }
}
async function zt(i, e) {
  const t = (e == null ? void 0 : e.code) ?? (e == null ? void 0 : e.stock) ?? "";
  if (h.info(`[IPC-Stream] 流式单票分析: ${t}`), !t) {
    i.webContents.send("stream:event", {
      event: "stream:error",
      data: "请提供股票代码"
    });
    return;
  }
  try {
    V(i, "fetching", "正在获取数据...", 10);
    const s = await G.analyzeSingle({
      code: t,
      streamCallbacks: {
        onChunk: (n) => {
          var o, c, a;
          const r = ((a = (c = (o = n.choices) == null ? void 0 : o[0]) == null ? void 0 : c.delta) == null ? void 0 : a.content) ?? "";
          r && i.webContents.send("stream:event", {
            event: "stream:chunk",
            data: r
          });
        }
      }
    });
    i.webContents.send("stream:event", {
      event: "stream:env-level",
      data: s.marketEnv
    });
    for (const n of s.conclusions)
      i.webContents.send("stream:event", {
        event: "stream:conclusion",
        data: {
          stockCode: n.stockCode,
          stockName: n.stockName,
          verdict: n.verdict,
          reason: n.reason,
          riskPoints: n.riskPoints,
          priority: n.priority
        }
      });
    i.webContents.send("stream:event", {
      event: "stream:done",
      data: s
    }), h.info(`[IPC-Stream] 流式单票分析完成: ${t}`);
  } catch (s) {
    const n = s instanceof Error ? s.message : String(s);
    h.error("[IPC-Stream] 流式分析错误:", n), i.webContents.send("stream:event", {
      event: "stream:error",
      data: n
    });
  }
}
function V(i, e, t, s) {
  const n = { stage: e, message: t, percent: s };
  i.webContents.send("stream:event", {
    event: "stream:progress",
    data: n
  });
}
function Ft() {
  w.on("stream:start", (i, e) => {
    const t = ce.fromWebContents(i.sender);
    if (!t) return;
    const { type: s, payload: n } = e;
    switch (s) {
      case "ANALYZE_POOL_STREAM":
        Bt(t, n);
        break;
      case "ANALYZE_SINGLE_STREAM":
        zt(t, n);
        break;
      default:
        t.webContents.send("stream:event", {
          event: "stream:error",
          data: `未知流式类型: ${s}`
        });
    }
  });
}
const Kt = {
  model: "deepseek-chat",
  temperature: 0.7,
  maxTokens: 4096,
  autoAnalyze: !1,
  maxConcurrent: 3,
  debugMode: !1
}, B = {
  api_key: "",
  settings: { ...Kt },
  watchlist: [],
  history: [],
  meta: {
    installed_at: Date.now(),
    version: "1.0.0"
  },
  cache: {}
};
class jt {
  constructor() {
    this.dirty = !1, this.saveTimer = null;
    const e = P.getPath("userData");
    this.filePath = R.join(e, "xvqiu-data.json"), this.data = this.load();
  }
  // ─── 文件读写 ──────────────────────────────────
  load() {
    try {
      if (O.existsSync(this.filePath)) {
        const e = O.readFileSync(this.filePath, "utf-8"), t = JSON.parse(e);
        return { ...B, ...t };
      }
    } catch (e) {
      console.error("[FileStore] 读取失败，使用默认值:", e);
    }
    return { ...B, meta: { ...B.meta } };
  }
  save() {
    try {
      const e = R.dirname(this.filePath);
      O.existsSync(e) || O.mkdirSync(e, { recursive: !0 }), O.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8"), this.dirty = !1;
    } catch (e) {
      console.error("[FileStore] 写入失败:", e);
    }
  }
  scheduleSave() {
    this.dirty = !0, this.saveTimer && clearTimeout(this.saveTimer), this.saveTimer = setTimeout(() => {
      this.dirty && this.save();
    }, 500);
  }
  // ─── 通用读写 ──────────────────────────────────
  get(e) {
    return this.data[e];
  }
  set(e, t) {
    this.data[e] = t, this.scheduleSave();
  }
  remove(e) {
    delete this.data[e], this.scheduleSave();
  }
  has(e) {
    return e in this.data;
  }
  getAll() {
    return { ...this.data };
  }
  resetAll() {
    this.data = { ...B, meta: { ...B.meta } }, this.save();
  }
  // ─── 缓存 ──────────────────────────────────────
  getCache(e) {
    const t = this.data.cache[e];
    return t ? Date.now() - t.timestamp > t.ttl ? (delete this.data.cache[e], this.scheduleSave(), null) : t.data : null;
  }
  setCache(e, t, s = 3e4) {
    this.data.cache[e] = { data: t, timestamp: Date.now(), ttl: s }, this.scheduleSave();
  }
  removeCache(e) {
    delete this.data.cache[e], this.scheduleSave();
  }
  clearCache() {
    this.data.cache = {}, this.scheduleSave();
  }
  // ─── 历史记录 ──────────────────────────────────
  getHistory(e) {
    let t = [...this.data.history];
    (e == null ? void 0 : e.from) !== void 0 && (t = t.filter((r) => r.createdAt >= e.from)), (e == null ? void 0 : e.to) !== void 0 && (t = t.filter((r) => r.createdAt <= e.to)), e != null && e.verdict && (t = t.filter(
      (r) => r.result.conclusions.some((o) => o.verdict === e.verdict)
    )), t.sort((r, o) => o.createdAt - r.createdAt);
    const s = (e == null ? void 0 : e.offset) ?? 0, n = (e == null ? void 0 : e.limit) ?? t.length;
    return t.slice(s, s + n);
  }
  addHistory(e, t, s) {
    const n = this.generateId(), r = {
      id: n,
      createdAt: Date.now(),
      note: t,
      tags: s,
      result: e
    };
    return this.data.history.push(r), this.data.history.length > 500 && (this.data.history = this.data.history.slice(-500)), this.scheduleSave(), n;
  }
  removeHistory(e) {
    const t = this.data.history.findIndex((s) => s.id === e);
    return t === -1 ? !1 : (this.data.history.splice(t, 1), this.scheduleSave(), !0);
  }
  clearHistory() {
    this.data.history = [], this.scheduleSave();
  }
  // ─── 元数据 ──────────────────────────────────
  setMeta(e, t) {
    this.data.meta[e] = t, this.scheduleSave();
  }
  getMeta(e) {
    return this.data.meta[e];
  }
  removeMeta(e) {
    delete this.data.meta[e], this.scheduleSave();
  }
  // ─── 工具 ────────────────────────────────────
  generateId() {
    const e = "0123456789abcdef";
    return [8, 4, 4, 4, 12].map((s) => {
      let n = "";
      for (let r = 0; r < s; r++)
        n += e[Math.floor(Math.random() * 16)];
      return n;
    }).join("-");
  }
  close() {
    this.saveTimer && clearTimeout(this.saveTimer), this.dirty && this.save();
  }
}
let ie = null;
function le() {
  return ie || (ie = new jt()), ie;
}
function ue(i, ...e) {
  console.log(`[Main] ${i}`, ...e);
}
const Wt = Ye(import.meta.url), oe = R.dirname(Wt), xe = !P.isPackaged, We = "xvqiu - A股短线交易决策助手";
let _ = null;
function Re() {
  _ = new ce({
    title: We,
    icon: R.join(oe, "../icons/icon-128.png"),
    width: 420,
    height: 720,
    minWidth: 360,
    minHeight: 500,
    resizable: !0,
    frame: !0,
    titleBarStyle: "default",
    webPreferences: {
      preload: R.join(oe, "preload.js"),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !1
    }
  }), xe ? (_.loadURL("http://localhost:5173/"), _.webContents.openDevTools({ mode: "detach" })) : _.loadFile(R.join(oe, "../dist/index.html")), _.on("closed", () => {
    _ = null;
  }), _.webContents.setWindowOpenHandler(({ url: i }) => i.startsWith("https://platform.deepseek.com") ? { action: "allow" } : { action: "deny" }), ue(`窗口已创建 (${xe ? "开发" : "生产"}模式)`);
}
function Yt() {
  const i = le();
  w.handle("store:get", (e, t) => i.get(t)), w.handle("store:set", (e, t, s) => {
    i.set(t, s);
  }), w.handle("store:remove", (e, t) => {
    i.remove(t);
  }), w.handle("store:getWatchlist", () => i.get("watchlist") ?? []), w.handle("store:setWatchlist", (e, t) => {
    i.set("watchlist", t);
  }), w.handle("store:getHistory", (e, t) => i.getHistory(t)), w.handle("store:addHistory", (e, t, s, n) => i.addHistory(t, s, n)), w.handle("store:removeHistory", (e, t) => i.removeHistory(t)), w.handle("store:clearHistory", () => {
    i.clearHistory();
  }), ue("Storage IPC handlers 已注册");
}
P.whenReady().then(() => {
  ue(`${We} 启动中...`), Ht(), Ft(), Yt(), Re(), P.on("activate", () => {
    ce.getAllWindows().length === 0 && Re();
  });
});
P.on("window-all-closed", () => {
  process.platform !== "darwin" && (le().close(), P.quit());
});
P.on("before-quit", () => {
  le().close();
});
