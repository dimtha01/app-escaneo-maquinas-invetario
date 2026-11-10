import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.PORT || 5173);
  const apiProxy =
    env.VITE_API_PROXY || `http://localhost:${env.API_PORT || 3000}`;

  return {
    server: {
      port,
      // Permitir túneles Cloudflare / hosts externos en dev
      allowedHosts: true,
      proxy: {
        '/api': {
          // Backend local (PORT en backend/.env). Override: VITE_API_PROXY o API_PORT
          target: apiProxy,
          changeOrigin: true,
          // IA/BFL puede tardar >1 min; evita que el proxy corte la petición
          timeout: 300000,
          proxyTimeout: 300000,
        },
      },
    },
  };
});
