import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 东方财富 API — 通过代理解决浏览器 CORS 限制
      '/api/eastmoney': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/eastmoney/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
