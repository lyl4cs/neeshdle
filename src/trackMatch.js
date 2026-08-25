function normalize(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]|_/g, '')
    .replace(/\s+/g, ' ')
}

function normalizedArtistSet(artists) {
  return artists
    .split(',')
    .map((a) => normalize(a))
    .filter(Boolean)
    .sort()
    .join('|')
}

// The same song is frequently split across multiple Spotify track IDs —
// album version vs. single, remaster vs. original, a compilation re-release
// — so an exact id match is too strict. Fall back to normalized name +
// artist-set equality (order-independent, for when featured-artist credit
// order differs between releases).
export function isSameSong(a, b) {
  if (a.id === b.id) return true
  return normalize(a.name) === normalize(b.name) && normalizedArtistSet(a.artists) === normalizedArtistSet(b.artists)
}

// Search hits a different catalog than the playlist pool, so the exact
// release you actually need to pick can get buried under other versions of
// the same song. Float anything that matches a pool track to the top
// (stable otherwise) so it's obvious which result to click.
export function prioritizePoolMatches(results, pool) {
  if (!pool || pool.length === 0) return results
  const isPoolMatch = (track) => pool.some((poolTrack) => isSameSong(track, poolTrack))
  return [...results].sort((a, b) => Number(isPoolMatch(b)) - Number(isPoolMatch(a)))
}
