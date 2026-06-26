import path from 'path';
import { defineConfig } from 'vite';

/** Project Pages URL: https://<owner>.github.io/voxelbound/ */
const base = process.env.GITHUB_PAGES === 'true' ? '/voxelbound/' : '/';

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@voxelbound/shared': path.resolve(__dirname, '../shared/src'),
      '@voxelbound/engine': path.resolve(__dirname, '../engine/src'),
    },
  },
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
});
