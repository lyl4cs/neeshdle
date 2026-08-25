async function spotifyGet(accessToken, path) {
  const url = path.startsWith('https://') ? path : `https://api.spotify.com/v1/${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('[spotify-api] request failed', { url, status: res.status, body })
    throw new Error(`Spotify API request failed: ${res.status} ${body}`)
  }
  return res.json()
}

function toTrackSummary(track) {
  const images = track.album?.images ?? []
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((a) => a.name).join(', '),
    // Smallest image (Spotify orders largest-first) — plenty for a result thumbnail.
    thumbnailUrl: images[images.length - 1]?.url ?? null,
  }
}

export async function fetchMe(accessToken) {
  return spotifyGet(accessToken, 'me')
}

export async function fetchPlaylistMeta(accessToken, playlistId) {
  return spotifyGet(
    accessToken,
    `playlists/${playlistId}?fields=name,public,collaborative,owner(id,display_name),images`,
  )
}

// The user's own playlists, for the "switch playlist" picker. Includes ones
// they own and ones they follow — anything that'd show up in their library.
export async function fetchMyPlaylists(accessToken) {
  const playlists = []
  let path = 'me/playlists?limit=50'
  while (path) {
    const data = await spotifyGet(accessToken, path)
    for (const p of data.items) {
      if (!p) continue
      playlists.push({ id: p.id, name: p.name, thumbnailUrl: p.images?.[0]?.url ?? null })
    }
    path = data.next
  }
  return playlists
}

export async function fetchPlaylistTracks(accessToken, playlistId) {
  // /playlists/{id}/tracks was retired in Spotify's Feb 2026 Web API
  // migration (403s for Development Mode apps) in favor of /items, which
  // renamed each entry's `track` field to `item` — read both since some
  // responses still carry the deprecated field alongside the new one.
  const tracks = []
  let path = `playlists/${playlistId}/items`
  while (path) {
    const data = await spotifyGet(accessToken, path)
    for (const entry of data.items) {
      const track = entry.item ?? entry.track
      if (track?.id && Array.isArray(track.artists)) tracks.push(toTrackSummary(track))
    }
    path = data.next
  }
  return tracks
}

export async function searchTracks(accessToken, query, limit = 8) {
  if (!query.trim()) return []
  const data = await spotifyGet(accessToken, `search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`)
  return data.tracks.items.map(toTrackSummary)
}
