import { useCallback, useEffect, useRef, useState } from 'react'
import { exchangeCodeForToken, getRedirectCode, redirectToLogin, refreshAccessToken } from './auth'

const REFRESH_BUFFER_MS = 60_000

// Access/refresh tokens live only in this ref (React state, not
// localStorage/sessionStorage) — a reload means logging in again, which is
// fine for a throwaway spike and keeps us honest about not persisting
// credentials.
export function useSpotifyAuth() {
  const [status, setStatus] = useState('idle') // idle | authenticating | authenticated | error
  const [error, setError] = useState(null)
  const [expiresAt, setExpiresAt] = useState(0)
  const tokenRef = useRef({ accessToken: null, refreshToken: null, expiresAt: 0 })

  const applyTokenResponse = useCallback((tokenResponse) => {
    const { access_token, refresh_token, expires_in } = tokenResponse
    const nextExpiresAt = Date.now() + expires_in * 1000
    tokenRef.current = {
      accessToken: access_token,
      refreshToken: refresh_token ?? tokenRef.current.refreshToken,
      expiresAt: nextExpiresAt,
    }
    setExpiresAt(nextExpiresAt)
    console.log('[auth] token set, expires at', new Date(nextExpiresAt).toLocaleTimeString())
  }, [])

  useEffect(() => {
    // No cancellation guard here on purpose: getRedirectCode() strips the
    // ?code= off the URL the first time it's read, which is what actually
    // makes this one-shot (not a `cancelled` flag). Bailing out on
    // StrictMode's synthetic double-invoke cleanup would silently drop the
    // exchange result and leave status stuck on "authenticating".
    async function init() {
      try {
        const code = getRedirectCode()
        if (!code) return
        setStatus('authenticating')
        const tokenResponse = await exchangeCodeForToken(code)
        applyTokenResponse(tokenResponse)
        setStatus('authenticated')
      } catch (err) {
        console.error('[auth] login failed', err)
        setError(err.message)
        setStatus('error')
      }
    }
    init()
  }, [applyTokenResponse])

  const login = useCallback(() => {
    redirectToLogin()
  }, [])

  // Passed to the SDK's getOAuthToken and used before any Web API call.
  // Refreshes proactively (60s buffer) rather than waiting for a 401.
  const getValidAccessToken = useCallback(async () => {
    const { accessToken, refreshToken, expiresAt } = tokenRef.current
    if (!accessToken) throw new Error('Not authenticated yet')
    if (Date.now() < expiresAt - REFRESH_BUFFER_MS) return accessToken
    if (!refreshToken) throw new Error('Access token expired and no refresh token available')
    console.log('[auth] access token near expiry, refreshing...')
    const tokenResponse = await refreshAccessToken(refreshToken)
    applyTokenResponse(tokenResponse)
    return tokenResponse.access_token
  }, [applyTokenResponse])

  // Manual trigger so the refresh path can be proven in seconds instead of
  // waiting out the ~1hr access token lifetime.
  const forceRefresh = useCallback(async () => {
    const { refreshToken, expiresAt: before } = tokenRef.current
    if (!refreshToken) throw new Error('No refresh token yet — log in first')
    console.log('[auth] forcing refresh...')
    const tokenResponse = await refreshAccessToken(refreshToken)
    applyTokenResponse(tokenResponse)
    console.log(
      '[auth] refresh OK. old expiry',
      new Date(before).toLocaleTimeString(),
      'new expiry',
      new Date(tokenRef.current.expiresAt).toLocaleTimeString(),
    )
  }, [applyTokenResponse])

  return {
    status,
    error,
    login,
    getValidAccessToken,
    forceRefresh,
    expiresAt,
  }
}
