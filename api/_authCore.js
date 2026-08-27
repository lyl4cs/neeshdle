import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { ensureSchema, sql } from './_db.js'
import { clearCookie, parseCookie, serializeCookie } from './_cookies.js'
import { isRateLimited } from './_rateLimit.js'

const scrypt = promisify(scryptCallback)

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derivedKey = await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${derivedKey.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [scheme, nStr, rStr, pStr, saltHex, hashHex] = stored.split(':')
  if (scheme !== 'scrypt') return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const derivedKey = await scrypt(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  })
  return derivedKey.length === expected.length && timingSafeEqual(derivedKey, expected)
}

// Precomputed once so a login attempt for a nonexistent username still pays
// the same scrypt cost as a real one — otherwise the response-time
// difference would leak whether a username exists.
const DUMMY_PASSWORD_HASH = hashPassword('not-a-real-account-password-placeholder')

const SESSION_COOKIE_NAME = 'neeshdle_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

function signSessionId(sessionId, secret) {
  return createHmac('sha256', secret).update(sessionId).digest('base64url')
}

async function createSession(userId, { secret, secure }) {
  const sessionId = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${sessionId}, ${userId}, ${expiresAt.toISOString()})`
  const signature = signSessionId(sessionId, secret)
  return serializeCookie(SESSION_COOKIE_NAME, `${sessionId}.${signature}`, {
    maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    secure,
  })
}

function splitSessionCookie(cookieHeader) {
  const value = parseCookie(cookieHeader, SESSION_COOKIE_NAME)
  if (!value) return null
  const dotIndex = value.lastIndexOf('.')
  if (dotIndex === -1) return null
  return { sessionId: value.slice(0, dotIndex), signature: value.slice(dotIndex + 1) }
}

// Exported for api/_statsCore.js — every authenticated endpoint needs to
// resolve a cookie header into a user before doing anything else.
export async function verifySessionCookie(cookieHeader, { secret }) {
  const parts = splitSessionCookie(cookieHeader)
  if (!parts) return null

  const expectedSignature = signSessionId(parts.sessionId, secret)
  const sigBuf = Buffer.from(parts.signature)
  const expectedBuf = Buffer.from(expectedSignature)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null

  await ensureSchema()
  const rows = await sql`
    SELECT sessions.user_id AS "userId", users.username FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ${parts.sessionId} AND sessions.expires_at > now()
  `
  return rows[0] ?? null
}

async function destroySession(cookieHeader) {
  const parts = splitSessionCookie(cookieHeader)
  if (!parts) return
  await sql`DELETE FROM sessions WHERE id = ${parts.sessionId}`
}

export async function destroyAllSessionsForUser(userId) {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`
}

function clearSessionCookie({ secure }) {
  return clearCookie(SESSION_COOKIE_NAME, { secure })
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateSignupInput({ username, email, password }) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-20 characters: letters, numbers, or underscore.'
  }
  if (typeof email !== 'string' || email.length > 200 || !EMAIL_RE.test(email)) {
    return 'Enter a valid email address.'
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return 'Password must be at least 8 characters.'
  }
  return null
}

// All four handlers return { status, body, cookie? } — transport-agnostic,
// same shape as api/_suggestSongsCore.js's handleSuggestSongs, so the thin
// Vercel handlers and the Vite dev middleware can forward them identically.

export async function handleSignup({ username, email, password, ip, secret, secure }) {
  if (isRateLimited('signup', ip, { windowMs: 60 * 60 * 1000, max: 20 })) {
    return { status: 429, body: { error: 'Too many signups from this connection — try again later.' } }
  }

  const validationError = validateSignupInput({ username, email, password })
  if (validationError) return { status: 400, body: { error: validationError } }

  try {
    await ensureSchema()
    const existing = await sql`
      SELECT id FROM users WHERE lower(username) = lower(${username}) OR lower(email) = lower(${email})
    `
    if (existing.length > 0) {
      return { status: 409, body: { error: 'That username or email is already taken.' } }
    }

    const passwordHash = await hashPassword(password)
    const rows = await sql`
      INSERT INTO users (username, email, password_hash) VALUES (${username}, ${email}, ${passwordHash})
      RETURNING id
    `
    const cookie = await createSession(rows[0].id, { secret, secure })
    return { status: 200, body: { username }, cookie }
  } catch (err) {
    if (err.code === '23505') {
      // Unique-constraint race: two signups for the same name landed between
      // the SELECT check above and this INSERT.
      return { status: 409, body: { error: 'That username or email is already taken.' } }
    }
    console.error('[auth] signup failed', err)
    return { status: 500, body: { error: 'Signup failed.' } }
  }
}

export async function handleLogin({ username, password, ip, secret, secure }) {
  const usernameKey = typeof username === 'string' ? username.toLowerCase() : ''
  if (isRateLimited('login', `${ip}:${usernameKey}`, { windowMs: 15 * 60 * 1000, max: 10 })) {
    return { status: 429, body: { error: 'Too many attempts — try again later.' } }
  }

  if (typeof username !== 'string' || typeof password !== 'string') {
    return { status: 400, body: { error: 'Invalid username or password.' } }
  }

  try {
    await ensureSchema()
    const rows = await sql`SELECT id, password_hash AS "passwordHash" FROM users WHERE lower(username) = lower(${username})`
    const user = rows[0] ?? null
    const hashToCompare = user ? user.passwordHash : await DUMMY_PASSWORD_HASH
    const passwordOk = await verifyPassword(password, hashToCompare)

    if (!user || !passwordOk) {
      return { status: 401, body: { error: 'Invalid username or password.' } }
    }

    const cookie = await createSession(user.id, { secret, secure })
    return { status: 200, body: { username }, cookie }
  } catch (err) {
    console.error('[auth] login failed', err)
    return { status: 500, body: { error: 'Login failed.' } }
  }
}

export async function handleLogout({ cookieHeader, secure }) {
  try {
    await ensureSchema()
    await destroySession(cookieHeader)
    return { status: 200, body: { ok: true }, cookie: clearSessionCookie({ secure }) }
  } catch (err) {
    console.error('[auth] logout failed', err)
    return { status: 500, body: { error: 'Logout failed.' } }
  }
}

export async function handleMe({ cookieHeader, secret }) {
  try {
    const session = await verifySessionCookie(cookieHeader, { secret })
    if (!session) return { status: 401, body: { error: 'Not logged in.' } }
    return { status: 200, body: { username: session.username } }
  } catch (err) {
    console.error('[auth] me failed', err)
    return { status: 500, body: { error: 'Request failed.' } }
  }
}
