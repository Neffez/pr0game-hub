import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/hub/',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: { '/hub/api': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
