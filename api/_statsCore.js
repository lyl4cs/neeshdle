import { ensureSchema, sql } from './_db.js'
import { verifySessionCookie } from './_authCore.js'

// Same summary shape as src/stats.js's getStatsSummary, computed server-side
// from the rounds table instead of a localStorage array.
export async function handleGetStats({ cookieHeader, secret }) {
  const session = await verifySessionCookie(cookieHeader, { secret })
  if (!session) return { status: 401, body: { error: 'Not logged in.' } }

  try {
    await ensureSchema()
    const rows = await sql`
      SELECT artist, correct, clip_seconds AS "clipSeconds" FROM rounds WHERE user_id = ${session.userId}
    `
    const wins = rows.filter((r) => r.correct)

    const artistCounts = {}
    for (const r of rows) {
      if (!r.artist) continue
      artistCounts[r.artist] = (artistCounts[r.artist] ?? 0) + 1
    }
    let mostListenedArtist = null
    let mostListenedCount = 0
    for (const [artist, count] of Object.entries(artistCounts)) {
      if (count > mostListenedCount) {
        mostListenedArtist = artist
        mostListenedCount = count
      }
    }

    return {
      status: 200,
      body: {
        totalRounds: rows.length,
        totalGuessed: wins.length,
        avgClipSeconds: wins.length ? wins.reduce((sum, r) => sum + r.clipSeconds, 0) / wins.length : null,
        mostListenedArtist,
      },
    }
  } catch (err) {
    console.error('[stats] get failed', err)
    return { status: 500, body: { error: 'Could not load stats.' } }
  }
}

// Same reduction src/stats.js's recordRound already applies at write time —
// only the primary (first-listed) artist is stored, not full credits.
function primaryArtist(artists) {
  return artists?.split(',')[0]?.trim() ?? null
}

export async function handleRecordRound({ cookieHeader, secret, track, correct, clipSeconds }) {
  const session = await verifySessionCookie(cookieHeader, { secret })
  if (!session) return { status: 401, body: { error: 'Not logged in.' } }

  if (!track || typeof track.name !== 'string') {
    return { status: 400, body: { error: 'Invalid round data.' } }
  }

  try {
    await ensureSchema()
    await sql`
      INSERT INTO rounds (user_id, track_name, artist, correct, clip_seconds)
      VALUES (${session.userId}, ${track.name}, ${primaryArtist(track.artists)}, ${Boolean(correct)}, ${clipSeconds ?? null})
    `
    return { status: 200, body: { ok: true } }
  } catch (err) {
    console.error('[stats] record failed', err)
    return { status: 500, body: { error: 'Could not record round.' } }
  }
}
