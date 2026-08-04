import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Trader Panel dev server
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // Trailing slash matters — see the identical fix + explanation in
      // frontend/merchant/vite.config.js (a bare '/api' prefix also matches
      // any future SPA route that happens to start with the string 'api').
      '/api/': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
