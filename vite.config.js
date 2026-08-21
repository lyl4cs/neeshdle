import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Spotify's redirect URI validation requires 127.0.0.1 (not "localhost")
  // for loopback OAuth redirects, so bind explicitly to IPv4 loopback.
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
