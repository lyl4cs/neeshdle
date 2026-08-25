import { useCallback, useEffect, useRef, useState } from 'react'
import { CLIENT_ID, DEFAULT_PLAYLIST_ID, STAGES } from './config'
import { getIntroOffsetMs, setIntroOffsetMs } from './introOffsets'
import {
  fetchMe,
  fetchMyPlaylists,
  fetchPlaylistMeta,
  fetchPlaylistTracks,
  searchTracks,
} from './spotifyApi'
import { getStatsSummary, recordRound } from './stats'
import { playStage } from './timing'
import { isSameSong, prioritizePoolMatches } from './trackMatch'
import { pickUnplayedTrack } from './trackPicker'
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

  const [userId, setUserId] = useState(null)
  // Tracks played this page session so a given song won't repeat until a
  // refresh/re-login clears it — intentionally in-memory only, not persisted.
  const playedTrackIdsRef = useRef(new Set())

  const [activePlaylistId, setActivePlaylistId] = useState(DEFAULT_PLAYLIST_ID)
  const [playlistInfo, setPlaylistInfo] = useState(null)
  const [myPlaylists, setMyPlaylists] = useState(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState(null)

  const [pool, setPool] = useState(null)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [poolError, setPoolError] = useState(null)

  const [attempts, setAttempts] = useState([])
  const [busy, setBusy] = useState(false)
  const [playError, setPlayError] = useState(null)
  const [winClipSeconds, setWinClipSeconds] = useState(null)
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
    async function loadMyPlaylists() {
      try {
        const accessToken = await auth.getValidAccessToken()
        const me = await fetchMe(accessToken)
        console.log('[pool] logged in as', me.id, '-', me.display_name)
        if (!cancelled) setUserId(me.id)
        const playlists = await fetchMyPlaylists(accessToken)
        if (!cancelled) setMyPlaylists(playlists)
      } catch (err) {
        console.error('[pool] failed to load your playlists', err)
      }
    }
    loadMyPlaylists()
    return () => {
      cancelled = true
    }
  }, [auth.status, auth.getValidAccessToken])

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    let cancelled = false
    async function loadPlaylist() {
      setPoolError(null)
      try {
        const accessToken = await auth.getValidAccessToken()

        const playlistMeta = await fetchPlaylistMeta(accessToken, activePlaylistId)
        if (cancelled) return
        setPlaylistInfo({ name: playlistMeta.name, thumbnailUrl: playlistMeta.images?.[0]?.url ?? null })
        console.log('[pool] playlist owner', playlistMeta.owner.id, '-', playlistMeta.owner.display_name, {
          name: playlistMeta.name,
          public: playlistMeta.public,
          collaborative: playlistMeta.collaborative,
        })

        const tracks = await fetchPlaylistTracks(accessToken, activePlaylistId)
        if (cancelled) return
        const pick = pickUnplayedTrack(tracks, playedTrackIdsRef.current)
        if (pick) playedTrackIdsRef.current.add(pick.id)
        setPool(tracks)
        setCurrentTrack(pick)
        setOffsetMsState(getIntroOffsetMs(pick?.id))
        setAttempts([])
        setPlayError(null)
        setQuery('')
        setSearchResults([])
        setWinClipSeconds(null)
      } catch (err) {
        if (cancelled) return
        console.error('[pool] failed to load playlist', err)
        setPoolError(err.message)
      }
    }
    loadPlaylist()
    return () => {
      cancelled = true
    }
  }, [auth.status, auth.getValidAccessToken, activePlaylistId])

  const switchPlaylist = useCallback((playlistId) => {
    setActivePlaylistId(playlistId)
    setShowSwitcher(false)
  }, [])

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
      if (correct) {
        // "How fast you guessed" means how little audio you needed to hear,
        // not wall-clock time — that'd be mostly measuring how long you spent
        // looking at the screen before pressing play.
        const clipSeconds = currentStage / 1000
        setWinClipSeconds(clipSeconds)
        recordRound(userId, { track: currentTrack, correct: true, clipSeconds })
      } else if (failCount + 1 >= STAGES.length) {
        recordRound(userId, { track: currentTrack, correct: false, clipSeconds: null })
      }
      setAttempts((prev) => [...prev, { kind: 'guess', track, correct }])
      setSearchResults([])
      setQuery('')
    },
    [currentTrack, over, busy, currentStage, failCount, userId],
  )

  const skip = useCallback(() => {
    if (!currentTrack || over || busy) return
    console.log('[guess] skip')
    if (failCount + 1 >= STAGES.length) {
      recordRound(userId, { track: currentTrack, correct: false, clipSeconds: null })
    }
    setAttempts((prev) => [...prev, { kind: 'skip', correct: false }])
  }, [currentTrack, over, busy, failCount, userId])

  const startNewSong = useCallback(() => {
    if (!pool) return
    const nextTrack = pickUnplayedTrack(pool, playedTrackIdsRef.current)
    if (nextTrack) playedTrackIdsRef.current.add(nextTrack.id)
    setCurrentTrack(nextTrack)
    setOffsetMsState(getIntroOffsetMs(nextTrack?.id))
    setAttempts([])
    setPlayError(null)
    setQuery('')
    setSearchResults([])
    setWinClipSeconds(null)
  }, [pool])

  if (CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' || DEFAULT_PLAYLIST_ID === 'YOUR_PLAYLIST_ID') {
    return <p>Fill in CLIENT_ID and DEFAULT_PLAYLIST_ID in src/config.js before running this.</p>
  }

  const readyToPlay = Boolean(deviceId && currentTrack && playerStatus === 'ready')

  return (
    <div className="app">
      <h1>Heardle</h1>

      <button
        onClick={() => {
          setStats(getStatsSummary(userId))
          setShowStats((v) => !v)
        }}
      >
        Stats
      </button>

      {showStats && stats && (
        <div className="stats-panel">
          <p>Total songs guessed: {stats.totalGuessed}</p>
          <p>
            Average clip length guessed within:{' '}
            {stats.avgClipSeconds != null ? `${stats.avgClipSeconds.toFixed(2)}s` : '—'}
          </p>
          <p>Most listened artist: {stats.mostListenedArtist ?? '—'}</p>
        </div>
      )}

      {auth.status !== 'authenticated' && (
        <section>
          {auth.error && <p className="error">{auth.error}</p>}
          <button onClick={auth.login}>Log in with Spotify</button>
          <p className="hint">Spotify Premium is required to play clips in the browser.</p>
        </section>
      )}

      {auth.status === 'authenticated' && (
        <>
          {playlistInfo && (
            <section className="playlist-bar">
              {playlistInfo.thumbnailUrl && <img src={playlistInfo.thumbnailUrl} alt="" className="playlist-thumb" />}
              <span className="playlist-name">{playlistInfo.name}</span>
              <button onClick={() => setShowSwitcher((v) => !v)}>Switch playlist</button>
            </section>
          )}

          {showSwitcher && (
            <ul className="playlist-switcher">
              {!myPlaylists && <li className="hint">Loading your playlists…</li>}
              {myPlaylists?.map((p) => (
                <li key={p.id}>
                  <button onClick={() => switchPlaylist(p.id)} disabled={p.id === activePlaylistId}>
                    {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" className="thumb" />}
                    <span>{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {playerError && <p className="error">{playerError}</p>}
          {poolError && <p className="error">Could not load playlist: {poolError}</p>}
          {auth.status === 'authenticated' && playerStatus !== 'ready' && !playerError && (
            <p>Connecting player…</p>
          )}
          {!poolError && !pool && <p>Loading a track…</p>}

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
                          {track.thumbnailUrl && (
                            <img src={track.thumbnailUrl} alt="" className="thumb" />
                          )}
                          <span>
                            {track.name} — {track.artists}
                          </span>
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
            {won && winClipSeconds != null && (
              <p className="win-time">Congrats — you guessed it in {winClipSeconds}s</p>
            )}
            {currentTrack.thumbnailUrl && (
              <img src={currentTrack.thumbnailUrl} alt="" className="reveal-thumb" />
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
