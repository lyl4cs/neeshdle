import { useState } from 'react'
import { NoteIcon } from './icons'
import PublicMode from './PublicMode'
import SpotifyMode from './SpotifyMode'

export default function App() {
  const [mode, setMode] = useState(null)

  if (mode === 'spotify') return <SpotifyMode onBack={() => setMode(null)} />
  if (mode === 'public') return <PublicMode onBack={() => setMode(null)} />

  return (
    <div className="app">
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="rough" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" />
        </filter>
      </svg>

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
        <p className="login-tagline">guess the song in as little audio as possible</p>

        <button className="login-btn" onClick={() => setMode('public')} style={{ marginBottom: 10 }}>
          Play now — no login
        </button>
        <p className="login-note" style={{ marginBottom: 18 }}>
          a small curated pool of songs, works for anyone
        </p>

        <button className="login-btn" onClick={() => setMode('spotify')}>
          Log in with Spotify
        </button>
        <p className="login-note">use your own playlist — Premium required</p>
      </div>
    </div>
  )
}
