import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow public preview tunnels (e.g. cloudflared) to reach the dev server.
    allowedHosts: ['.trycloudflare.com'],
  },
})
