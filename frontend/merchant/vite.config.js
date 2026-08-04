import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Merchant Panel dev server
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      // Trailing slash matters: a bare '/api' prefix also matches the SPA
      // route '/api-credentials' (Vite's proxy does string-prefix matching),
      // forwarding that page load to the backend instead of serving the
      // SPA — breaking direct navigation/hard-refresh on that one page.
      '/api/': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
