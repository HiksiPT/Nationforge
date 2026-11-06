import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the built site works from any GitHub Pages sub-path (https://user.github.io/repo/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 2000 },
  server: { port: 5180 },
  preview: { port: 5181 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
