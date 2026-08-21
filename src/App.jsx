import { useCallback, useEffect, useState } from 'react'
import { CLIENT_ID, PLAYLIST_ID, STAGES } from './config'
import { pickDailyTrack } from './dailyTrack'
import { fetchPlaylistTracks, searchTracks } from './spotifyApi'
import { playStage } from './timing'
import { useSpotifyAuth } from './useSpotifyAuth'
import { useSpotifyPlayer } from './useSpotifyPlayer'

export default function App() {
  const auth = useSpotifyAuth()
  const { player, deviceId, status: playerStatus, error: playerError } = useSpotifyPlayer(
    auth.getValidAccessToken,
    auth.status === 'authenticated',
  )

  const [pool, setPool] = useState(null)
  const [dailyTrack, setDailyTrack] = useState(null)
  const [poolError, setPoolError] = useState(null)

  const [stageIndex, setStageIndex] = useState(0)
  const [measurements, setMeasurements] = useState([])
  const [busy, setBusy] = useState(false)
  const [stageError, setStageError] = useState(null)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [guessedTrack, setGuessedTrack] = useState(null)
  const [guessResult, setGuessResult] = useState(null)

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    let cancelled = false
    async function loadPool() {
      try {
        const accessToken = await auth.getValidAccessToken()
        const tracks = await fetchPlaylistTracks(accessToken, PLAYLIST_ID)
        if (cancelled) return
        setPool(tracks)
        setDailyTrack(pickDailyTrack(tracks))
      } catch (err) {
        if (cancelled) return
        console.error('[pool] failed to load playlist', err)
        setPoolError(err.message)
      }
    }
    loadPool()
    return () => {
      cancelled = true
    }
  }, [auth.status, auth.getValidAccessToken])

  useEffect(() => {
    if (!query.trim() || auth.status !== 'authenticated') return
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchBusy(true)
      try {
        const accessToken = await auth.getValidAccessToken()
        const results = await searchTracks(accessToken, query)
        if (!cancelled) setSearchResults(results)
      } catch (err) {
        console.error('[search] failed', err)
      } finally {
        if (!cancelled) setSearchBusy(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, auth.status, auth.getValidAccessToken])

  const playNextStage = useCallback(async () => {
    if (!player || !deviceId || !dailyTrack || busy || stageIndex >= STAGES.length) return
    const targetMs = STAGES[stageIndex]
    setBusy(true)
    setStageError(null)
    try {
      const accessToken = await auth.getValidAccessToken()
      const measurement = await playStage({
        player,
        accessToken,
        deviceId,
        trackUri: dailyTrack.uri,
        targetMs,
      })
      console.log(`[timing] stage ${stageIndex} target=${targetMs}ms`, measurement)
      setMeasurements((prev) => [...prev, measurement])
      setStageIndex((i) => i + 1)
    } catch (err) {
      console.error('[timing] stage failed', err)
      setStageError(err.message)
    } finally {
      setBusy(false)
    }
  }, [player, deviceId, dailyTrack, busy, stageIndex, auth])

  const submitGuess = useCallback(
    (track) => {
      setGuessedTrack(track)
      const correct = track.id === dailyTrack?.id
      setGuessResult(correct)
      console.log('[guess]', track.name, '-', track.artists, '->', correct ? 'CORRECT' : 'WRONG')
      setSearchResults([])
      setQuery('')
    },
    [dailyTrack],
  )

  if (CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' || PLAYLIST_ID === 'YOUR_PLAYLIST_ID') {
    return <p>Fill in CLIENT_ID and PLAYLIST_ID in src/config.js before running this.</p>
  }

  const stagesDone = stageIndex >= STAGES.length
  const revealed = guessResult === true || stagesDone

  return (
    <div>
      <h1>Heardle</h1>

      <section>
        <h2>1. Auth</h2>
        <p>status: {auth.status}</p>
        {auth.error && <p>error: {auth.error}</p>}
        {auth.status !== 'authenticated' && <button onClick={auth.login}>Log in with Spotify</button>}
        {auth.status === 'authenticated' && (
          <p>token expires at: {new Date(auth.expiresAt).toLocaleTimeString()}</p>
        )}
      </section>

      {auth.status === 'authenticated' && (
        <section>
          <h2>2. Player</h2>
          <p>player status: {playerStatus}</p>
          {playerError && <p>{playerError}</p>}
          <p>device_id: {deviceId ?? '(none yet)'}</p>
        </section>
      )}

      {auth.status === 'authenticated' && (
        <section>
          <h2>3. Today's track</h2>
          {poolError && <p>error loading playlist: {poolError}</p>}
          {!poolError && !pool && <p>loading pool...</p>}
          {pool && <p>pool size: {pool.length}</p>}
          {revealed && dailyTrack && (
            <p>
              answer: {dailyTrack.name} — {dailyTrack.artists}
            </p>
          )}
        </section>
      )}

      {deviceId && dailyTrack && (
        <section>
          <h2>4. Stages</h2>
          <p>next stage: {stagesDone ? 'done' : String(STAGES[stageIndex])}</p>
          <button onClick={playNextStage} disabled={busy || stagesDone}>
            {busy ? 'playing...' : 'Play next stage'}
          </button>
          {stageError && <p>error: {stageError}</p>}
          <ul>
            {measurements.map((m, i) => (
              <li key={i}>
                target={String(m.targetMs)}ms actual={m.actualPlayedMs?.toFixed(1)}ms{' '}
                delta={m.deltaMs != null ? m.deltaMs.toFixed(1) : 'n/a'}ms start-latency=
                {m.startLatencyMs.toFixed(1)}ms
              </li>
            ))}
          </ul>
        </section>
      )}

      {dailyTrack && (
        <section>
          <h2>5. Guess</h2>
          {!revealed && (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search for a song"
              />
              {searchBusy && <p>searching...</p>}
              <ul>
                {(query.trim() ? searchResults : []).map((track) => (
                  <li key={track.id}>
                    <button onClick={() => submitGuess(track)}>
                      {track.name} — {track.artists}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {guessedTrack && (
            <p>
              your guess: {guessedTrack.name} — {guessedTrack.artists}:{' '}
              {guessResult ? 'CORRECT' : 'WRONG'}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
