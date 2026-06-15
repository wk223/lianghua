/**
 * xvqiu 应用入口 (Electron 版)
 * 挂载 React 应用 + 初始化全局样式
 *
 * 从 ../src/shared/electron-api 导入类型，确保 window.electronAPI 类型安全
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../src/shared/electron-api';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('[xvqiu] #root 元素不存在');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
