/**
 * 浮动按钮组件
 * K 线页浮动分析按钮
 *
 * 在东方财富/同花顺个股页面注入一个半透明浮动按钮，
 * 点击后打开 xvqiu Side Panel 并自动填入当前股票代码
 *
 * @module content/floatingBtn
 */

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

const FLOATING_BTN_ID = 'xvqiu-floating-btn';
const FLOATING_BTN_CLASS = 'xvqiu-float-btn';

/** 按钮样式 */
const STYLES = {
  container: `
    position: fixed;
    right: 16px;
    bottom: 80px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  button: `
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    color: white;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    transition: all 0.2s ease;
    opacity: 0.85;
  `,
  buttonHover: `
    opacity: 1;
    transform: scale(1.1);
    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.6);
  `,
  tooltip: `
    background: rgba(17, 24, 39, 0.95);
    color: #e5e7eb;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
    border: 1px solid rgba(55, 65, 81, 0.5);
  `,
  tooltipVisible: `
    opacity: 1;
  `,
};

// ═══════════════════════════════════════════════════════════════
// 页面检测工具
// ═══════════════════════════════════════════════════════════════

/** 从当前页面 URL 和 DOM 中提取股票代码 */
function extractStockCode(): { code: string; name: string } | null {
  const url = window.location.href;

  // 东方财富: https://quote.eastmoney.com/sh600519.html 或 sz000063.html
  const emMatch = url.match(/(?:sh|sz|bj)(\d{6})/i);
  if (emMatch) {
    return { code: emMatch[1], name: extractStockName() };
  }

  // 同花顺: https://stock.10jqka.com.cn/000063/
  const thsMatch = url.match(/10jqka\.com\.cn\/(\d{6})/);
  if (thsMatch) {
    return { code: thsMatch[1], name: extractStockName() };
  }

  // 通用 fallback — 从页面标题提取（如 "中兴通讯(000063)"）
  const titleMatch = document.title.match(/(\d{6})/);
  if (titleMatch) {
    return { code: titleMatch[1], name: extractStockName() };
  }

  return null;
}

/** 尝试从页面 DOM 中提取股票名称 */
function extractStockName(): string {
  // 东方财富: .stock-name 或 .quote-name
  const nameEl =
    document.querySelector('.stock-name') ??
    document.querySelector('.quote-name') ??
    document.querySelector('.stock_name') ??
    document.querySelector('h1');
  if (nameEl) {
    const text = nameEl.textContent?.trim() ?? '';
    // 移除代码部分如 "(000063)"
    return text.replace(/[（(]\d{6}[）)]/g, '').trim();
  }

  // 从标题提取
  const title = document.title;
  const titleClean = title.replace(/[（(]\d{6}[）)]/g, '').trim();
  if (titleClean && titleClean.length < 20) {
    return titleClean;
  }

  return '';
}

// ═══════════════════════════════════════════════════════════════
// 浮动按钮创建与管理
// ═══════════════════════════════════════════════════════════════

let isButtonCreated = false;

/**
 * 创建浮动按钮
 */
export function createFloatingButton(): void {
  if (isButtonCreated) return;

  const stockInfo = extractStockCode();
  if (!stockInfo) return;

  const container = document.createElement('div');
  container.id = FLOATING_BTN_ID;
  container.style.cssText = STYLES.container;

  // Tooltip
  const tooltip = document.createElement('span');
  tooltip.id = `${FLOATING_BTN_ID}-tooltip`;
  tooltip.style.cssText = STYLES.tooltip;
  const displayName = stockInfo.name || stockInfo.code;
  tooltip.textContent = `🎯 xvqiu 分析 ${displayName}`;

  // 按钮
  const btn = document.createElement('button');
  btn.id = `${FLOATING_BTN_ID}-btn`;
  btn.style.cssText = STYLES.button;
  btn.textContent = '🎯';

  // Hover 效果
  btn.addEventListener('mouseenter', () => {
    btn.style.cssText = `${STYLES.button} ${STYLES.buttonHover}`;
    tooltip.style.cssText = `${STYLES.tooltip} ${STYLES.tooltipVisible}`;
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.cssText = STYLES.button;
    tooltip.style.cssText = STYLES.tooltip;
  });

  // 点击 → 打开 Side Panel 并发送消息
  btn.addEventListener('click', () => {
    btn.style.transform = 'scale(0.9)';
    setTimeout(() => {
      btn.style.transform = '';
    }, 150);

    // 打开 Side Panel
    chrome.runtime.sendMessage({
      type: 'OPEN_SIDE_PANEL',
      payload: { stock: stockInfo },
    }).catch(() => {
      // 即使打开失败也不影响
    });

    // 如果支持 sidePanel 打开方式
    if (chrome.sidePanel?.open) {
      try {
        (chrome.sidePanel.open as (window?: {}) => Promise<void>)({});
      } catch {
        // 静默处理
      }
    }
  });

  container.appendChild(btn);
  container.appendChild(tooltip);
  document.body.appendChild(container);

  isButtonCreated = true;
}

/**
 * 移除浮动按钮
 */
export function removeFloatingButton(): void {
  const existing = document.getElementById(FLOATING_BTN_ID);
  if (existing) {
    existing.remove();
  }
  isButtonCreated = false;
}

/**
 * 更新按钮状态（根据当前页面变化）
 */
export function updateFloatingButton(): void {
  removeFloatingButton();
  createFloatingButton();
}