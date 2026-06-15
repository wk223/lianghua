/**
 * 财联社 (cls.cn) 数据适配器
 * 获取实时电报/快讯、公告、热门题材数据
 *
 * @module data/cls
 *
 * 设计说明:
 * - 封装 cls.cn sw API 调用 (POST JSON → 统一响应格式)
 * - 提供 getFlashes / getAnnouncements / getHotTopics / getSentiment 四种接口
 * - 内部完成字段重命名、HTML 清洗、类型转换
 * - 复用 DataFetcher 的速率限制 + 缓存 + 重试 (文本请求通道)
 * - 所有请求通过 Vite proxy 转发 (解决浏览器 CORS 限制)
 *
 * API 参考:
 *   统一入口: POST /api/cls/api/sw?app=CailianpressWeb&os=web&sv=8.4.6
 *   body: { type: "telegram" | "announcement" | "hot_topic" | ... }
 *
 * 响应格式:
 *   {
 *     "code": 0,
 *     "data": { ... },    // 各 type 结构不同
 *     "message": "success"
 *   }
 */

import { withRetry } from '../utils/retry';
import { DataFetcher } from './fetcher';
import { logger } from '../utils/logger';

import type {
  ClsApiEnvelope,
  ClsRollData,
  ClsFlashRawItem,
  ClsTopicData,
  ClsTopicRawItem,
  ClsAnnouncementData,
  ClsAnnouncementRawItem,
  ClsApiType,
  FetchOptions,
} from './types';
import type {
  FlashNews,
  Announcement,
  ClsTopic,
  SentimentData,
  SentimentLabel,
} from '../utils/types';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/**
 * 财联社 API 基础 URL
 *
 * 开发环境: 通过 Vite proxy 转发 (/api/cls → https://www.cls.cn)
 * 生产环境: 需配置反向代理
 */
const API_BASE = '/api/cls/api/sw';

/** 财联社 API 公共查询参数 */
const API_PARAMS: Record<string, string> = {
  app: 'CailianpressWeb',
  os: 'web',
  sv: '8.4.6',
};

/** 快讯缓存 TTL (ms) — 快讯实时性要求高，缓存较短 */
const FLASH_TTL = 8_000;

/** 公告缓存 TTL — 公告变化不频繁 */
const ANNOUNCEMENT_TTL = 60_000;

/** 热门题材缓存 TTL */
const TOPIC_TTL = 30_000;

/** 单次请求最大条数 */
const PAGE_SIZE = 50;

/**
 * 政策利好信号关键词 (用于情绪分析)
 * 匹配快讯内容判断市场情绪倾向
 */
const POLICY_KEYWORDS: readonly string[] = [
  '降准', '降息', '放水', '宽松', '刺激', '利好', '支持',
  '印花税', '减税', '降费', '改革', '开放', '做多',
  '做市', '增持', '回购', '分红', '央企', '国企改革',
  '新质生产力', '数字经济', '人工智能', '国产替代',
  '消费补贴', '以旧换新', '设备更新', '一带一路',
  '乡村振兴', '新能源', '碳中和', '专精特新',
  '活跃资本市场', '中长期资金', '耐心资本',
];

/**
 * 风险/利空信号关键词
 */
const RISK_KEYWORDS: readonly string[] = [
  '加息', '缩表', '收紧', '利空', '风险', '下跌', '崩盘',
  '退市', '警示', '立案', '调查', '处罚',
  '减持', '解禁', '配股', '爆仓', '违约', '熔断',
  '暂停', '终止', '中止', '整改', '问责',
  '制裁', '脱钩', '断供', '贸易战', '关税',
  '疫情', '灾难', '战争', '地缘', '冲突',
  '不及预期', '下调', '评级下调', '负面',
];

/** 情绪分析中应过滤的常见词 */
const STOP_WORDS = new Set<string>([
  '但是', '因为', '所以', '如果', '虽然', '而且', '然后',
  '以及', '或者', '不过', '可以', '没有', '什么', '一个',
  '这个', '那个', '这些', '那些', '已经', '之后', '进行',
  '公司', '公告', '市场', '表示', '相关', '完成', '今日',
  '昨日', '明天', '今天', '目前', '同时', '其中', '此外',
]);

// ═══════════════════════════════════════════════════════════════
// ClsAdapter
// ═══════════════════════════════════════════════════════════════

export class ClsAdapter {
  private fetcher: DataFetcher;

