// Shared between the real Vercel serverless function (api/suggest-songs.js)
// and the Vite dev-server middleware (vite.config.js) so local dev exercises
// the exact same logic that runs in production, not a reimplementation.

import { isRateLimited } from './_rateLimit.js'

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 10

// Asks the model to classify the request's STRUCTURE, never to recall song
// titles itself. Parsing the player's own text ("the strokes album room on
// fire") into {artist, album} is a reliable text-extraction task; recalling
// an artist's exact tracklist from memory is not (asked for Slayyyter,
// Haiku 4.5 returned Dua Lipa/The Weeknd hits — real, playable, wrong
// artist). A prior version tried to parse artist/album out of the raw text
// with a fixed stopword list client-side, which broke on exactly this kind
// of phrasing — words like "the"/"album"/"on" aren't reliably strippable
// without understanding the sentence. The real songs always come from
// iTunes's own catalog afterward (see promptSongs.js), never from this
// classification response.
function buildPrompt(userPrompt, artistCount) {
  return `A player wants a pool of songs for a music-guessing game, described as: "${userPrompt}".

Classify this request and respond with ONLY raw JSON, no markdown, no commentary, in exactly ONE of these three shapes:

1. Names one specific artist AND one specific album:
{"type": "album", "artist": "Artist Name", "album": "Album Name"}

2. Names one specific artist only (no specific album):
{"type": "artist", "artist": "Artist Name"}

3. Otherwise (a genre, era, vibe, mood, chart, or anything not naming one specific artist) — suggest ${artistCount} real music artists whose songs best match it:
{"type": "vibe", "artists": ["Artist 1", "Artist 2", ...]}`
}

function extractJsonObject(text) {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function cleanClassification(raw) {
  if (!raw || typeof raw !== 'object') return { type: 'vibe', artists: [] }

  if (raw.type === 'album' && typeof raw.artist === 'string' && typeof raw.album === 'string') {
    return { type: 'album', artist: raw.artist.trim(), album: raw.album.trim() }
  }
  if (raw.type === 'artist' && typeof raw.artist === 'string') {
    return { type: 'artist', artist: raw.artist.trim() }
  }
  const artists = Array.isArray(raw.artists)
    ? raw.artists.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim())
    : []
  return { type: 'vibe', artists }
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
  // A handful of artists gives enough variety for a vibe request without
  // diluting a named-artist/album request — the prompt only uses this for
  // the "vibe" classification branch.
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
    const text = data.content?.[0]?.text ?? '{}'
    const classification = cleanClassification(extractJsonObject(text))

    return { status: 200, body: { classification } }
  } catch (err) {
    console.error('[suggest-songs] failed', err)
    return { status: 500, body: { error: 'Song suggestion failed.' } }
  }
}
