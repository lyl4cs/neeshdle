import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleSuggestSongs } from './api/_suggestSongsCore.js'

// Vite's own dev server doesn't run Vercel's /api serverless functions, so
// this middleware re-implements just enough of that transport (JSON body
// parsing, status/body response) to exercise the exact same core handler
// locally that api/suggest-songs.js runs in production.
function apiDevMiddleware() {
  return {
    name: 'api-dev-middleware',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/suggest-songs', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        let raw = ''
        for await (const chunk of req) raw += chunk
        let parsed
        try {
          parsed = raw ? JSON.parse(raw) : {}
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid JSON body' }))
          return
        }
        const { status, body } = await handleSuggestSongs({
          prompt: parsed.prompt,
          count: parsed.count,
          ip: req.socket?.remoteAddress ?? 'unknown',
          apiKey: process.env.ANTHROPIC_API_KEY,
        })
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(body))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite only auto-exposes VITE_-prefixed vars to client code via
  // import.meta.env; ANTHROPIC_API_KEY is server-only (read via
  // process.env in the dev middleware and the real serverless function),
  // so it has to be threaded into process.env explicitly here for
  // `npm run dev` to see a .env.local value.
  const env = loadEnv(mode, process.cwd(), '')
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY

  return {
    plugins: [react(), apiDevMiddleware()],
    // Spotify's redirect URI validation requires 127.0.0.1 (not "localhost")
    // for loopback OAuth redirects, so bind explicitly to IPv4 loopback.
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  }
})
