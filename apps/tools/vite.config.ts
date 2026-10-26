import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Static pages: the tools index and one folder per tool, served at the domain root next to /hub/.
export default defineConfig({
  base: './',
  server: { port: 5174 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        flightCalculator: resolve(import.meta.dirname, 'flight-calculator/index.html'),
        acsLoot: resolve(import.meta.dirname, 'acs-loot/index.html'),
        ipmCalculator: resolve(import.meta.dirname, 'ipm-calculator/index.html'),
      },
    },
  },
});
