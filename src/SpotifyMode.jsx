import { useCallback, useEffect, useRef, useState } from 'react'
import { CLIENT_ID, DEFAULT_PLAYLIST_ID, STAGES } from './config'
import { BoltIcon, CheckIcon, SkipIcon, XIcon } from './icons'
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

function formatStageShort(stage) {
  if (stage === 'full') return 'FULL'
  if (stage >= 1000) return `${stage / 1000}S`
  return `${stage}MS`
}

// Real per-track waveforms aren't available (no audio analysis access — see
// timing spike notes), so this is a fixed decorative shape, not real audio
// data. Stage markers use a compressed early scale rather than literal
// proportional time — a real song's 0.5s/2s/8s marks would all sit within
// the first couple of percent of a literal timeline, indistinguishable.
const WAVEFORM_HEIGHTS = [
  16, 24, 12, 30, 20, 34, 14, 26, 22, 32, 18, 28, 10, 24, 36, 16, 20, 30, 14, 26, 18, 32, 22, 12,
  28, 20, 34, 16, 24, 10, 30, 18, 26, 14, 22, 32,
]
const WAVEFORM_WIDTH = 340
const WAVEFORM_HEIGHT = 64
const BAR_SPACING = WAVEFORM_WIDTH / WAVEFORM_HEIGHTS.length

function computeMarkerPositions(stages) {
  const fullIndex = stages.indexOf('full')
  const numericCount = fullIndex === -1 ? stages.length : fullIndex
  const span = WAVEFORM_WIDTH * 0.6
  const step = numericCount > 1 ? span / (numericCount - 1) : 0
  return stages.map((stage, i) => (stage === 'full' ? WAVEFORM_WIDTH * 0.94 : WAVEFORM_WIDTH * 0.08 + i * step))
}

const MARKER_POSITIONS = computeMarkerPositions(STAGES)

