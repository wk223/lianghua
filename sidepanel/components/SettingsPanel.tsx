/**
 * SettingsPanel — 设置面板
 *
 * 提供 API Key 配置、模型选择等设置项
 * 使用 chrome.storage.sync 持久化
 *
 * @module sidepanel/components/SettingsPanel
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';

const SettingsPanel: React.FC = () => {
  const { settingsOpen, toggleSettings, hasApiKey, setHasApiKey } = useAppStore();

  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 展开时加载已有 API Key
  useEffect(() => {
    if (settingsOpen) {
      chrome.storage.sync.get('api_key').then((result) => {
        const storedKey = (result.api_key as string) ?? '';
        setApiKey(storedKey);
        setHasApiKey(storedKey.length > 0);
      });
      // 聚焦输入框
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [settingsOpen, setHasApiKey]);

  // ─── 保存 API Key ─────────────────────────

  const handleSave = useCallback(async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      // 清空已保存的 key
      await chrome.storage.sync.remove('api_key');
      setHasApiKey(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }

    setSaving(true);
    try {
      await chrome.storage.sync.set({ api_key: trimmedKey });
      setHasApiKey(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[xvqiu] 保存 API Key 失败:', err);
    } finally {
      setSaving(false);
    }
  }, [apiKey, setHasApiKey]);

  // ─── 快捷键 ───────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        toggleSettings();
      }
    },
    [handleSave, toggleSettings],
  );

  return (
    <>
      {/* 设置入口按钮 */}
      <button
        type="button"
        onClick={toggleSettings}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-800"
        title="设置"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {hasApiKey ? '已配置' : '未配置'}
      </button>

      {/* 设置面板 */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={toggleSettings}
          />

          {/* 面板 */}
          <div className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl mx-4 mb-0 sm:mb-4 p-5 space-y-4 animate-slide-up">
            {/* 标题 */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-100">设置</h2>
              <button
                type="button"
                onClick={toggleSettings}
                className="p-1 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-800"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* API Key 配置 */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                DeepSeek API Key
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="sk-xxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 text-sm bg-gray-950 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-gray-600 font-mono pr-20"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                    title={showKey ? '隐藏' : '显示'}
                  >
                    {showKey ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-gray-600">
                输入你的 DeepSeek API Key。key 仅存储在本地浏览器中，不会上传到其他服务器。
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-400 ml-1"
                >
                  获取 Key →
                </a>
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? '保存中...' : saved ? '✔ 已保存' : '保存'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setApiKey('');
                  chrome.storage.sync.remove('api_key');
                  setHasApiKey(false);
                }}
                className="px-3 py-2 text-sm font-medium text-gray-400 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
              >
                清除
              </button>
            </div>

            {/* 底部提示 */}
            <p className="text-[11px] text-gray-700 text-center">
              按 Enter 保存 · 按 Esc 关闭
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default SettingsPanel;
