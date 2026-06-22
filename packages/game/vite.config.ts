import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@voxelbound/shared': path.resolve(__dirname, '../shared/src'),
      '@voxelbound/engine': path.resolve(__dirname, '../engine/src'),
    },
  },
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
});