  /** 内置缓存 (Map), 因 DataFetcher 缓存仅对 GET 请求生效 */
  private localCache = new Map<string, { data: string; expiresAt: number }>();

  /**
   * @param fetcher 可注入自定义 DataFetcher（便于测试 / 共享限制器）
   */
  constructor(fetcher?: DataFetcher) {
    this.fetcher = fetcher ?? new DataFetcher();
  }

  // ─── 公开接口 ──────────────────────────────────────────

  /**
   * 获取实时电报/快讯列表
   *
   * 财联社最核心的功能。返回当前最新的一组快讯，
   * 包括标题、正文、时间、关联股票等信息。
   *
   * @param category 分类筛选，如 "all" / "政策" / "市场" / "行业"
   * @param limit    返回条数上限（默认 20，最大 50）
   * @param options  可选覆写请求配置
   * @returns FlashNews[] 按时间倒序排列
   */
  async getFlashes(
    category: string = 'all',
    limit: number = 20,
    options?: FetchOptions,
  ): Promise<FlashNews[]> {
    const effectiveLimit = Math.min(limit, PAGE_SIZE);
    const rawItems = await this.postApi<ClsRollData>(
      'telegram',
      { category, limit: effectiveLimit },
      { useCache: true, ttl: FLASH_TTL, ...options },
    );

    if (!rawItems) return [];

    return (rawItems.roll_data ?? []).map((item) => this.parseFlash(item));
  }

  /**
   * 获取公告列表
   *
   * @param stockCode 按股票代码筛选（可选）
   * @param limit     返回条数上限（默认 10）
   * @param options   可选覆写请求配置
   * @returns Announcement[]
   */
  async getAnnouncements(
    stockCode?: string,
    limit: number = 10,
    options?: FetchOptions,
  ): Promise<Announcement[]> {
    const body: Record<string, unknown> = {
      type: 'announcement' as ClsApiType,
      limit: Math.min(limit, PAGE_SIZE),
    };
    if (stockCode) {
      body.stock_code = stockCode;
    }

    const rawData = await this.postApi<ClsAnnouncementData>(
      'announcement',
      body,
      { useCache: true, ttl: ANNOUNCEMENT_TTL, ...options },
    );

    if (!rawData) return [];

    return (rawData.list ?? []).map((item) => this.parseAnnouncement(item));
  }

  /**
   * 获取热门题材/概念列表
   *
   * 财联社聚合的当日热门题材，含热度值、涨幅、领涨股等信息
   *
   * @param options 可选覆写请求配置
   * @returns ClsTopic[]
   */
  async getHotTopics(options?: FetchOptions): Promise<ClsTopic[]> {
    const rawData = await this.postApi<ClsTopicData>(
      'hot_topic',
      { limit: 20 },
      { useCache: true, ttl: TOPIC_TTL, ...options },
    );

    if (!rawData) return [];

    return (rawData.list ?? []).map((item) => this.parseTopic(item));
  }

  /**
   * 获取舆情情绪分析
   *
   * 基于最近快讯内容，通过关键词匹配分析市场情绪：
   * - 提取政策利好/利空信号
   * - 计算综合情绪分数 (-100 ~ 100)
   * - 识别热点话题
   *
   * @param options 可选覆写请求配置
   * @returns SentimentData
   */
  async getSentiment(options?: FetchOptions): Promise<SentimentData> {
    const flashes = await this.getFlashes('all', 50, options);

    if (flashes.length === 0) {
      return {
        score: 0,
        label: '中性',
        hotTopics: [],
        policyCues: [],
        riskCues: [],
        flashCount: 0,
        importantCount: 0,
        analyzedAt: Date.now(),
      };
    }

    return this.analyzeSentiment(flashes);
  }

  /**
   * 获取原始快讯数据（原始 snake_case 格式）
   * 用于需要原始字段的场景（如高级分析）
   */
  async getRawFlashes(
    category: string = 'all',
    limit: number = 20,
    options?: FetchOptions,
  ): Promise<ClsFlashRawItem[]> {
    const effectiveLimit = Math.min(limit, PAGE_SIZE);
    const rawData = await this.postApi<ClsRollData>(
      'telegram',
      { category, limit: effectiveLimit },
      { useCache: true, ttl: FLASH_TTL, ...options },
    );

    return rawData?.roll_data ?? [];
  }

