import { handleRecordRound } from './_statsCore.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { track, correct, clipSeconds } = req.body ?? {}

  const { status, body } = await handleRecordRound({
    cookieHeader: req.headers.cookie,
    secret: process.env.SESSION_SECRET,
    track,
    correct,
    clipSeconds,
  })

  res.status(status).json(body)
}
