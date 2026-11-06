import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths: the game is served from a folder of its own on Patch's game host
  base: './',
  resolve: { dedupe: ['three'] },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
});
