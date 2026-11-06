import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Permitir túneles Cloudflare / hosts externos en dev
    allowedHosts: true,
    proxy: {
      '/api': {
        // Backend local (PORT en backend/.env). Override: VITE_API_PROXY=http://localhost:4000
        target: process.env.VITE_API_PROXY || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
