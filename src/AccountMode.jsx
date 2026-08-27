import { useCallback, useEffect, useState } from 'react'
import { getCurrentUser, login, logout, signup } from './authApi'
import { BoltIcon } from './icons'
import PublicMode from './PublicMode'
import { createServerStatsBackend } from './statsBackend'

export default function AccountMode({ onBack }) {
  const [checking, setChecking] = useState(true)
  const [username, setUsername] = useState(null)
  const [playing, setPlaying] = useState(false)

  const [authMode, setAuthMode] = useState('login')
  const [usernameInput, setUsernameInput] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getCurrentUser().then((user) => {
      if (cancelled) return
      setUsername(user?.username ?? null)
      setChecking(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result =
        authMode === 'signup'
          ? await signup({ username: usernameInput, email: emailInput, password: passwordInput })
          : await login({ username: usernameInput, password: passwordInput })
      setUsername(result.username)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [authMode, usernameInput, emailInput, passwordInput])

  const handleLogout = useCallback(async () => {
    await logout().catch(() => {})
    setUsername(null)
    setPlaying(false)
  }, [])

  if (checking) {
    return (
      <div className="app">
        <p className="hint" style={{ textAlign: 'center', marginTop: 40 }}>
          Loading…
        </p>
      </div>
    )
  }

  // "back" out of the game returns here (account home), not to the login
  // form and not out of the app entirely — logging out is its own explicit
  // action so pausing a session never forces re-entering credentials.
  if (username && playing) {
    return (
      <PublicMode
        onBack={() => setPlaying(false)}
        statsBackend={createServerStatsBackend()}
        modeLabel={`account: ${username}`}
      />
    )
  }

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

      {username ? (
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
          <p className="login-tagline">logged in as {username}</p>
          <button className="login-btn" onClick={() => setPlaying(true)} style={{ marginBottom: 10 }}>
            Play
          </button>
          <button className="btn-bracket" onClick={handleLogout}>
            [ log out ]
          </button>
        </div>
      ) : (
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
          <p className="login-tagline">
            {authMode === 'signup' ? 'create a neeshdle account' : 'log in to your neeshdle account'}
          </p>

          <div className="term-input" style={{ margin: '14px 0 8px' }}>
            <span>&gt;</span>
            <input
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="username"
              disabled={busy}
              autoComplete="username"
            />
          </div>
          {authMode === 'signup' && (
            <div className="term-input" style={{ margin: '0 0 8px' }}>
              <span>&gt;</span>
              <input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="email"
                disabled={busy}
                autoComplete="email"
              />
            </div>
          )}
          <div className="term-input" style={{ margin: '0 0 14px' }}>
            <span>&gt;</span>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="password"
              disabled={busy}
              autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit()
              }}
            />
          </div>

          {error && <p className="error">{error}</p>}

          <button className="login-btn" onClick={handleSubmit} disabled={busy} style={{ marginBottom: 10 }}>
            {busy ? 'Please wait…' : authMode === 'signup' ? 'Sign up' : 'Log in'}
          </button>
          <button
            className="btn-bracket"
            onClick={() => {
              setAuthMode((m) => (m === 'signup' ? 'login' : 'signup'))
              setError(null)
            }}
            disabled={busy}
          >
            {authMode === 'signup' ? '[ already have an account? log in ]' : '[ new here? sign up ]'}
          </button>
        </div>
      )}
    </div>
  )
}
