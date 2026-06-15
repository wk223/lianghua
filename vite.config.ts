import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 同花顺 realhead API — 实时行情
      '/api/ths': {
        target: 'https://d.10jqka.com.cn',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://q.10jqka.com.cn/',
        },
        rewrite: (path) => path.replace(/^\/api\/ths/, ''),
      },
      // 同花顺板块/概念页面 — HTML 数据源
      '/api/ths_q': {
        target: 'https://q.10jqka.com.cn',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://q.10jqka.com.cn/',
        },
        rewrite: (path) => path.replace(/^\/api\/ths_q/, ''),
      },
      // 财联社 API — 实时电报/快讯/公告
      '/api/cls': {
        target: 'https://www.cls.cn',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.cls.cn/',
          'Origin': 'https://www.cls.cn',
        },
        rewrite: (path) => path.replace(/^\/api\/cls/, ''),
      },
      // 同花顺涨停板/龙虎榜 — HTML 数据源
      '/api/ths_zt': {
        target: 'https://q.10jqka.com.cn',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://q.10jqka.com.cn/',
        },
        rewrite: (path) => path.replace(/^\/api\/ths_zt/, ''),
      },
      // 东方财富 push2 数据 — 涨停/龙虎榜/资金流兜底
      '/api/em': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://data.eastmoney.com/',
        },
        rewrite: (path) => path.replace(/^\/api\/em/, ''),
      },
      // 东方 wealth 数据 API
      '/api/em_datacenter': {
        target: 'https://datacenter-web.eastmoney.com',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://data.eastmoney.com/',
        },
        rewrite: (path) => path.replace(/^\/api\/em_datacenter/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
