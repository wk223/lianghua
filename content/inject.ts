/**
 * Content Script 入口
 * 在东方财富/同花顺 K 线页注入浮动按钮
 *
 * 注入流程:
 *   1. 等待 DOM 就绪
 *   2. 检测当前页面是否包含匹配的股票页面
 *   3. 提取股票代码和名称
 *   4. 创建浮动分析按钮
 *   5. 监听页面变化（SPA 场景下重新检测）
 *
 * @module content/inject
 */

import { createFloatingButton, updateFloatingButton, removeFloatingButton } from './floatingBtn';

// ═══════════════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════════════

const LOG_PREFIX = '[xvqiu]';

/**
 * 初始化 Content Script
 */
function init(): void {
  console.log(`${LOG_PREFIX} Content Script 已加载, URL:`, window.location.href);

  // 等待 DOM 就绪后注入按钮
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(createFloatingButton, 300); // 给页面渲染留时间
    });
  } else {
    setTimeout(createFloatingButton, 300);
  }

  // SPA 场景 — 监听 URL 变化
  setupUrlChangeDetection();
}

// ═══════════════════════════════════════════════════════════════
// SPA URL 变化检测
// ═══════════════════════════════════════════════════════════════

let lastUrl = window.location.href;

/**
 * 监听 URL 变化（处理 SPA 页面切换）
 * 使用 MutationObserver + popstate 事件
 */
function setupUrlChangeDetection(): void {
  // popstate 事件（浏览器前进/后退）
  window.addEventListener('popstate', onUrlChange);

  // pushState / replaceState 拦截
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onUrlChange();
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onUrlChange();
  };

  // MutationObserver — 检测 DOM 变化（一些 SPA 不触发 popstate）
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      onUrlChange();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
  });
}

/**
 * URL 变化时的处理函数
 */
function onUrlChange(): void {
  const newUrl = window.location.href;
  if (newUrl === lastUrl) return;

  console.log(`${LOG_PREFIX} URL 变化:`, lastUrl, '→', newUrl);
  lastUrl = newUrl;

  // 延迟后更新按钮（等待页面渲染）
  setTimeout(updateFloatingButton, 500);
}

// ═══════════════════════════════════════════════════════════════
// 消息监听（从 Service Worker / Side Panel 控制）
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'CONTENT_SCRIPT_PING': {
      sendResponse({ success: true, data: { active: true } });
      return true;
    }

    case 'CONTENT_SCRIPT_REFRESH': {
      // 刷新浮动按钮（例如用户切换了页面）
      updateFloatingButton();
      sendResponse({ success: true });
      return true;
    }

    case 'CONTENT_SCRIPT_REMOVE': {
      // 移除浮动按钮
      removeFloatingButton();
      sendResponse({ success: true });
      return true;
    }

    default:
      return false;
  }
});

// ═══════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════

init();

export {};