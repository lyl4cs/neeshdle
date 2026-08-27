import { searchTracksByArtist, searchTracksByArtistAndAlbum } from './itunesApi'

// An explicit number in the prompt ("5 slayyyter songs") is respected
// exactly. Without one, there's no natural fixed size — a named
// artist/album should offer everything found, and a vibe/genre request
// gets a reasonable default — so this returns null rather than silently
// substituting some fixed default the caller can't see.
function extractRequestedCount(prompt) {
  const match = prompt.match(/\d+/)
  if (!match) return null
  return Math.min(Math.max(parseInt(match[0], 10), 1), 25)
}

async function classifyPrompt(prompt, count) {
  const res = await fetch('/api/suggest-songs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, count }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  const { classification } = await res.json()
  return classification
}

function shuffled(arr) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Every actual song comes from iTunes's own catalog, never from the LLM's
// memory of an artist's tracklist — that memory is unreliable even for
// well-known niche artists (asked for Slayyyter, the model returned Dua
// Lipa/The Weeknd hits — real, playable, just not by the right artist).
// The LLM's only job upstream (api/suggest-songs.js) is classifying the
// request's structure and, for a vibe request, naming real artists — both
// text-understanding tasks it's reliable at, unlike recalling a discography.
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
  const classification = await classifyPrompt(prompt, requestedCount ?? 5)

  if (classification.type === 'album') {
    const tracks = await searchTracksByArtistAndAlbum(classification.artist, classification.album)
    if (tracks.length === 0) {
      throw new Error(`Couldn't find "${classification.album}" by ${classification.artist} — try rephrasing it.`)
    }
    const finalCount = requestedCount ?? tracks.length
    return shuffled(tracks).slice(0, finalCount)
  }

  if (classification.type === 'artist') {
    // No explicit number given — use everything found rather than an
    // arbitrary cap.
    const tracks = await searchTracksByArtist(classification.artist, 100)
    if (tracks.length === 0) {
      throw new Error(`Couldn't find any playable songs by ${classification.artist} — try rephrasing it.`)
    }
    const finalCount = requestedCount ?? tracks.length
    return shuffled(tracks).slice(0, finalCount)
  }

  // vibe/genre/era/chart — no natural "everything" for this, so fall back
  // to a reasonable default pool size.
  const fallbackCount = requestedCount ?? 10
  const resolved = await resolveArtists(classification.artists ?? [], fallbackCount)
  if (resolved.length === 0) {
    throw new Error("Couldn't find any playable songs for that — try rephrasing it.")
  }
  return resolved
}
