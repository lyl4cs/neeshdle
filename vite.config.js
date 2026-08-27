import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleSuggestSongs } from './api/_suggestSongsCore.js'
import { handleSignup, handleLogin, handleLogout, handleMe } from './api/_authCore.js'
import { handleGetStats, handleRecordRound } from './api/_statsCore.js'

// Vite's own dev server doesn't run Vercel's /api serverless functions, so
// this middleware re-implements just enough of that transport (JSON body
// parsing, cookies, status/body response) to exercise the exact same core
// handlers locally that the api/*.js files run in production. secure:false
// throughout since dev always runs plain http://127.0.0.1.
const ROUTES = {
  '/api/suggest-songs': {
    method: 'POST',
    run: (req, body) =>
      handleSuggestSongs({
        prompt: body.prompt,
        count: body.count,
        ip: req.socket?.remoteAddress ?? 'unknown',
        apiKey: process.env.ANTHROPIC_API_KEY,
      }),
  },
  '/api/signup': {
    method: 'POST',
    run: (req, body) =>
      handleSignup({
        username: body.username,
        email: body.email,
        password: body.password,
        ip: req.socket?.remoteAddress ?? 'unknown',
        secret: process.env.SESSION_SECRET,
        secure: false,
      }),
  },
  '/api/login': {
    method: 'POST',
    run: (req, body) =>
      handleLogin({
        username: body.username,
        password: body.password,
        ip: req.socket?.remoteAddress ?? 'unknown',
        secret: process.env.SESSION_SECRET,
        secure: false,
      }),
  },
  '/api/logout': {
    method: 'POST',
    run: (req) => handleLogout({ cookieHeader: req.headers.cookie, secure: false }),
  },
  '/api/me': {
    method: 'GET',
    run: (req) => handleMe({ cookieHeader: req.headers.cookie, secret: process.env.SESSION_SECRET }),
  },
  '/api/stats': {
    method: 'GET',
    run: (req) => handleGetStats({ cookieHeader: req.headers.cookie, secret: process.env.SESSION_SECRET }),
  },
  '/api/record-round': {
    method: 'POST',
    run: (req, body) =>
      handleRecordRound({
        cookieHeader: req.headers.cookie,
        secret: process.env.SESSION_SECRET,
        track: body.track,
        correct: body.correct,
        clipSeconds: body.clipSeconds,
      }),
  },
}

function apiDevMiddleware() {
  return {
    name: 'api-dev-middleware',
    apply: 'serve',
    configureServer(server) {
      for (const [path, route] of Object.entries(ROUTES)) {
        server.middlewares.use(path, async (req, res) => {
          if (req.method !== route.method) {
            res.statusCode = 405
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }
          let body = {}
          if (route.method === 'POST') {
            let raw = ''
            for await (const chunk of req) raw += chunk
            try {
              body = raw ? JSON.parse(raw) : {}
            } catch {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Invalid JSON body' }))
              return
            }
          }
          const { status, body: responseBody, cookie } = await route.run(req, body)
          if (cookie) res.setHeader('Set-Cookie', cookie)
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(responseBody))
        })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite only auto-exposes VITE_-prefixed vars to client code via
  // import.meta.env; these are server-only (read via process.env in the dev
  // middleware and the real serverless functions), so they have to be
  // threaded into process.env explicitly here for `npm run dev` to see a
  // .env.local value.
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['ANTHROPIC_API_KEY', 'POSTGRES_URL', 'SESSION_SECRET']) {
    if (env[key]) process.env[key] = env[key]
  }

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
