async function itunesGet(path) {
  const res = await fetch(`https://itunes.apple.com/${path}`)
  if (!res.ok) throw new Error(`iTunes API request failed: ${res.status}`)
  return res.json()
}

function toTrackSummary(t) {
  return {
    id: String(t.trackId),
    previewUrl: t.previewUrl,
    name: t.trackName,
    artists: t.artistName,
    thumbnailUrl: t.artworkUrl100 ?? t.artworkUrl60 ?? null,
  }
}

// Curated pool entries are looked up by exact Apple track id (not searched by
// name) so there's no fuzzy-match risk on the answer itself — only guesses
// go through the fuzzy search endpoint below.
export async function lookupTracks(ids) {
  if (ids.length === 0) return []
  const data = await itunesGet(`lookup?id=${ids.join(',')}`)
  return data.results
    .filter((r) => r.wrapperType === 'track' && r.previewUrl)
    .map(toTrackSummary)
}

export async function searchTracks(query, limit = 8) {
  if (!query.trim()) return []
  const data = await itunesGet(
    `search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(query)}`,
  )
  return data.results.filter((r) => r.previewUrl).map(toTrackSummary)
}

// attribute=artistTerm scopes the match to the artist field specifically,
// so this returns that artist's real catalog rather than any song whose
// title/artist/album text happens to contain the query — the ground truth
// for "what has this artist actually released," used instead of trusting an
// LLM's memory of an artist's discography (see promptSongs.js).
export async function searchTracksByArtist(artistName, limit = 15) {
  if (!artistName.trim()) return []
  const data = await itunesGet(
    `search?media=music&entity=song&attribute=artistTerm&limit=${limit}&term=${encodeURIComponent(artistName)}`,
  )
  return data.results.filter((r) => r.previewUrl).map(toTrackSummary)
}

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s]|_/g, '')
    .trim()
}

// There's no reliable way to search for a specific album directly (iTunes's
// album search is inconsistent — e.g. searching "Room on Fire" doesn't
// surface The Strokes' actual album at all). Two-step instead: search the
// artist's catalog (already proven reliable) to find any one track whose
// collectionName matches, then look up that track's collectionId directly —
// a search only returns whatever ranks within its result limit (an artist
// with a large/scattered catalog of singles and re-releases can bury all
// but one track of a given album past that cutoff, as happened with
// Tiffany Day's 13-track "HALO" — only "NO LUCK" ranked inside the top 100),
// while a lookup by the exact collection id returns the complete,
// authoritative tracklist regardless of search relevance.
export async function searchTracksByArtistAndAlbum(artistName, albumName, limit = 100) {
  if (!artistName.trim() || !albumName.trim()) return []
  const data = await itunesGet(
    `search?media=music&entity=song&attribute=artistTerm&limit=${limit}&term=${encodeURIComponent(artistName)}`,
  )
  const wantAlbum = normalize(albumName)
  const match = data.results.find(
    (r) => r.previewUrl && r.collectionName && normalize(r.collectionName).includes(wantAlbum),
  )
  if (!match) return []

  const albumData = await itunesGet(`lookup?id=${match.collectionId}&entity=song`)
  return albumData.results
    .filter((r) => r.wrapperType === 'track' && r.previewUrl)
    .map(toTrackSummary)
}

function largestImage(images) {
  return images?.[images.length - 1]?.label ?? null
}

function previewUrlFromLinks(links) {
  const preview = (Array.isArray(links) ? links : [links]).find(
    (l) => l?.attributes?.rel === 'enclosure' && l?.attributes?.type === 'audio/x-m4a',
  )
  return preview?.attributes?.href ?? null
}

// The legacy RSS chart feed (unlike rss.marketingtools.apple.com, which has
// no CORS headers) is fetchable directly from the browser and doubles as
// "what's actually popular right now" — real chart data refreshed by Apple,
// rather than a one-time hand-picked list that goes stale (a hardcoded
// "top hits" list from today is next year's "why is this still here").
export async function fetchTopSongs(limit = 50) {
  const res = await fetch(`https://itunes.apple.com/us/rss/topsongs/limit=${limit}/json`)
  if (!res.ok) throw new Error(`iTunes top songs request failed: ${res.status}`)
  const data = await res.json()
  const entries = data.feed?.entry ?? []
  return entries
    .map((entry) => ({
      id: entry.id?.attributes?.['im:id'],
      name: entry['im:name']?.label,
      artists: entry['im:artist']?.label,
      thumbnailUrl: largestImage(entry['im:image']),
      previewUrl: previewUrlFromLinks(entry.link),
    }))
    .filter((t) => t.id && t.name && t.previewUrl)
}
