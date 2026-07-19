import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The NGO dashboard runs on its own port so it can sit alongside the other
// panels (trader/admin/merchant/checkout) without clashing.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    host: true,
  },
})
