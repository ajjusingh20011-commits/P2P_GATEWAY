import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Customer Checkout dev server
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
});
