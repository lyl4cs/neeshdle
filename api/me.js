import { handleMe } from './_authCore.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { status, body } = await handleMe({
    cookieHeader: req.headers.cookie,
    secret: process.env.SESSION_SECRET,
  })

  res.status(status).json(body)
}
