import { defineConfig } from 'vite';

export default defineConfig({
  // Build output goes to dist/ (standard Vite default)
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Inline small assets; keep Firebase SDK references as external URLs
    assetsInlineLimit: 4096,
  },
});
