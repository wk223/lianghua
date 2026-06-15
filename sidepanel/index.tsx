/**
 * xvqiu Side Panel 入口
 * 挂载 React 应用 + 初始化全局样式
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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
