import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

/**
 * 开发期：vite dev server（3317）把 API/渲染/文件/事件请求代理到本地 daemon（3316）。
 * 生产期：`vite build` 产出 ui/dist，由 daemon 直接托管（无需 dev server）。
 */
export default defineConfig({
  plugins: [solid()],
  server: {
    port: 3317,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3316',
      '/render': 'http://127.0.0.1:3316',
      '/files': 'http://127.0.0.1:3316',
      '/events': 'http://127.0.0.1:3316',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
