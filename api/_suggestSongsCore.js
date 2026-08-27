// Shared between the real Vercel serverless function (api/suggest-songs.js)
// and the Vite dev-server middleware (vite.config.js) so local dev exercises
// the exact same logic that runs in production, not a reimplementation.

import { isRateLimited } from './_rateLimit.js'

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 10

// Deliberately asks for ARTIST NAMES, never song titles. A model recalling
// a specific niche artist's exact tracklist from memory hallucinates often
// (e.g. asked for Slayyyter songs, Haiku 4.5 returned Dua Lipa / The Weeknd
// hits instead — real, playable songs, just not by the right artist). Real
// artist names for well-known acts are far more reliably recalled, and the
// actual songs get pulled from iTunes's own catalog afterward (see
// promptSongs.js) instead of trusted from the model's memory.
function buildPrompt(userPrompt, artistCount) {
  return `A player wants songs for a music-guessing game, described as: "${userPrompt}".

If this names a specific artist, respond with just that artist. Otherwise suggest ${artistCount} real music artists whose songs best match this request (a genre, era, vibe, or chart, etc).

Respond with ONLY a raw JSON array of artist name strings, no markdown, no commentary, in exactly this shape:
["Artist Name", ...]`
}

function extractJsonArray(text) {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
      return JSON.parse(match[0])
    } catch {
      return []
    }
  }
}

// Returns { status, body } — transport-agnostic so both the Vercel handler
// and the Vite dev middleware can just forward it as their response.
export async function handleSuggestSongs({ prompt, count, ip, apiKey }) {
  if (isRateLimited('suggest-songs', ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX })) {
    return { status: 429, body: { error: 'Too many requests — try again in a few minutes.' } }
  }

  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200) {
    return { status: 400, body: { error: 'Prompt must be 1-200 characters.' } }
  }

  const safeCount = Math.min(Math.max(Number(count) || 5, 1), 10)
  // A handful of artists gives enough variety for a genre/vibe request
  // without diluting a named-artist request — the prompt tells the model to
  // just return the one artist when the request already names someone.
  const artistCount = Math.min(Math.max(safeCount, 3), 8)

  if (!apiKey) {
    return { status: 500, body: { error: 'Song suggestion service is not configured.' } }
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildPrompt(prompt.trim(), artistCount) }],
      }),
    })

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text()
      console.error('[suggest-songs] Anthropic API error', anthropicRes.status, detail)
      return { status: 502, body: { error: 'Song suggestion service failed.' } }
    }

    const data = await anthropicRes.json()
    const text = data.content?.[0]?.text ?? '[]'
    const artists = extractJsonArray(text)

    const cleaned = Array.isArray(artists)
      ? artists.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim())
      : []

    return { status: 200, body: { artists: cleaned } }
  } catch (err) {
    console.error('[suggest-songs] failed', err)
    return { status: 500, body: { error: 'Song suggestion failed.' } }
  }
}