  /**
   * 获取底层 DataFetcher 实例
   */
  getFetcher(): DataFetcher {
    return this.fetcher;
  }

  // ─── 统一 API 调用 ──────────────────────────────────

  /**
   * POST 方式调用财联社 sw API
   *
   * 财联社 API 使用 POST JSON body 传参，返回统一格式:
   * { code: 0, data: {...}, message: "success" }
   *
   * @param type  API 请求类型
   * @param extra 额外请求体字段
   * @param opts  请求配置（缓存、超时、重试）
   * @returns 解析后的 data 字段，或 code≠0 时返回 null
   */
  private async postApi<T>(
    type: ClsApiType,
    extra: Record<string, unknown> = {},
    opts: FetchOptions = {},
  ): Promise<T | null> {
    const url = this.buildUrl();
    const body = JSON.stringify({ type, ...extra });
    const {
      useCache = true,
      ttl = FLASH_TTL,
      timeout = 8_000,
      retry = 2,
      headers = {},
    } = opts;

    // ── 缓存检查（基于请求 body 哈希） ──
    const cacheKey = `cls:${type}:${this.simpleHash(JSON.stringify(extra))}`;

    if (useCache) {
      const cached = this.getLocalCache(cacheKey);
      if (cached !== null) {
        try {
          const parsed = JSON.parse(cached) as ClsApiEnvelope<T>;
          if (parsed.code === 0 && parsed.data) return parsed.data;
        } catch {
          // 缓存解析失败，继续请求
        }
      }
    }

    // ── 执行 POST 请求 ──
    try {
      const text = await withRetry(
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);

          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Referer': 'https://www.cls.cn/',
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...headers,
              },
              body,
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(
                `CLS API HTTP ${response.status}: ${response.statusText}`,
              );
            }

            const text = await response.text();
            if (!text || text.trim().length === 0) {
              throw new Error('CLS API 返回空数据');
            }

