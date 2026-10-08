/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 部署在 /<repo-name>/ 子路径下时需要设置 base。
  // 使用自定义域名时设为 '/'。通过环境变量 VITE_BASE_PATH 控制。
  base: process.env.VITE_BASE_PATH || '/',
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
