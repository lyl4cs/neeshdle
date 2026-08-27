import { handleSignup } from './_authCore.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  const { username, email, password } = req.body ?? {}

  const { status, body, cookie } = await handleSignup({
    username,
    email,
    password,
    ip,
    secret: process.env.SESSION_SECRET,
    secure: true,
  })

  if (cookie) res.setHeader('Set-Cookie', cookie)
  res.status(status).json(body)
}
