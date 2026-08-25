import { useCallback, useEffect, useState } from 'react'
import { CLIENT_ID, PLAYLIST_ID, STAGES } from './config'
import { pickDailyTrack } from './dailyTrack'
import { fetchPlaylistTracks, searchTracks } from './spotifyApi'
import { playStage } from './timing'
import { useSpotifyAuth } from './useSpotifyAuth'
import { useSpotifyPlayer } from './useSpotifyPlayer'

function formatClip(stage) {
  if (stage === 'full') return 'full track'
  if (stage >= 1000) return `${stage / 1000}s`
  return `${stage}ms`
}

export default function App() {
  const auth = useSpotifyAuth()
  const { player, deviceId, status: playerStatus, error: playerError } = useSpotifyPlayer(
    auth.getValidAccessToken,
    auth.status === 'authenticated',
  )

  const [pool, setPool] = useState(null)
  const [dailyTrack, setDailyTrack] = useState(null)
  const [poolError, setPoolError] = useState(null)

  const [attempts, setAttempts] = useState([])
  const [busy, setBusy] = useState(false)
  const [playError, setPlayError] = useState(null)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchBusy, setSearchBusy] = useState(false)

  const failCount = attempts.filter((a) => !a.correct).length
  const won = attempts.some((a) => a.correct)
  const lost = !won && failCount >= STAGES.length
  const over = won || lost
  const unlockedIndex = Math.min(failCount, STAGES.length - 1)
  const currentStage = STAGES[unlockedIndex]

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

  const playClip = useCallback(async () => {
    if (!player || !deviceId || !dailyTrack || busy) return
    const targetMs = over ? 'full' : currentStage
    setBusy(true)
    setPlayError(null)
    try {
      const accessToken = await auth.getValidAccessToken()
      const measurement = await playStage({
        player,
        accessToken,
        deviceId,
        trackUri: dailyTrack.uri,
        targetMs,
      })
      console.log(`[timing] clip ${String(targetMs)}`, measurement)
    } catch (err) {
      console.error('[timing] play failed', err)
      setPlayError(err.message)
    } finally {
      setBusy(false)
    }
  }, [player, deviceId, dailyTrack, busy, over, currentStage, auth])

  const submitGuess = useCallback(
    (track) => {
      if (!dailyTrack || over || busy) return
      const correct = track.id === dailyTrack.id
      console.log('[guess]', track.name, '-', track.artists, '->', correct ? 'CORRECT' : 'WRONG')
      setAttempts((prev) => [...prev, { kind: 'guess', track, correct }])
      setSearchResults([])
      setQuery('')
    },
    [dailyTrack, over, busy],
  )

  const skip = useCallback(() => {
    if (!dailyTrack || over || busy) return
    console.log('[guess] skip')
    setAttempts((prev) => [...prev, { kind: 'skip', correct: false }])
  }, [dailyTrack, over, busy])

  if (CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' || PLAYLIST_ID === 'YOUR_PLAYLIST_ID') {
    return <p>Fill in CLIENT_ID and PLAYLIST_ID in src/config.js before running this.</p>
  }

  const readyToPlay = Boolean(deviceId && dailyTrack && playerStatus === 'ready')

  return (
    <div className="app">
      <h1>Heardle</h1>

      {auth.status !== 'authenticated' && (
        <section>
          {auth.error && <p className="error">{auth.error}</p>}
          <button onClick={auth.login}>Log in with Spotify</button>
          <p className="hint">Spotify Premium is required to play clips in the browser.</p>
        </section>
      )}

      {auth.status === 'authenticated' && (
        <>
          {playerError && <p className="error">{playerError}</p>}
          {poolError && <p className="error">Could not load playlist: {poolError}</p>}
          {auth.status === 'authenticated' && playerStatus !== 'ready' && !playerError && (
            <p>Connecting player…</p>
          )}
          {!poolError && !pool && <p>Loading today&apos;s track…</p>}

          {readyToPlay && (
            <section className="game">
              <ol className="slots">
                {STAGES.map((stage, i) => {
                  const attempt = attempts[i]
                  let state = 'empty'
                  if (attempt?.correct) state = 'correct'
                  else if (attempt?.kind === 'skip') state = 'skip'
                  else if (attempt) state = 'wrong'
                  else if (i === unlockedIndex && !over) state = 'current'
                  return (
                    <li key={stage} className={state} title={formatClip(stage)}>
                      {i + 1}
                    </li>
                  )
                })}
              </ol>

              <p className="clip-label">
                {over
                  ? won
                    ? 'You got it — play the full track'
                    : 'Out of guesses — play the answer'
                  : `Clip ${unlockedIndex + 1} of ${STAGES.length}: ${formatClip(currentStage)}`}
              </p>

              <div className="actions">
                <button onClick={playClip} disabled={busy}>
                  {busy ? 'Playing…' : over ? 'Play song' : 'Play clip'}
                </button>
                {!over && (
                  <button onClick={skip} disabled={busy}>
                    Skip
                  </button>
                )}
              </div>
              {playError && <p className="error">{playError}</p>}

              {over && dailyTrack && (
                <p className={won ? 'result win' : 'result lose'}>
                  {won ? 'Correct!' : 'Not this time.'} {dailyTrack.name} — {dailyTrack.artists}
                </p>
              )}

              {!over && (
                <>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for a song"
                    disabled={busy}
                    autoComplete="off"
                  />
                  {searchBusy && <p className="hint">Searching…</p>}
                  <ul className="results">
                    {(query.trim() ? searchResults : []).map((track) => (
                      <li key={track.id}>
                        <button onClick={() => submitGuess(track)} disabled={busy}>
                          {track.name} — {track.artists}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {attempts.length > 0 && (
                <ul className="history">
                  {attempts.map((attempt, i) => (
                    <li key={i}>
                      {attempt.kind === 'skip'
                        ? `Skipped (${formatClip(STAGES[i])})`
                        : `${attempt.track.name} — ${attempt.track.artists}: ${
                            attempt.correct ? 'correct' : 'wrong'
                          }`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
