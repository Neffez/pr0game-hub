import vue from '@vitejs/plugin-vue';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

/** Text files worth compressing; smaller ones are sent as they are (like the server's threshold). */
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|webmanifest|txt|map)$/;
const MIN_BYTES = 1024;

/**
 * Writes `.br` and `.gz` next to every text file of the build: the server sends them as they are (`preCompressed` of
 * @fastify/static), so the files are compressed once at the highest level instead of on every request.
 */
function precompress(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'hub-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir.startsWith('/') ? config.build.outDir : join(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const file of walk(outDir)) {
        if (!COMPRESSIBLE.test(file)) continue;
        const data = readFileSync(file);
        if (data.length < MIN_BYTES) continue;
        writeFileSync(`${file}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }));
        writeFileSync(`${file}.gz`, gzipSync(data, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  base: '/hub/',
  plugins: [vue(), precompress()],
  server: {
    port: 5173,
    proxy: { '/hub/api': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
