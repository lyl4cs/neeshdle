async function spotifyGet(accessToken, path) {
  const url = path.startsWith('https://') ? path : `https://api.spotify.com/v1/${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`Spotify API request failed: ${res.status} ${await res.text()}`)
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

export async function fetchPlaylistTracks(accessToken, playlistId) {
  const tracks = []
  let path = `playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,uri,name,artists(name)))`
  while (path) {
    const data = await spotifyGet(accessToken, path)
    for (const item of data.items) {
      if (item.track?.id) tracks.push(toTrackSummary(item.track))
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
