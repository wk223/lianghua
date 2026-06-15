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
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
