import { handleSuggestSongs } from './_suggestSongsCore.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  const { prompt, count } = req.body ?? {}

  const { status, body } = await handleSuggestSongs({
    prompt,
    count,
    ip,
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  res.status(status).json(body)
}
