import { useCallback, useEffect, useRef, useState } from 'react'
import { CLIENT_ID, PLAYLIST_ID, STAGES } from './config'
import { pickDailyTrack, pickRandomTrack } from './dailyTrack'
import { getIntroOffsetMs, setIntroOffsetMs } from './introOffsets'
import { fetchMe, fetchPlaylistMeta, fetchPlaylistTracks, searchTracks } from './spotifyApi'
import { playStage } from './timing'
import { isSameSong, prioritizePoolMatches } from './trackMatch'
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
  const [currentTrack, setCurrentTrack] = useState(null)
  const [poolError, setPoolError] = useState(null)

  const [attempts, setAttempts] = useState([])
  const [busy, setBusy] = useState(false)
  const [playError, setPlayError] = useState(null)
  const roundStartedAtRef = useRef(null)
  const [winTimeSeconds, setWinTimeSeconds] = useState(null)
  const [offsetMs, setOffsetMsState] = useState(0)

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

        const me = await fetchMe(accessToken)
        console.log('[pool] logged in as', me.id, '-', me.display_name)

        const playlistMeta = await fetchPlaylistMeta(accessToken, PLAYLIST_ID)
        console.log('[pool] playlist owner', playlistMeta.owner.id, '-', playlistMeta.owner.display_name, {
          name: playlistMeta.name,
          public: playlistMeta.public,
          collaborative: playlistMeta.collaborative,
        })

        const tracks = await fetchPlaylistTracks(accessToken, PLAYLIST_ID)
        if (cancelled) return
        const dailyPick = pickDailyTrack(tracks)
        setPool(tracks)
        setCurrentTrack(dailyPick)
        setOffsetMsState(getIntroOffsetMs(dailyPick?.id))
        roundStartedAtRef.current = Date.now()
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
        if (!cancelled) setSearchResults(prioritizePoolMatches(results, pool))
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
  }, [query, auth.status, auth.getValidAccessToken, pool])

  const playClip = useCallback(async () => {
    if (!player || !deviceId || !currentTrack || busy) return
    const targetMs = over ? 'full' : currentStage
    setBusy(true)
    setPlayError(null)
    try {
      const accessToken = await auth.getValidAccessToken()
      const measurement = await playStage({
        player,
        accessToken,
        deviceId,
        trackUri: currentTrack.uri,
        targetMs,
        startOffsetMs: offsetMs,
      })
      console.log(`[timing] clip ${String(targetMs)}`, measurement)
    } catch (err) {
      console.error('[timing] play failed', err)
      setPlayError(err.message)
    } finally {
      setBusy(false)
    }
  }, [player, deviceId, currentTrack, busy, over, currentStage, offsetMs, auth])

  const submitGuess = useCallback(
    (track) => {
      if (!currentTrack || over || busy) return
      const correct = isSameSong(track, currentTrack)
      console.log('[guess]', track.name, '-', track.artists, '->', correct ? 'CORRECT' : 'WRONG')
      if (correct && roundStartedAtRef.current) {
        setWinTimeSeconds((Date.now() - roundStartedAtRef.current) / 1000)
      }
      setAttempts((prev) => [...prev, { kind: 'guess', track, correct }])
      setSearchResults([])
      setQuery('')
    },
    [currentTrack, over, busy],
  )

  const skip = useCallback(() => {
    if (!currentTrack || over || busy) return
    console.log('[guess] skip')
    setAttempts((prev) => [...prev, { kind: 'skip', correct: false }])
  }, [currentTrack, over, busy])

  const startNewSong = useCallback(() => {
    if (!pool) return
    const nextTrack = pickRandomTrack(pool, currentTrack?.id)
    setCurrentTrack(nextTrack)
    setOffsetMsState(getIntroOffsetMs(nextTrack?.id))
    setAttempts([])
    setPlayError(null)
    setQuery('')
    setSearchResults([])
    roundStartedAtRef.current = Date.now()
    setWinTimeSeconds(null)
  }, [pool, currentTrack])

  if (CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' || PLAYLIST_ID === 'YOUR_PLAYLIST_ID') {
    return <p>Fill in CLIENT_ID and PLAYLIST_ID in src/config.js before running this.</p>
  }

  const readyToPlay = Boolean(deviceId && currentTrack && playerStatus === 'ready')

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

              <div className="offset-control">
                <label>
                  Skip silent intro (s):{' '}
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={offsetMs / 1000}
                    onChange={(e) => {
                      const seconds = Math.max(0, Number(e.target.value) || 0)
                      const ms = Math.round(seconds * 1000)
                      setOffsetMsState(ms)
                      if (currentTrack) setIntroOffsetMs(currentTrack.id, ms)
                    }}
                  />
                </label>
              </div>

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

      {over && currentTrack && (
        <div className="result-overlay">
          <div className="result-card">
            <h2 className={won ? 'win' : 'lose'}>{won ? 'Correct!' : 'Wrong!'}</h2>
            {won && winTimeSeconds != null && (
              <p className="win-time">Congrats — you guessed in {winTimeSeconds.toFixed(1)}s</p>
            )}
            <p>
              {currentTrack.name} — {currentTrack.artists}
            </p>
            <button onClick={startNewSong}>New song</button>
          </div>
        </div>
      )}
    </div>
  )
}
