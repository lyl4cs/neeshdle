import { searchTracksByArtist } from './itunesApi'

const FILLER_WORDS = new Set([
  'songs', 'song', 'tracks', 'track', 'give', 'me', 'some', 'please', 'by',
  'of', 'from', 'a', 'an', 'top', 'hits', 'music',
])

// If the request names a specific artist, the user already spelled it
// correctly (that's the whole request) — stripping filler words and
// searching iTunes directly with what's left avoids ever asking an LLM to
// re-spell/recall the name from memory, which is exactly where it can
// hallucinate (see buildPromptPool). This only strips generic noise words;
// anything else is assumed to be part of the artist name.
function extractArtistCandidate(prompt) {
  return prompt
    .replace(/\d+/g, '')
    .split(/\s+/)
    .filter((w) => w && !FILLER_WORDS.has(w.toLowerCase()))
    .join(' ')
    .trim()
}

// An explicit number in the prompt ("5 slayyyter songs") is respected
// exactly. Without one ("give me tiffany day songs"), there's no natural
// fixed size — a named artist should offer everything found for them, and a
// vibe/genre request gets a reasonable default — so this returns null
// rather than silently substituting some fixed default the caller can't see.
function extractRequestedCount(prompt) {
  const match = prompt.match(/\d+/)
  if (!match) return null
  return Math.min(Math.max(parseInt(match[0], 10), 1), 25)
}

export async function suggestArtists(prompt, count = 5) {
  const res = await fetch('/api/suggest-songs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, count }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  const { artists } = await res.json()
  return artists
}

function shuffled(arr) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Every actual song comes from iTunes's own catalog (searchTracksByArtist),
// never from the LLM's memory of an artist's tracklist — that memory is
// unreliable even for well-known niche artists (e.g. asked for Slayyyter,
// the model returned Dua Lipa / The Weeknd hits — real, playable, just not
// by the right artist). The LLM's only job is naming real artists, which it
// does far more reliably than recalling their exact discography.
export async function resolveArtists(artistNames, count) {
  const resolved = []
  const seenIds = new Set()
  for (const artist of artistNames) {
    if (resolved.length >= count) break
    try {
      const tracks = await searchTracksByArtist(artist, 15)
      for (const track of shuffled(tracks)) {
        if (resolved.length >= count) break
        if (seenIds.has(track.id)) continue
        resolved.push(track)
        seenIds.add(track.id)
      }
    } catch (err) {
      console.error('[resolve] artist search failed for', artist, err)
    }
  }
  return resolved
}

export async function buildPromptPool(prompt) {
  const requestedCount = extractRequestedCount(prompt)
  const directCandidate = extractArtistCandidate(prompt)
  if (directCandidate) {
    try {
      const directTracks = await searchTracksByArtist(directCandidate, 25)
      if (directTracks.length > 0) {
        // No explicit number given for a named artist — use everything
        // found for them rather than an arbitrary cap.
        const finalCount = requestedCount ?? directTracks.length
        return shuffled(directTracks).slice(0, finalCount)
      }
    } catch (err) {
      console.error('[pool] direct artist search failed', err)
    }
  }

  // No direct catalog hit — this is likely a vibe/genre/era/chart request
  // rather than a named artist, so ask the LLM to name real artists
  // matching it instead. There's no natural "everything" for a vibe
  // request, so fall back to a reasonable default pool size.
  const fallbackCount = requestedCount ?? 10
  const artists = await suggestArtists(prompt, fallbackCount)
  const resolved = await resolveArtists(artists, fallbackCount)
  if (resolved.length === 0) {
    throw new Error("Couldn't find any playable songs for that — try rephrasing it.")
  }
  return resolved
}
