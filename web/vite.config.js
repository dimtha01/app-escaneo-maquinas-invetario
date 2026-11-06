import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
       // Permitir túneles Cloudflare / hosts externos en dev
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
