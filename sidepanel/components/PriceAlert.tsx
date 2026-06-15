/**
 * PriceAlert — 价格预警面板
 * 自选股设置目标价预警，达标时浏览器通知
 *
 * @module sidepanel/components/PriceAlert
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { storageManager } from '../../storage/manager';
import { ThsAdapter } from '../../data/ths';
import type { PriceAlertConfig } from '../../utils/types';

// ═══════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════

const thsAdapter = new ThsAdapter();

const PriceAlert: React.FC = () => {
  const [alerts, setAlerts] = useState<PriceAlertConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ─── 表单状态 ──────────────────────────────
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formDirection, setFormDirection] = useState<'above' | 'below'>('above');
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState('');

  // ─── 加载预警 ──────────────────────────────

  const loadAlerts = useCallback(() => {
    setAlerts(storageManager.getPriceAlerts());
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // ─── 重置表单 ──────────────────────────────

  const resetForm = useCallback(() => {
    setFormCode('');
    setFormName('');
    setFormPrice('');
    setFormDirection('above');
    setFormNote('');
    setFormError('');
    setEditingId(null);
    setShowForm(false);
  }, []);

  // ─── 开始编辑 ──────────────────────────────

  const startEdit = useCallback((alert: PriceAlertConfig) => {
    setFormCode(alert.code);
    setFormName(alert.name);
    setFormPrice(String(alert.targetPrice));
    setFormDirection(alert.direction);
    setFormNote(alert.note || '');
    setEditingId(alert.id);
    setFormError('');
    setShowForm(true);
  }, []);

  // ─── 添加/更新预警 ─────────────────────────

  const handleSubmit = useCallback(() => {
    setFormError('');

    // 验证
    if (!formCode.trim()) {
      setFormError('请输入股票代码');
      return;
    }
    const code = formCode.replace(/^(SH|SZ|BJ)/i, '').trim();
    if (!/^\d{6}$/.test(code)) {
      setFormError('请输入 6 位数字股票代码');
      return;
    }
    if (!formPrice.trim() || Number.isNaN(parseFloat(formPrice))) {
      setFormError('请输入有效目标价');
      return;
    }
    const targetPrice = parseFloat(formPrice);
    if (targetPrice <= 0) {
      setFormError('目标价需大于 0');
      return;
    }

    const name = formName.trim() || code;

    if (editingId) {
      // 更新
      storageManager.updatePriceAlert(editingId, {
        code,
        name,
        targetPrice,
        direction: formDirection,
        note: formNote.trim() || undefined,
      });
    } else {
      // 新增
      storageManager.addPriceAlert({
        code,
        name,
        targetPrice,
        direction: formDirection,
        enabled: true,
        note: formNote.trim() || undefined,
      });
    }

    loadAlerts();
    resetForm();
  }, [formCode, formName, formPrice, formDirection, formNote, editingId, loadAlerts, resetForm]);

  // ─── 删除预警 ──────────────────────────────

  const handleRemove = useCallback(
    (id: string) => {
      storageManager.removePriceAlert(id);
      loadAlerts();
    },
    [loadAlerts],
  );

  // ─── 切换状态 ──────────────────────────────

  const handleToggle = useCallback(
    (alert: PriceAlertConfig) => {
      storageManager.togglePriceAlert(alert.id, !alert.enabled);
      loadAlerts();
    },
    [loadAlerts],
  );

  // ═══ 渲染 ═══════════════════════════════════

  return (
    <div className="card space-y-3 animate-fade-in">
      {/* ═══ 标题 ═══ */}
      <div className="flex items-center gap-2">
        <span className="text-lg">🔔</span>
        <span className="text-sm font-bold text-lime-400">价格预警</span>
        <span className="text-[10px] text-gray-600 ml-auto">{alerts.length}个</span>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="px-2 py-0.5 text-[10px] text-lime-400 bg-lime-900/20 hover:bg-lime-900/40 rounded transition-colors"
        >
          + 新增
        </button>
      </div>

      {/* ═══ 表单 ═══ */}
      {showForm && (
        <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              placeholder="股票代码 (6位)"
              className="flex-1 px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500/30 placeholder-gray-600"
              disabled={!!editingId}
            />
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="名称 (可选)"
              className="flex-1 px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-lime-500 placeholder-gray-600"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              value={formPrice}
              onChange={(e) => setFormPrice(e.target.value)}
              placeholder="目标价"
              step="0.01"
              className="flex-[2] px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-lime-500 placeholder-gray-600"
            />
            <select
              value={formDirection}
              onChange={(e) => setFormDirection(e.target.value as 'above' | 'below')}
              className="flex-1 px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-lime-500 text-gray-300"
            >
              <option value="above">向上突破 ↑</option>
              <option value="below">向下跌破 ↓</option>
            </select>
          </div>
          <input
            type="text"
            value={formNote}
            onChange={(e) => setFormNote(e.target.value)}
            placeholder="备注 (可选)"
            className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-lime-500 placeholder-gray-600"
          />
          {formError && (
            <div className="text-[10px] text-red-400">{formError}</div>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-1 text-[10px] text-gray-400 bg-gray-800 rounded hover:bg-gray-700"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-3 py-1 text-[10px] text-white bg-lime-600 rounded hover:bg-lime-700"
            >
              {editingId ? '更新' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ 预警列表 ═══ */}
      {alerts.length === 0 ? (
        <div className="text-center py-4 text-gray-600 text-xs">
          <div className="text-xl mb-1">🔕</div>
          <p>暂无价格预警</p>
          <p className="text-[10px] text-gray-700 mt-1">点击"+ 新增"添加</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-lg border p-2.5 transition-colors ${
                alert.enabled
                  ? 'bg-gray-800/60 border-gray-700/40'
                  : 'bg-gray-800/30 border-gray-700/20 opacity-60'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-200">{alert.name}</span>
                <span className="text-[10px] text-gray-500 font-mono">{alert.code}</span>
                <span className={`ml-auto text-[10px] font-mono font-bold ${alert.direction === 'above' ? 'text-red-400' : 'text-green-400'}`}>
                  {alert.direction === 'above' ? '↑ ' : '↓ '}
                  {alert.targetPrice.toFixed(2)}
                </span>
              </div>
              {alert.note && (
                <div className="mt-0.5 text-[9px] text-gray-600">{alert.note}</div>
              )}
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[9px] text-gray-700">
                  创建于 {new Date(alert.createdAt).toLocaleDateString('zh-CN')}
                </span>
                {alert.lastTriggeredAt && (
                  <span className="text-[9px] text-yellow-600">
                    最后触发 {new Date(alert.lastTriggeredAt).toLocaleTimeString('zh-CN')}
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleToggle(alert)}
                    className={`px-1.5 py-0.5 text-[9px] rounded ${
                      alert.enabled
                        ? 'text-lime-400 bg-lime-900/20 hover:bg-lime-900/40'
                        : 'text-gray-600 bg-gray-800 hover:bg-gray-700'
                    }`}
                  >
                    {alert.enabled ? '已启用' : '已暂停'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(alert)}
                    className="px-1.5 py-0.5 text-[9px] text-blue-400 bg-blue-900/20 hover:bg-blue-900/40 rounded"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(alert.id)}
                    className="px-1.5 py-0.5 text-[9px] text-red-400 bg-red-900/20 hover:bg-red-900/40 rounded"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PriceAlert;
