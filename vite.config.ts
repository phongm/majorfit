/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
