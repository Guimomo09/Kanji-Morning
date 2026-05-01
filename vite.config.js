import { defineConfig } from 'vite';

export default defineConfig({
  // Build output goes to dist/ (standard Vite default)
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Inline small assets; keep Firebase SDK references as external URLs
    assetsInlineLimit: 4096,
  },
  server: {
    proxy: {
      // Mirrors the Caddy reverse-proxy on the VPS.
      // Forwards /api/tatoeba?... → https://tatoeba.org/api_v0/search?...
      '/api/tatoeba': {
        target: 'https://tatoeba.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tatoeba/, '/api_v0/search'),
      },
    },
  },
});