export default function SpotifyMode({ onBack }) {
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
  // Guards the one-time auto-select in loadMyPlaylists below so it never
  // overrides a playlist the user later switches to manually.
  const hasAutoSelectedPlaylistRef = useRef(false)
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
        if (cancelled) return
        setMyPlaylists(playlists)
        // DEFAULT_PLAYLIST_ID is the dev's own curated playlist — fine as
        // the starting point when they're the one logged in, but anyone
        // else (e.g. a friend testing this) would otherwise be shown the
        // dev's playlist by default instead of their own. Only keep it if
        // this account actually has access to it; otherwise default to
        // their own first playlist.
        if (!hasAutoSelectedPlaylistRef.current) {
          hasAutoSelectedPlaylistRef.current = true
          const hasAccessToDefault = playlists.some((p) => p.id === DEFAULT_PLAYLIST_ID)
          if (!hasAccessToDefault && playlists.length > 0) {
            setActivePlaylistId(playlists[0].id)
          }
        }
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
  const unlockedX = over ? WAVEFORM_WIDTH : MARKER_POSITIONS[unlockedIndex]

  return (
    <div className="app">
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="rough" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" />
        </filter>
      </svg>

      {onBack && (
        <button
          className="btn-bracket"
          onClick={onBack}
          style={{ display: 'block', margin: '0 auto 14px', color: '#9a9686' }}
        >
          [ &larr; back ]
        </button>
      )}

      {auth.status !== 'authenticated' && (
        <div className="receipt login-card">
          <div className="grain" />
          <div className="grain-coarse" />
          <div className="grain-wash" />
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <BoltIcon size={34} />
          </div>
          <p className="stamp-font" style={{ fontSize: 24, margin: '0 0 14px' }}>
            neeshdle
          </p>
          <p className="login-tagline">guess the song from your own playlist in as little audio as possible</p>
          {auth.error && <p className="error">{auth.error}</p>}
          <button className="login-btn" onClick={auth.login}>
            Log in with Spotify
          </button>
          <p className="login-note">Premium required for in-browser playback</p>
        </div>
      )}

      {auth.status === 'authenticated' && (
        <>
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

          {showSwitcher && (
            <ul className="playlist-switcher">
              {!myPlaylists && (
                <li>
                  <span className="hint" style={{ padding: '10px 14px', display: 'block' }}>
                    Loading your playlists…
                  </span>
                </li>
              )}
              {myPlaylists?.map((p) => (
                <li key={p.id}>
                  <button onClick={() => switchPlaylist(p.id)} disabled={p.id === activePlaylistId}>
                    {p.thumbnailUrl ? (
                      <img src={p.thumbnailUrl} alt="" className="thumb" />
                    ) : (
                      <div className="thumb" />
                    )}
                    <span style={{ flex: 1 }}>{p.name}</span>
                    {p.id === activePlaylistId && (
                      <span className="hint" style={{ color: '#2f5233' }}>
                        ACTIVE
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="receipt">
            <div className="grain" />
            <div className="grain-coarse" />
            <div className="grain-wash" />

            <div className="row" style={{ alignItems: 'center', marginBottom: 0 }}>
              <div className="wordmark">
                <BoltIcon />
                <span className="stamp-font">neeshdle</span>
              </div>
              <div className="header-actions">
                <button
                  className="btn-bracket"
                  onClick={() => {
                    setStats(getStatsSummary(userId))
                    setShowStats((v) => !v)
                  }}
                >
                  [ STATS ]
                </button>
                <button className="btn-bracket" onClick={() => setShowSwitcher((v) => !v)}>
                  [ PLAYLIST ]
                </button>
              </div>
            </div>
            <p className="btn-bracket" style={{ textAlign: 'left', paddingLeft: 32, color: '#a8402f', fontSize: 11, opacity: 0.8, margin: '4px 0 14px' }}>
              [ lyl4cs ]
            </p>
            <p className="label" style={{ textAlign: 'center', marginBottom: 18 }}>
              guess it from your own playlist
            </p>

            <hr className="divider" style={{ marginTop: 0 }} />

            {playlistInfo && (
              <div className="row playlist-bar">
                {playlistInfo.thumbnailUrl ? (
                  <img src={playlistInfo.thumbnailUrl} alt="" className="thumb" style={{ width: 30, height: 30 }} />
                ) : (
                  <div className="thumb" style={{ width: 30, height: 30 }} />
                )}
                <span className="playlist-name">{playlistInfo.name}</span>
                <span className="fill" />
                <span className="hint">{pool ? `${pool.length} tracks` : ''}</span>
              </div>
            )}

            {playerError && <p className="error">{playerError}</p>}
            {poolError && <p className="error">Could not load playlist: {poolError}</p>}
            {playerStatus !== 'ready' && !playerError && <p className="hint">Connecting player…</p>}
            {!poolError && !pool && <p className="hint">Loading a track…</p>}

            {readyToPlay && (
              <>
                <div className="waveform">
                  <svg
                    viewBox={`0 0 ${WAVEFORM_WIDTH} ${WAVEFORM_HEIGHT}`}
                    preserveAspectRatio="none"
                    style={{ display: 'block', width: '100%', height: WAVEFORM_HEIGHT }}
                  >
                    <defs>
                      <clipPath id="wfUnlocked">
                        <rect x="0" y="0" width={unlockedX} height={WAVEFORM_HEIGHT} />
                      </clipPath>
                    </defs>
                    <g fill="#c9c5b6">
                      {WAVEFORM_HEIGHTS.map((h, i) => (
                        <rect
                          key={i}
                          x={i * BAR_SPACING}
                          y={(WAVEFORM_HEIGHT - h) / 2}
                          width={BAR_SPACING * 0.55}
                          height={h}
                        />
                      ))}
                    </g>
                    <g fill="#1a1a1a" clipPath="url(#wfUnlocked)">
                      {WAVEFORM_HEIGHTS.map((h, i) => (
                        <rect
                          key={i}
                          x={i * BAR_SPACING}
                          y={(WAVEFORM_HEIGHT - h) / 2}
                          width={BAR_SPACING * 0.55}
                          height={h}
                        />
                      ))}
                    </g>
                  </svg>

                  {STAGES.map((stage, i) => {
                    const attempt = attempts[i]
                    let state = i <= unlockedIndex ? 'empty' : 'locked'
                    if (attempt?.correct) state = 'correct'
                    else if (attempt?.kind === 'skip') state = 'skip'
                    else if (attempt) state = 'wrong'
                    else if (i === unlockedIndex && !over) state = 'current'
                    const leftPct = (MARKER_POSITIONS[i] / WAVEFORM_WIDTH) * 100
                    return (
                      <div key={stage} style={{ position: 'absolute', left: `${leftPct}%`, top: 0, bottom: 0 }}>
                        <div className="wf-mark" />
                        <div className={`wf-badge ${state === 'current' ? 'current' : ''} ${state === 'locked' ? 'locked' : ''}`}>
                          {state === 'correct' && <CheckIcon />}
                          {state === 'wrong' && <XIcon />}
                          {state === 'skip' && <SkipIcon />}
                        </div>
                        <div className={`wf-time ${i === unlockedIndex && !over ? 'active' : ''}`}>
                          {formatStageShort(stage)}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <p className="clip-label">
                  {over
                    ? won
                      ? 'You got it — play the full track'
                      : 'Out of guesses — play the answer'
                    : `Clip ${unlockedIndex + 1} of ${STAGES.length}: ${formatClip(currentStage)}`}
                </p>

                <div className="actions">
                  <button className="stamp-btn play-btn" onClick={playClip} disabled={busy}>
                    <svg width="84" height="84" viewBox="0 0 84 84" style={{ position: 'absolute' }}>
                      <path
                        d="M40,4 C56,2 74,8 80,26 C86,42 78,60 64,72 C50,84 30,86 16,76 C2,66 -2,46 4,30 C10,14 24,6 40,4 Z"
                        fill="#1a1a1a"
                        style={{ filter: 'url(#rough)', transform: 'rotate(-5deg)', transformOrigin: 'center' }}
                      />
                    </svg>
                    <span className="label-overlay" style={{ color: '#f4f1e6', fontSize: 12, transform: 'rotate(-5deg)' }}>
                      {busy ? 'PLAYING…' : over ? '▶ PLAY SONG' : '▶ PLAY'}
                    </span>
                  </button>
                  {!over && (
                    <button className="stamp-btn skip-btn" onClick={skip} disabled={busy}>
                      <svg width="96" height="52" viewBox="0 0 96 52" style={{ position: 'absolute' }}>
                        <path
                          d="M6,8 C30,2 66,4 90,7 C94,18 93,34 90,45 C64,50 28,49 5,44 C2,32 3,18 6,8 Z"
                          fill="none"
                          stroke="#1a1a1a"
                          strokeWidth="2.5"
                          style={{ filter: 'url(#rough)', transform: 'rotate(3deg)', transformOrigin: 'center' }}
                        />
                      </svg>
                      <span className="label-overlay" style={{ fontSize: 13, transform: 'rotate(3deg)' }}>
                        SKIP →
                      </span>
                    </button>
                  )}
                </div>
                {playError && <p className="error">{playError}</p>}

                <div className="row offset-control">
                  <span className="label">skip silent intro</span>
                  <span className="fill" />
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
                  <span className="hint">s</span>
                </div>

                {!over && (
                  <>
                    <div className="label term-label">enter guess</div>
                    <div className="term-input">
                      <span>&gt;</span>
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="search for a song"
                        disabled={busy}
                        autoComplete="off"
                      />
                    </div>
                    {searchBusy && <p className="hint">searching…</p>}
                    <ul className="results">
                      {(query.trim() ? searchResults : []).map((track) => (
                        <li key={track.id}>
                          <button onClick={() => submitGuess(track)} disabled={busy}>
                            {track.thumbnailUrl ? (
                              <img src={track.thumbnailUrl} alt="" className="thumb" />
                            ) : (
                              <div className="thumb" />
                            )}
                            <div>
                              <div className="result-name">{track.name}</div>
                              <div className="result-artist">{track.artists}</div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {attempts.length > 0 && (
                  <>
                    <hr className="divider" />
                    <p className="label" style={{ marginBottom: 10 }}>
                      history
                    </p>
                    <ul className="history">
                      {attempts.map((attempt, i) => (
                        <li key={i} className="result-line">
                          {attempt.kind === 'skip' ? (
                            <>
                              <span className="mark-skip">—</span> Skipped{' '}
                              <span className="stage-dur">({formatClip(STAGES[i])})</span>
                            </>
                          ) : (
                            <>
                              <span className={attempt.correct ? '' : 'mark-wrong'}>
                                {attempt.correct ? '✓' : '✕'}
                              </span>{' '}
                              {attempt.track.name} — {attempt.track.artists}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="barcode" />
                <p className="label" style={{ textAlign: 'center' }}>
                  thank you for playing
                </p>
              </>
            )}
          </div>
        </>
      )}

      {over && currentTrack && (
        <div className="result-overlay">
          <div className="receipt result-card">
            <div className="grain" />
            <div className="grain-coarse" />
            <div className="grain-wash" />

            <div className="stamp-wrap">
              <svg width="190" height="78" viewBox="0 0 190 78" style={{ position: 'absolute' }}>
                <rect
                  x="6"
                  y="6"
                  width="178"
                  height="66"
                  fill="none"
                  stroke={won ? '#2f5233' : '#8b2c1a'}
                  strokeWidth="3"
                  style={{ filter: 'url(#rough)', transform: 'rotate(-6deg)', transformOrigin: 'center' }}
                />
              </svg>
              <div className={`stamp-label ${won ? '' : 'lose'}`}>{won ? 'CORRECT' : 'WRONG'}</div>
            </div>
            {won && winClipSeconds != null && <p className="win-time">guessed in {winClipSeconds}s of audio</p>}

            {currentTrack.thumbnailUrl ? (
              <img src={currentTrack.thumbnailUrl} alt="" className="reveal-thumb" />
            ) : (
              <div className="reveal-thumb" />
            )}
            <p className="reveal-name">{currentTrack.name}</p>
            <p className="reveal-artist">{currentTrack.artists}</p>

            <div className="reveal-actions">
              <button className="stamp-btn new-song-btn" onClick={startNewSong}>
                <svg width="112" height="46" viewBox="0 0 112 46" style={{ position: 'absolute' }}>
                  <path
                    d="M6,6 C38,2 76,3 106,6 C109,16 108,30 106,40 C74,44 36,43 6,39 C3,28 4,16 6,6 Z"
                    fill="#1a1a1a"
                    style={{ filter: 'url(#rough)', transform: 'rotate(-3deg)', transformOrigin: 'center' }}
                  />
                </svg>
                <span className="label-overlay" style={{ color: '#f4f1e6', transform: 'rotate(-3deg)' }}>
                  NEW SONG
                </span>
              </button>
              <button className="stamp-btn play-full-btn" onClick={playClip} disabled={busy}>
                <svg width="140" height="46" viewBox="0 0 140 46" style={{ position: 'absolute' }}>
                  <path
                    d="M6,7 C46,2 96,3 134,7 C137,17 136,30 134,39 C92,44 42,43 6,38 C3,27 4,16 6,7 Z"
                    fill="none"
                    stroke="#1a1a1a"
                    strokeWidth="2.5"
                    style={{ filter: 'url(#rough)', transform: 'rotate(2deg)', transformOrigin: 'center' }}
                  />
                </svg>
                <span className="label-overlay" style={{ transform: 'rotate(2deg)' }}>
                  {busy ? 'PLAYING…' : 'PLAY FULL TRACK'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
