/**
 * StorageManager 单元测试
 *
 * 使用模拟的 chrome.storage API 测试所有功能
 * 运行: npx tsx --no-warnings xvqiu/storage/manager.test.ts
 *
 * @module storage/manager.test
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
declare var process: { exit(code?: number): never; };

import {
  StorageManager,
  StorageError,
  QuotaExceededError,
  ValidationError,
  DEFAULT_SETTINGS,
  DEFAULTS,
  META_KEYS,
  type UserSettings,
  type AnalysisRecord,
  type StorageKey,
} from './manager';

import type { AnalysisResult, Verdict } from '../utils/types';

// ═══════════════════════════════════════════════════════════════
// Mock Chrome Storage API
// ═══════════════════════════════════════════════════════════════

interface MockStorageArea {
  data: Record<string, unknown>;
  get: (keys: string | string[] | Record<string, unknown> | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
  clear: () => Promise<void>;
  getBytesInUse: (keys: string | string[] | null) => Promise<number>;
}

type OnChangedCallback = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

function createMockStorageArea(): MockStorageArea {
  const data: Record<string, unknown> = {};
  const onChangedListeners: OnChangedCallback[] = [];

  return {
    data,

    async get(keys) {
      if (keys === null) {
        return { ...data };
      }

      if (typeof keys === 'string') {
        return { [keys]: data[keys] ?? undefined };
      }

      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          result[key] = data[key] ?? undefined;
        }
        return result;
      }

      // Object form (defaults)
      const result: Record<string, unknown> = {};
      for (const [key, defaultValue] of Object.entries(keys)) {
        result[key] = data[key] !== undefined ? data[key] : defaultValue;
      }
      return result;
    },

    async set(items) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(items)) {
        const oldValue = data[key];
        data[key] = value;
        changes[key] = { oldValue, newValue: value };
      }
      // Notify listeners
      for (const listener of onChangedListeners) {
        listener(changes, 'local');
      }
    },

    async remove(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of keyList) {
        const oldValue = data[key];
        delete data[key];
        changes[key] = { oldValue, newValue: undefined };
      }
      for (const listener of onChangedListeners) {
        listener(changes, 'local');
      }
    },

    async clear() {
      const oldData = { ...data };
      Object.keys(data).forEach((k) => delete data[k]);
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(oldData)) {
        changes[key] = { oldValue: value, newValue: undefined };
      }
      for (const listener of onChangedListeners) {
        listener(changes, 'local');
      }
    },

    async getBytesInUse() {
      return JSON.stringify(data).length;
    },
  };
}

function setupMockChrome(): void {
  const sync = createMockStorageArea();
  const local = createMockStorageArea();

  (globalThis as any).chrome = {
    storage: {
      sync,
      local,
      onChanged: {
        listeners: new Set<OnChangedCallback>(),
        addListener(callback: OnChangedCallback) {
          // We'll wire the mock areas to trigger this
          this.listeners.add(callback);
        },
        removeListener(callback: OnChangedCallback) {
          this.listeners.delete(callback);
        },
      },
    },
  };

  // Wire mock storage areas to trigger chrome.storage.onChanged
  const syncData = sync.data;
  const localData = local.data;

  // Override set to trigger onChanged
  const originalSyncSet = sync.set.bind(sync);
  sync.set = async (items) => {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [key, value] of Object.entries(items)) {
      const oldValue = syncData[key];
      syncData[key] = value;
      changes[key] = { oldValue, newValue: value };
    }
    for (const listener of (globalThis as any).chrome.storage.onChanged.listeners) {
      listener(changes, 'sync');
    }
  };

  const originalLocalSet = local.set.bind(local);
  local.set = async (items) => {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [key, value] of Object.entries(items)) {
      const oldValue = localData[key];
      localData[key] = value;
      changes[key] = { oldValue, newValue: value };
    }
    for (const listener of (globalThis as any).chrome.storage.onChanged.listeners) {
      listener(changes, 'local');
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
  }
}

function assertThrows(fn: () => Promise<void>, expectedErrorType: any, message: string): Promise<void> {
  return fn()
    .then(() => {
      failed++;
      console.error(`  ❌ FAIL: ${message} — expected error but got success`);
    })
    .catch((err) => {
      if (err instanceof expectedErrorType) {
        passed++;
      } else {
        failed++;
        console.error(`  ❌ FAIL: ${message} — expected ${expectedErrorType.name}, got ${err.constructor.name}: ${err.message}`);
      }
    });
}

function describe(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n📋 ${name}`);
  return fn().then(() => {
    // sub-test results printed inline
  });
}

async function it(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    // Assertions are tracked individually
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${name} threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  // Reset mocks before tests
  setupMockChrome();
  const storage = new StorageManager();

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║    StorageManager 单元测试                     ║');
  console.log('╚════════════════════════════════════════════════╝');

  // ─── 1. 初始化与默认值 ──────────────────────────────

  await describe('1. 初始化与默认值', async () => {
    await it('初始化后应写入默认值', async () => {
      await storage.init({ force: true });

      const apiKey = await storage.get('api_key');
      assertEqual(apiKey, '', 'api_key 应为空字符串');

      const settings = await storage.get< UserSettings>('settings');
      assertEqual(settings.model, DEFAULT_SETTINGS.model, 'settings.model 应为 deepseek-chat');
      assertEqual(settings.temperature, DEFAULT_SETTINGS.temperature, 'settings.temperature 应为 0.7');

      const watchlist = await storage.get<string[]>('watchlist');
      assert(Array.isArray(watchlist), 'watchlist 应为数组');
      assertEqual(watchlist.length, 0, 'watchlist 应为空');
    });

    await it('getAll 应返回所有已知键', async () => {
      await storage.init({ force: true });
      const all = await storage.getAll();
      assert('api_key' in all, 'getAll 应包含 api_key');
      assert('settings' in all, 'getAll 应包含 settings');
      assert('watchlist' in all, 'getAll 应包含 watchlist');
      assert('history' in all, 'getAll 应包含 history');
    });
  });

  // ─── 2. 核心读写 ────────────────────────────────────

  await describe('2. 核心读写', async () => {
    await it('set/get 基本读写', async () => {
      await storage.set('api_key', 'sk-test-key-12345');
      const result = await storage.get<string>('api_key');
      assertEqual(result, 'sk-test-key-12345', '读取写入的 API Key');
    });

    await it('setMany 批量写入', async () => {
      await storage.setMany({
        api_key: 'sk-batch-key',
        watchlist: ['000001', '600519', '000858'],
      } as Record<StorageKey, unknown>);

      const result = await storage.getMany(['api_key', 'watchlist']);
      assertEqual((result as any).api_key, 'sk-batch-key', '批量写入 api_key');
      const wl = (result as any).watchlist as string[];
      assertEqual(wl.length, 3, '批量写入 watchlist 应有 3 条');
    });

    await it('has 检查键是否存在', async () => {
      await storage.set('api_key', 'sk-exists');
      assert(await storage.has('api_key'), 'has 应返回 true');
      assert(
        await storage.has('nonexistent' as any).catch(() => false) === false,
        '不存在的键 has 应返回 false（或通过 resolveArea 默认走 local）',
      );
    });

    await it('remove 删除键', async () => {
      await storage.set('api_key', 'sk-to-remove');
      await storage.remove('api_key');
      const value = await storage.get<string>('api_key');
      assertEqual(value, '', '删除后应返回默认值');
    });

    await it('clear 清空所有数据', async () => {
      await storage.set('api_key', 'sk-clear');
      await storage.set('watchlist', ['000001']);
      await storage.setCache('test', 'data');

      const deleted = await storage.clear();
      assert(deleted.length > 0, 'clear 应返回被删除的键列表');

      const apiKey = await storage.get<string>('api_key');
      assertEqual(apiKey, '', 'clear 后 api_key 应恢复默认');
    });
  });

  // ─── 3. 默认值管理 ─────────────────────────────────

  await describe('3. 默认值管理', async () => {
    await it('resetToDefault 重置单个键', async () => {
      await storage.set('settings', { ...DEFAULT_SETTINGS, model: 'deepseek-reasoner' });
      await storage.resetToDefault('settings');
      const settings = await storage.get<UserSettings>('settings');
      assertEqual(settings.model, DEFAULT_SETTINGS.model, '重置后 model 恢复默认');
    });

    await it('resetAll 重置所有键', async () => {
      await storage.set('api_key', 'sk-reset-all');
      await storage.set('watchlist', ['000001', '600519']);
      await storage.resetAll();

      const apiKey = await storage.get<string>('api_key');
      const watchlist = await storage.get<string[]>('watchlist');
      assertEqual(apiKey, '', 'resetAll 后 api_key 为空');
      assertEqual(watchlist.length, 0, 'resetAll 后 watchlist 为空');
    });
  });

  // ─── 4. 缓存管理 ───────────────────────────────────

  await describe('4. 缓存管理', async () => {
    await it('setCache/getCache 写入和读取缓存', async () => {
      const testData = { price: 100, volume: 5000 };
      await storage.setCache('test_quote', testData, 60_000);

      const cached = await storage.getCache<typeof testData>('test_quote');
      assertEqual(cached?.price, 100, '缓存数据正确');
      assertEqual(cached?.volume, 5000, '缓存数据正确');
    });

    await it('getCache 过期后返回 null', async () => {
      // TTL = -1ms，立即过期
      await storage.setCache('expired_test', 'will expire', -1);

      const cached = await storage.getCache<string>('expired_test');
      assertEqual(cached, null, '过期缓存应返回 null');
    });

    await it('removeCache 删除缓存', async () => {
      await storage.setCache('to_remove', 'data', 60_000);
      await storage.removeCache('to_remove');

      const cached = await storage.getCache<string>('to_remove');
      assertEqual(cached, null, '删除后缓存应返回 null');
    });

    await it('clearExpiredCache 清除过期缓存', async () => {
      await storage.setCache('valid1', 'data', 60_000);
      await storage.setCache('valid2', 'data', 60_000);
      await storage.setCache('expired1', 'data', -1);
      await storage.setCache('expired2', 'data', -1);

      const cleared = await storage.clearExpiredCache();
      assert(cleared >= 2, `应清除至少 2 条过期缓存，实际清除 ${cleared}`);

      const valid1 = await storage.getCache<string>('valid1');
      const expired1 = await storage.getCache<string>('expired1');
      assert(valid1 !== null, '有效缓存应保留');
      assertEqual(expired1, null, '过期缓存应被清除');
    });

    await it('clearAllCache 清除所有缓存', async () => {
      // 确保缓存为空开始
      await storage.clearAllCache();
      await storage.setCache('a', 1, 60_000);
      await storage.setCache('b', 2, 60_000);

      const cleared = await storage.clearAllCache();
      assert(cleared >= 2, `应清除 2+ 条缓存，实际 ${cleared}`);

      const a = await storage.getCache<number>('a');
      const b = await storage.getCache<number>('b');
      assertEqual(a, null, 'clearAllCache 后 a 应为 null');
      assertEqual(b, null, 'clearAllCache 后 b 应为 null');
    });

    await it('getCacheStats 返回统计信息', async () => {
      // 先清空缓存，避免之前测试遗留
      await storage.clearAllCache();
      await storage.setCache('s1', 'data', 60_000);
      await storage.setCache('s2', 'data', -1);

      const stats = await storage.getCacheStats();
      assert(stats.total >= 2, `应有 2+ 条缓存，实际 ${stats.total}`);
      assert(stats.valid >= 1, '应有有效缓存');
      assert(stats.expired >= 1, '应有过期缓存');
    });
  });

  // ─── 5. 历史记录管理 ───────────────────────────────

  await describe('5. 历史记录管理', async () => {
    const mockResult: AnalysisResult = {
      marketEnv: {
        envLevel: 'B',
        sentiment: '偏多',
        suggestion: '谨慎追高',
      },
      directions: [
        {
          mainLine: '新能源',
          subLine: '光伏',
          recommendations: ['隆基绿能'],
        },
      ],
      stocks: [
        {
          stock: '隆基绿能',
          code: '601012',
          position: '突破',
          strength: '强',
          volumeAnalysis: '放量',
          logic: '板块龙头',
          risk: ['追高风险'],
          buyPoint: '回调 5 日线',
        },
      ],
      conclusions: [
        {
          stockCode: '000001',
          stockName: '平安银行',
          verdict: 'COND_BUY' as Verdict,
          reason: '板块强势',
          riskPoints: ['大盘风险'],
          priority: 1,
        },
      ],
      timestamp: Date.now(),
    };

    await it('addHistory 添加记录', async () => {
      const id = await storage.addHistory(mockResult);
      assert(typeof id === 'string' && id.length > 0, '应返回 ID');
    });

    await it('getHistory 查询记录', async () => {
      await storage.clearHistory();
      for (let i = 0; i < 5; i++) {
        await storage.addHistory(mockResult, { tags: ['test'] });
      }

      const all = await storage.getHistory();
      assertEqual(all.length, 5, '应有 5 条记录');

      const limited = await storage.getHistory({ limit: 3 });
      assertEqual(limited.length, 3, 'limit=3 应返回 3 条');
    });

    await it('getHistory 分页和排序', async () => {
      await storage.clearHistory();

      // 添加多条记录
      for (let i = 0; i < 5; i++) {
        await storage.addHistory(mockResult);
        await new Promise((r) => setTimeout(r, 5)); // 确保时间戳不同
      }

      const all = await storage.getHistory();
      assertEqual(all.length, 5, '应有 5 条记录');

      // 验证按时间降序排列（最新的在前）
      assert(all[0].createdAt >= all[1].createdAt, '第一条应比第二条新');

      // 分页
      const page1 = await storage.getHistory({ limit: 2, offset: 0 });
      assertEqual(page1.length, 2, '第 1 页应返回 2 条');

      const page2 = await storage.getHistory({ limit: 2, offset: 2 });
      assertEqual(page2.length, 2, '第 2 页应返回 2 条');

      // 筛选结论类型
      const buyResults = await storage.getHistory({ verdict: 'COND_BUY' });
      assert(buyResults.length >= 5, '所有记录的结论都是 COND_BUY');
    });

    await it('removeHistory 删除单条记录', async () => {
      await storage.clearHistory();
      const id = await storage.addHistory(mockResult);
      await storage.addHistory(mockResult); // second

      const removed = await storage.removeHistory(id);
      assert(removed, '删除应返回 true');

      const history = await storage.getHistory();
      assertEqual(history.length, 1, '删除后应剩 1 条');
    });

    await it('clearHistory 清空所有记录', async () => {
      await storage.addHistory(mockResult);
      await storage.addHistory(mockResult);

      await storage.clearHistory();
      const history = await storage.getHistory();
      assertEqual(history.length, 0, '清空后应为 0 条');
    });

    await it('getHistoryStats 返回统计', async () => {
      await storage.clearHistory();
      await storage.addHistory(mockResult);
      await storage.addHistory(mockResult);

      const stats = await storage.getHistoryStats();
      assertEqual(stats.total, 2, '总计 2 条');
      assert(stats.byVerdict['COND_BUY'] >= 2, 'COND_BUY 统计正确');
    });
  });

  // ─── 6. 元数据管理 ─────────────────────────────────

  await describe('6. 元数据管理', async () => {
    await it('setMeta/getMeta 读写', async () => {
      await storage.setMeta('test_key', 'test_value');
      const value = await storage.getMeta<string>('test_key');
      assertEqual(value, 'test_value', '元数据读写正确');
    });

    await it('removeMeta 删除', async () => {
      await storage.setMeta('temp', 'temp_value');
      await storage.removeMeta('temp');
      const value = await storage.getMeta<string>('temp');
      assertEqual(value, undefined, '删除后应为 undefined');
    });
  });

  // ─── 7. 变更监听 ──────────────────────────────────

  await describe('7. 变更监听', async () => {
    await it('onChange 监听键变更', async () => {
      let changedValue: string | undefined;

      const unsub = storage.onChange<string>('api_key', (value) => {
        changedValue = value;
      });

      await storage.set('api_key', 'sk-listener-test');
      // Wait a tick for the async listener
      await new Promise((r) => setTimeout(r, 50));

      assertEqual(changedValue, 'sk-listener-test', '监听器应收到新值');
      unsub();
    });

    await it('unsubscribe 应停止监听', async () => {
      let callCount = 0;

      const unsub = storage.onChange('api_key', () => {
        callCount++;
      });

      unsub();
      await storage.set('api_key', 'sk-unsub');
      await new Promise((r) => setTimeout(r, 50));

      assertEqual(callCount, 0, '取消订阅后不应收到通知');
    });
  });

  // ─── 8. 校验 ──────────────────────────────────────

  await describe('8. 值校验', async () => {
    await it('api_key 必须是字符串', async () => {
      await assertThrows(
        () => storage.set('api_key', 123 as any),
        ValidationError,
        '数字作为 api_key 应抛出 ValidationError',
      );
    });

    await it('settings 必须完整', async () => {
      await assertThrows(
        () => storage.set('settings', { model: 123 } as any),
        ValidationError,
        '无效 settings 应抛出 ValidationError',
      );
    });

    await it('watchlist 必须是字符串数组', async () => {
      await assertThrows(
        () => storage.set('watchlist', [123] as any),
        ValidationError,
        '包含数字的 watchlist 应抛出 ValidationError',
      );
    });

    await it('watchlist 数量上限 200', async () => {
      const bigList = Array.from({ length: 201 }, (_, i) => `${i}`);
      await assertThrows(
        () => storage.set('watchlist', bigList),
        ValidationError,
        '超过 200 条应抛出 ValidationError',
      );
    });

    await it('cache_* 必须是对象', async () => {
      // Setting cache via set directly should validate
      await assertThrows(
        () => storage.set('cache_bad' as any, 'string-not-object'),
        ValidationError,
        '非对象缓存值应抛出 ValidationError',
      );
    });
  });

  // ─── 9. 数据迁移 ──────────────────────────────────

  await describe('9. 数据迁移', async () => {
    await it('migrateFromLegacy 迁移旧版数据', async () => {
      // Write legacy format to local storage
      const chrome = (globalThis as any).chrome;
      await chrome.storage.local.set({
        xvqiu_settings: {
          model: 'deepseek-reasoner',
          temperature: 0.5,
          maxTokens: 2048,
          autoAnalyze: true,
          maxConcurrent: 5,
          debugMode: true,
        },
        deepseek_api_key: 'sk-legacy-key-xxx',
        xvqiu_installed_at: 1700000000000,
        xvqiu_version: '0.9.0',
      });

      const result = await storage.migrateFromLegacy();
      assert(result.migrated >= 4, `应迁移 4+ 项，实际迁移 ${result.migrated}`);

      // Verify migration
      const apiKey = await storage.get<string>('api_key');
      assertEqual(apiKey, 'sk-legacy-key-xxx', '迁移后 api_key 正确');

      const settings = await storage.get<UserSettings>('settings');
      assertEqual(settings.model, 'deepseek-reasoner', '迁移后 settings.model 正确');
      assertEqual(settings.temperature, 0.5, '迁移后 settings.temperature 正确');

      // Verify legacy keys cleaned up
      const legacyData = await chrome.storage.local.get([
        'xvqiu_settings',
        'deepseek_api_key',
        'xvqiu_installed_at',
        'xvqiu_version',
      ]);
      assertEqual(legacyData.xvqiu_settings, undefined, '旧版键应被清理');
      assertEqual(legacyData.deepseek_api_key, undefined, '旧版 API Key 应被清理');
    });

    await it('migrateFromLegacy 幂等 — 重复调用跳过', async () => {
      // Already migrated, should skip
      const result = await storage.migrateFromLegacy();
      assertEqual(result.migrated, 0, '重复迁移应跳过');
      assertEqual(result.skipped, 0, '重复迁移应跳过');
    });
  });

  // ─── 10. 存储信息 ─────────────────────────────────

  await describe('10. 存储信息', async () => {
    await it('getStorageInfo 返回统计', async () => {
      const info = await storage.getStorageInfo();
      assert(typeof info.sync.bytes === 'number', 'sync.bytes 应为数字');
      assert(typeof info.local.bytes === 'number', 'local.bytes 应为数字');
      assert(info.sync.keys >= 2, 'sync 区域至少有 2 个键');
      assert(info.local.keys >= 2, 'local 区域至少有 2 个键');
    });
  });

  // ─── 11. Sync 配额检查 ─────────────────────────────

  await describe('11. Sync 配额检查', async () => {
    await it('超出 sync 配额应抛出错误', async () => {
      // Create a string > 8KB but < 2048 chars ... wait, validation checks length first.
      // The validation allows up to 2048 chars. 8192 bytes / ~3 bytes per UTF-8 char ≈ 2700 chars.
      // So we need a string between 2049 and ~2700 chars to pass validation but exceed quota.
      // Actually, 2048 English chars = 2048 bytes. We need 8192 bytes.
      // Each char is 1 byte in ASCII = need 8193 chars.
      // But validation caps at 2048 chars. So quota cannot fire before validation on api_key.
      // We'll test quota on settings which has a larger payload.
      // JSON.stringify of settings with a huge model name should exceed 8KB
      const hugeSettings: UserSettings = {
        model: 'x'.repeat(8192),  // 8192 bytes + overhead > 8KB
        temperature: 0.7,
        maxTokens: 4096,
        autoAnalyze: false,
        maxConcurrent: 3,
        debugMode: false,
      };

      await assertThrows(
        () => storage.set('settings', hugeSettings),
        QuotaExceededError,
        '超过 8KB 的 sync 值应抛出 QuotaExceededError',
      );
    });
  });

  // ═══════════════════════════════════════════════════
  // 结果汇总
  // ═══════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('═'.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
