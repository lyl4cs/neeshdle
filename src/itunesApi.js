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
