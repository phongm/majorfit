/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 默认域名需要 base: '/majorfit/'，自定义域名用 '/'
  base: process.env.VITE_BASE_PATH || '/majorfit/',
  server: {
    proxy: {
      // 本地开发时把上报与统计打到同机的统计服务，生产由 Nginx 反代
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
