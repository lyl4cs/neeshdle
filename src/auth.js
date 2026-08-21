import { CLIENT_ID, REDIRECT_URI, SCOPES } from './config'
import { generateCodeChallenge, generateCodeVerifier } from './pkce'

const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize'
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'

export async function redirectToLogin() {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateCodeVerifier().slice(0, 16)

  // The verifier has to survive the full-page redirect to Spotify and back,
  // so sessionStorage (not memory) is the only option here. It's not a
  // credential by itself — useless without the auth code that only Spotify
  // hands back on this same origin.
  sessionStorage.setItem('pkce_verifier', verifier)
  sessionStorage.setItem('pkce_state', state)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`)
}

// Reads ?code=/?state=/?error= off the current URL (the redirect back from
// Spotify) and strips them so a page refresh doesn't try to reuse a spent code.
export function getRedirectCode() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  if (!code && !error) return null

  window.history.replaceState({}, document.title, window.location.pathname)

  if (error) throw new Error(`Spotify auth error: ${error}`)

  const expectedState = sessionStorage.getItem('pkce_state')
  if (state !== expectedState) {
    throw new Error('State mismatch on auth callback — possible CSRF, aborting.')
  }
  return code
}

export async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('pkce_verifier')
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}
