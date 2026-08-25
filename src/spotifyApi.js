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
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((a) => a.name).join(', '),
  }
}

export async function fetchMe(accessToken) {
  return spotifyGet(accessToken, 'me')
}

export async function fetchPlaylistMeta(accessToken, playlistId) {
  return spotifyGet(accessToken, `playlists/${playlistId}?fields=name,public,collaborative,owner(id,display_name)`)
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
