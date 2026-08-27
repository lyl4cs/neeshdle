import { useCallback, useEffect, useRef, useState } from 'react'
import { STAGES } from './config'
import { CheckIcon, NoteIcon, SkipIcon, XIcon } from './icons'
import { getAnonId } from './anonId'
import { playPublicStage } from './audioPlayback'
import { CURATED_TRACK_IDS } from './curatedTracks'
import { lookupTracks, searchTracks } from './itunesApi'
import { buildPromptPool } from './promptSongs'
import { getStatsSummary, recordRound } from './stats'
import { isSameSong, prioritizePoolMatches } from './trackMatch'
import { pickUnplayedTrack } from './trackPicker'

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

// See SpotifyMode.jsx for the rationale behind this fixed decorative shape.
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

export default function PublicMode({ onBack }) {
  const anonIdRef = useRef(getAnonId())
  const audioRef = useRef(null)
  // Tracks played this page session so a given song won't repeat until a
  // refresh clears it — intentionally in-memory only, not persisted.
  const playedTrackIdsRef = useRef(new Set())

  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState(null)

  const [pool, setPool] = useState(null)
  const [poolPrompt, setPoolPrompt] = useState(null)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [poolExhausted, setPoolExhausted] = useState(false)
  // This pool's rounds only — separate from the lifetime stats in stats.js,
  // shown as a checkpoint when the player leaves the pool (goToNewPool).
  const [sessionResults, setSessionResults] = useState([])
  const [showSessionStats, setShowSessionStats] = useState(false)

  const [showPromptSetup, setShowPromptSetup] = useState(true)
  const [promptInput, setPromptInput] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptSetupError, setPromptSetupError] = useState(null)

  const [attempts, setAttempts] = useState([])
  const [busy, setBusy] = useState(false)
  const [playError, setPlayError] = useState(null)
  const [winClipSeconds, setWinClipSeconds] = useState(null)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchBusy, setSearchBusy] = useState(false)

  const failCount = attempts.filter((a) => !a.correct).length
  const won = attempts.some((a) => a.correct)
  const lost = !won && failCount >= STAGES.length
  const over = won || lost
  const unlockedIndex = Math.min(failCount, STAGES.length - 1)
  const currentStage = STAGES[unlockedIndex]

  const startPool = useCallback((tracks, promptLabel) => {
    playedTrackIdsRef.current = new Set()
    setSessionResults([])
    const pick = pickUnplayedTrack(tracks, playedTrackIdsRef.current)
    if (pick) playedTrackIdsRef.current.add(pick.id)
    setPool(tracks)
    setPoolPrompt(promptLabel)
    setCurrentTrack(pick)
    setPoolExhausted(false)
    setAttempts([])
    setPlayError(null)
    setQuery('')
    setSearchResults([])
    setWinClipSeconds(null)
    setShowPromptSetup(false)
    setShowSessionStats(false)
  }, [])

  const generatePool = useCallback(
    async (text) => {
      if (!text.trim() || promptBusy) return
      setPromptBusy(true)
      setPromptSetupError(null)
      try {
        const tracks = await buildPromptPool(text.trim())
        startPool(tracks, text.trim())
      } catch (err) {
        console.error('[pool] failed to build prompt pool', err)
        setPromptSetupError(err.message)
      } finally {
        setPromptBusy(false)
      }
    },
    [promptBusy, startPool],
  )

  const loadDefaultPool = useCallback(async () => {
    if (promptBusy) return
    setPromptBusy(true)
    setPromptSetupError(null)
    try {
      const tracks = await lookupTracks(CURATED_TRACK_IDS)
      startPool(tracks, "today's top hits")
    } catch (err) {
      console.error('[pool] failed to load default pool', err)
      setPromptSetupError(err.message)
    } finally {
      setPromptBusy(false)
    }
  }, [promptBusy, startPool])

  useEffect(() => {
    if (!query.trim()) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchBusy(true)
      try {
        const results = await searchTracks(query)
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
  }, [query, pool])

  const playClip = useCallback(async () => {
    if (!currentTrack || busy) return
    const targetMs = over ? 'full' : currentStage
    setBusy(true)
    setPlayError(null)
    try {
      await playPublicStage({
        audioEl: audioRef.current,
        previewUrl: currentTrack.previewUrl,
        targetMs,
      })
    } catch (err) {
      console.error('[timing] play failed', err)
      setPlayError(err.message)
    } finally {
      setBusy(false)
    }
  }, [currentTrack, busy, over, currentStage])

  const submitGuess = useCallback(
    (track) => {
      if (!currentTrack || over || busy) return
      const correct = isSameSong(track, currentTrack)
      console.log('[guess]', track.name, '-', track.artists, '->', correct ? 'CORRECT' : 'WRONG')
      if (correct) {
        const clipSeconds = currentStage / 1000
        setWinClipSeconds(clipSeconds)
        recordRound(anonIdRef.current, { track: currentTrack, correct: true, clipSeconds })
        setSessionResults((prev) => [...prev, { correct: true, clipSeconds }])
      } else if (failCount + 1 >= STAGES.length) {
        recordRound(anonIdRef.current, { track: currentTrack, correct: false, clipSeconds: null })
        setSessionResults((prev) => [...prev, { correct: false, clipSeconds: null }])
      }
      setAttempts((prev) => [...prev, { kind: 'guess', track, correct }])
      setSearchResults([])
      setQuery('')
    },
    [currentTrack, over, busy, currentStage, failCount],
  )

  const skip = useCallback(() => {
    if (!currentTrack || over || busy) return
    console.log('[guess] skip')
    if (failCount + 1 >= STAGES.length) {
      recordRound(anonIdRef.current, { track: currentTrack, correct: false, clipSeconds: null })
      setSessionResults((prev) => [...prev, { correct: false, clipSeconds: null }])
    }
    setAttempts((prev) => [...prev, { kind: 'skip', correct: false }])
  }, [currentTrack, over, busy, failCount])

  const startNewSong = useCallback(() => {
    if (!pool) return
    const unplayed = pool.filter((t) => !playedTrackIdsRef.current.has(t.id))
    if (unplayed.length === 0) {
      setPoolExhausted(true)
      return
    }
    const nextTrack = pickUnplayedTrack(pool, playedTrackIdsRef.current)
    if (nextTrack) playedTrackIdsRef.current.add(nextTrack.id)
    setCurrentTrack(nextTrack)
    setAttempts([])
    setPlayError(null)
    setQuery('')
    setSearchResults([])
    setWinClipSeconds(null)
  }, [pool])

  // Without this, currentTrack/attempts from the just-left pool linger in
  // state and the reveal overlay (over && currentTrack) resurfaces the old
  // song once poolExhausted/showSessionStats stop blocking it — clearing
  // them here is what actually makes the prompt screen show cleanly.
  const clearActivePool = useCallback(() => {
    setPool(null)
    setCurrentTrack(null)
    setAttempts([])
    setPoolExhausted(false)
  }, [])

  // Leaving the pool (manually via the header button, or automatically once
  // it's exhausted) checkpoints on a session-stats summary first rather than
  // silently dropping the player back at the prompt screen.
  const goToNewPool = useCallback(() => {
    if (sessionResults.length > 0) {
      setShowSessionStats(true)
    } else {
      clearActivePool()
      setShowPromptSetup(true)
    }
  }, [sessionResults, clearActivePool])

  const confirmNewPool = useCallback(() => {
    setSessionResults([])
    setShowSessionStats(false)
    clearActivePool()
    setShowPromptSetup(true)
  }, [clearActivePool])

  const readyToPlay = Boolean(currentTrack)
  const unlockedX = over ? WAVEFORM_WIDTH : MARKER_POSITIONS[unlockedIndex]

  const sessionWins = sessionResults.filter((r) => r.correct)
  const sessionAvgClip = sessionWins.length
    ? sessionWins.reduce((sum, r) => sum + r.clipSeconds, 0) / sessionWins.length
    : null

  return (
    <div className="app">
      <audio ref={audioRef} style={{ display: 'none' }} />
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

      {showStats && stats && (
        <div className="stats-panel">
          <p className="label" style={{ marginBottom: 8 }}>
            lifetime stats
          </p>
          <p>Total songs guessed: {stats.totalGuessed}</p>
          <p>
            Average clip length guessed within:{' '}
            {stats.avgClipSeconds != null ? `${stats.avgClipSeconds.toFixed(2)}s` : '—'}
          </p>
          <p>Most listened artist: {stats.mostListenedArtist ?? '—'}</p>
        </div>
      )}

      {showPromptSetup && (
        <div className="receipt login-card">
          <div className="grain" />
          <div className="grain-coarse" />
          <div className="grain-wash" />
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <NoteIcon size={34} />
          </div>
          <p className="stamp-font" style={{ fontSize: 24, margin: '0 0 14px' }}>
            neeshdle
          </p>
          <p className="login-tagline">describe the songs you want to guess</p>
          <div className="term-input" style={{ margin: '14px 0' }}>
            <span>&gt;</span>
            <input
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder='e.g. "5 slayyyter songs" or "classic r&b"'
              disabled={promptBusy}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === 'Enter') generatePool(promptInput)
              }}
            />
          </div>
          {promptSetupError && <p className="error">{promptSetupError}</p>}
          <button
            className="login-btn"
            onClick={() => generatePool(promptInput)}
            disabled={promptBusy || !promptInput.trim()}
            style={{ marginBottom: 10 }}
          >
            {promptBusy ? 'Building pool…' : 'Generate pool'}
          </button>
          <button className="btn-bracket" onClick={loadDefaultPool} disabled={promptBusy}>
            [ or play today's top hits ]
          </button>
        </div>
      )}

      {!showPromptSetup && pool && (
      <div className="receipt">
        <div className="grain" />
        <div className="grain-coarse" />
        <div className="grain-wash" />

        <div className="row" style={{ alignItems: 'center', marginBottom: 0 }}>
          <div className="wordmark">
            <NoteIcon />
            <span className="stamp-font">neeshdle</span>
          </div>
          <div className="header-actions">
            <button
              className="btn-bracket"
              onClick={() => {
                setStats(getStatsSummary(anonIdRef.current))
                setShowStats((v) => !v)
              }}
            >
              [ LIFETIME STATS ]
            </button>
            <button className="btn-bracket" onClick={goToNewPool}>
              [ NEW POOL ]
            </button>
          </div>
        </div>
        <p className="btn-bracket" style={{ textAlign: 'left', paddingLeft: 32, color: '#a8402f', fontSize: 11, opacity: 0.8, margin: '4px 0 14px' }}>
          [ public mode ]
        </p>
        <p className="label" style={{ textAlign: 'center', marginBottom: 18 }}>
          {poolPrompt ? `pool: ${poolPrompt}` : 'guess it — no login required'}
        </p>

        <hr className="divider" style={{ marginTop: 0 }} />

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
      )}

      {showSessionStats && (
        <div className="result-overlay">
          <div className="receipt result-card">
            <div className="grain" />
            <div className="grain-coarse" />
            <div className="grain-wash" />
            <p className="stamp-font" style={{ fontSize: 20, textAlign: 'center', margin: '20px 0 14px' }}>
              session stats
            </p>
            <p className="label" style={{ textAlign: 'center' }}>
              {sessionWins.length} of {sessionResults.length} guessed correctly
            </p>
            <p className="label" style={{ textAlign: 'center', marginBottom: 20 }}>
              avg clip: {sessionAvgClip != null ? `${sessionAvgClip.toFixed(2)}s` : '—'}
            </p>
            <div className="reveal-actions">
              <button className="stamp-btn new-song-btn" onClick={confirmNewPool}>
                <svg width="112" height="46" viewBox="0 0 112 46" style={{ position: 'absolute' }}>
                  <path
                    d="M6,6 C38,2 76,3 106,6 C109,16 108,30 106,40 C74,44 36,43 6,39 C3,28 4,16 6,6 Z"
                    fill="#1a1a1a"
                    style={{ filter: 'url(#rough)', transform: 'rotate(-3deg)', transformOrigin: 'center' }}
                  />
                </svg>
                <span className="label-overlay" style={{ color: '#f4f1e6', transform: 'rotate(-3deg)' }}>
                  NEW POOL
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {poolExhausted && !showSessionStats && (
        <div className="result-overlay">
          <div className="receipt result-card">
            <div className="grain" />
            <div className="grain-coarse" />
            <div className="grain-wash" />
            <p className="stamp-font" style={{ fontSize: 20, textAlign: 'center', margin: '20px 0 14px' }}>
              that's every song in this pool!
            </p>
            <p className="label" style={{ textAlign: 'center', marginBottom: 20 }}>
              {pool?.length ?? 0} of {pool?.length ?? 0} played
            </p>
            <div className="reveal-actions">
              <button className="stamp-btn new-song-btn" onClick={goToNewPool}>
                <svg width="112" height="46" viewBox="0 0 112 46" style={{ position: 'absolute' }}>
                  <path
                    d="M6,6 C38,2 76,3 106,6 C109,16 108,30 106,40 C74,44 36,43 6,39 C3,28 4,16 6,6 Z"
                    fill="#1a1a1a"
                    style={{ filter: 'url(#rough)', transform: 'rotate(-3deg)', transformOrigin: 'center' }}
                  />
                </svg>
                <span className="label-overlay" style={{ color: '#f4f1e6', transform: 'rotate(-3deg)' }}>
                  NEW PROMPT
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {over && currentTrack && !poolExhausted && !showSessionStats && (
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
