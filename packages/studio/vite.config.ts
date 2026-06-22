import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@voxelbound/shared': path.resolve(__dirname, '../shared/src'),
      '@voxelbound/engine': path.resolve(__dirname, '../engine/src'),
    },
  },
  server: { port: 5174 },
});