            return text;
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw new Error(`CLS API 请求超时 (${timeout}ms)`);
            }
            throw err;
          } finally {
            clearTimeout(timer);
          }
        },
        {
          maxRetries: retry,
          baseDelay: 500,
          maxDelay: 3000,
          onRetry: (error, attempt) => {
            logger.warn(
              `[ClsAdapter] 重试 #${attempt + 1}/${retry}: type=${type}`,
              error.message,
            );
          },
        },
      );

      // ── 写入缓存 ──
      if (useCache) {
        this.setLocalCache(cacheKey, text, ttl);
      }

      // ── 解析响应 ──
      const envelope = JSON.parse(text) as ClsApiEnvelope<T>;

      if (envelope.code !== 0) {
        logger.warn(
          `[ClsAdapter] API 返回异常 code=${envelope.code}`,
          envelope.message ?? '',
        );
        return null;
      }

      return envelope.data ?? null;
    } catch (err) {
      logger.error(`[ClsAdapter] ${type} 请求失败:`, (err as Error).message);
      throw err;
    }
  }

  // ─── 解析方法 ──────────────────────────────────────

  /**
   * 解析单条快讯原始数据 → FlashNews 领域模型
   */
  private parseFlash(raw: ClsFlashRawItem): FlashNews {
    return {
      id: raw.id,
      title: raw.title ?? '',
      content: this.cleanHtml(raw.content),
      time: raw.ctime,
      source: raw.source ?? '财联社',
      isImportant: raw.is_important === 1,
      stocks: this.parseStockCodes(raw.stock_codes),
      category: raw.category ?? '其他',
    };
  }

  /**
   * 解析单条公告原始数据 → Announcement 领域模型
   */
  private parseAnnouncement(raw: ClsAnnouncementRawItem): Announcement {
    return {
      id: raw.id,
      title: raw.title,
      summary: raw.summary ?? '',
      stockCode: raw.stock_code,
      stockName: raw.stock_name,
      time: raw.ctime,
      type: raw.type,
      url: raw.url ?? '',
    };
  }

  /**
   * 解析单条题材原始数据 → ClsTopic 领域模型
   */
  private parseTopic(raw: ClsTopicRawItem): ClsTopic {
    return {
      id: raw.id,
      name: raw.name,
      hotValue: raw.hot_value,
      stockCount: raw.stock_count,
      changePercent: raw.change_percent,
      description: raw.desc ?? '',
      leadStock: raw.lead_stock ?? '',
      leadChange: raw.lead_change ?? 0,
    };
  }

  // ─── 情绪分析 ──────────────────────────────────────

  /**
   * 基于快讯内容分析市场情绪
   *
   * 算法:
   *   1. 对每条快讯执行关键词匹配（利好/利空）
   *   2. 重要快讯加权 (isImportant × 2)
   *   3. 计算综合分数 (-100 ~ 100)
   *   4. 提取热点话题（高频词）
   */
  private analyzeSentiment(flashes: FlashNews[]): SentimentData {
    let positiveScore = 0;
    let negativeScore = 0;
    const policyCues: Set<string> = new Set();
    const riskCues: Set<string> = new Set();
    const topicCount: Map<string, number> = new Map();
    let importantCount = 0;

    for (const flash of flashes) {
      const text = `${flash.title} ${flash.content}`.toLowerCase();
      const weight = flash.isImportant ? 2 : 1;

      if (flash.isImportant) importantCount++;

      // 政策利好匹配
      for (const keyword of POLICY_KEYWORDS) {
        if (text.includes(keyword.toLowerCase())) {
          positiveScore += weight;
          policyCues.add(keyword);
        }
      }

      // 风险利空匹配
      for (const keyword of RISK_KEYWORDS) {
        if (text.includes(keyword.toLowerCase())) {
          negativeScore += weight;
          riskCues.add(keyword);
        }
      }

      // 提取话题词
      this.extractTopics(text, topicCount);
    }

    // 综合得分: -100 ~ 100
    const totalSignals = positiveScore + negativeScore;
    let score = 0;

    if (totalSignals > 0) {
      score = ((positiveScore - negativeScore) / totalSignals) * 100;
    }

    score = Math.max(-100, Math.min(100, Math.round(score)));

    // 情绪标签
    const label = this.scoreToLabel(score);

    // 热点话题 (按出现频率排序取前 5)
    const hotTopics = [...topicCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);

    return {
      score,
      label,
      hotTopics,
      policyCues: [...policyCues],
      riskCues: [...riskCues],
      flashCount: flashes.length,
      importantCount,
      analyzedAt: Date.now(),
    };
  }

  /**
   * 从文本中提取可能的话题词
   * 提取 2-4 字中文连续片段，过滤停用词
   */
  private extractTopics(text: string, topicCount: Map<string, number>): void {
    const chineseWordRegex = /[\u4e00-\u9fff]{2,8}/g;
    const matches = text.match(chineseWordRegex);
    if (!matches) return;

    for (const word of matches) {
      if (STOP_WORDS.has(word)) continue;
      // 过滤纯数字/符号混合
      if (/^[\d%]+$/.test(word)) continue;
      topicCount.set(word, (topicCount.get(word) ?? 0) + 1);
    }
  }

  /**
   * 情绪分数 → 标签映射
   */
  private scoreToLabel(score: number): SentimentLabel {
    if (score >= 80) return '极度乐观';
    if (score >= 40) return '乐观';
    if (score >= 15) return '偏多';
    if (score >= -15) return '中性';
    if (score >= -40) return '偏空';
    if (score >= -80) return '悲观';
    return '极度悲观';
  }

  // ─── 工具方法 ──────────────────────────────────────

  /**
   * 构建财联社 API URL（含公共查询参数）
   */
  private buildUrl(): string {
    const params = new URLSearchParams(API_PARAMS);
    return `${API_BASE}?${params.toString()}`;
  }

  /**
   * 清洗 HTML 内容，提取纯文本
   */
  private cleanHtml(html: string): string {
    if (!html) return '';

    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '') // 移除所有 HTML 标签
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  /**
   * 解析关联股票代码字符串
   * "600519,000858" → ["600519", "000858"]
   */
  private parseStockCodes(codesStr?: string): string[] {
    if (!codesStr || codesStr.trim().length === 0) return [];
    return codesStr
      .split(/[,，、\s]+/)
      .map((c) => c.trim())
      .filter((c) => /^\d{6}$/.test(c));
  }

  /**
   * 简单字符串哈希（用于缓存键）
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  // ─── 本地缓存 ──────────────────────────────────────

  private getLocalCache(key: string): string | null {
    const entry = this.localCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.localCache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setLocalCache(key: string, data: string, ttlMs: number): void {
    // 上限保护 200 条
    if (this.localCache.size >= 200) {
      const firstKey = this.localCache.keys().next().value;
      if (firstKey !== undefined) this.localCache.delete(firstKey);
    }
    this.localCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }
}
