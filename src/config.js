// Fill these in before running. CLIENT_ID is public (PKCE flow has no client
// secret) so it's fine to hardcode here for a local spike.

export const CLIENT_ID = '0deeb2fb940244f0b513e5f9dec07cec'

// Must exactly match a Redirect URI registered on the app in the Spotify
// dashboard. Vite's dev server defaults to http://127.0.0.1:5173/ — register
// that (or whatever this logs) in the dashboard's Redirect URIs.
export const REDIRECT_URI = `${window.location.origin}/`

export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ')

// Pool of candidate tracks the daily pick is drawn from — a Spotify playlist
// you curate. Grab the ID from the playlist's share link:
// open.spotify.com/playlist/{THIS_PART}?si=...
export const PLAYLIST_ID = '5GWZT5ZNU5M5fe1hGxQwQt'

export const STAGES = [500, 2000, 8000, 'full']
