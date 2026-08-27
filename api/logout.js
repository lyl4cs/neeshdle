import { handleLogout } from './_authCore.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { status, body, cookie } = await handleLogout({
    cookieHeader: req.headers.cookie,
    secure: true,
  })

  if (cookie) res.setHeader('Set-Cookie', cookie)
  res.status(status).json(body)
}
