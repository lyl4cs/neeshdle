import { useEffect, useRef, useState } from 'react'

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js'
let sdkPromise = null

function loadSdk() {
  if (window.Spotify) return Promise.resolve(window.Spotify)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify)
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    document.body.appendChild(script)
  })
  return sdkPromise
}

export function useSpotifyPlayer(getOAuthTokenFn, enabled) {
  const [deviceId, setDeviceId] = useState(null)
  const [status, setStatus] = useState('idle') // idle | connecting | ready | error
  const [error, setError] = useState(null)
  const [player, setPlayer] = useState(null)
  const playerRef = useRef(null)

  // getOAuthTokenFn changes identity across renders in theory; the SDK
  // captures the callback once at construction, so route through a ref to
  // always call the latest version.
  const getTokenRef = useRef(getOAuthTokenFn)
  getTokenRef.current = getOAuthTokenFn

  useEffect(() => {
    if (!enabled || playerRef.current) return
    let cancelled = false
    setStatus('connecting')

    loadSdk().then((Spotify) => {
      if (cancelled) return
      const player = new Spotify.Player({
        name: 'Heardle SDK Spike',
        getOAuthToken: (cb) => {
          getTokenRef.current().then(cb).catch((err) => {
            console.error('[player] getOAuthToken failed', err)
          })
        },
        volume: 0.8,
      })

      player.addListener('ready', ({ device_id }) => {
        console.log('[player] ready, device_id =', device_id)
        setDeviceId(device_id)
        setStatus('ready')
      })
      player.addListener('not_ready', ({ device_id }) => {
        console.warn('[player] not_ready', device_id)
        setStatus('connecting')
      })
      player.addListener('initialization_error', ({ message }) => {
        console.error('[player] initialization_error', message)
        setError(`initialization_error: ${message}`)
        setStatus('error')
      })
      player.addListener('authentication_error', ({ message }) => {
        console.error('[player] authentication_error', message)
        setError(`authentication_error: ${message}`)
        setStatus('error')
      })
      player.addListener('account_error', ({ message }) => {
        console.error('[player] account_error', message)
        setError(
          `account_error: Spotify Premium is required for the Web Playback SDK. (${message})`,
        )
        setStatus('error')
      })
      player.addListener('playback_error', ({ message }) => {
        console.error('[player] playback_error', message)
      })

      playerRef.current = player
      setPlayer(player)
      player.connect()
    })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return { player, deviceId, status, error }
}
