import { neon } from '@neondatabase/serverless'

// Lazy, not read at module load: vite.config.js statically imports the auth/
// stats core modules (which import this file) before its own top-level code
// runs loadEnv() to populate process.env.POSTGRES_URL for local dev — reading
// it at import time would capture undefined. Deferring the neon() call until
// the first actual query (always inside a request handler) avoids that.
// neon()'s sql tagged-template returns rows as a plain array directly
// (unlike node-postgres's {rows: [...]} shape) — every query call site in
// this codebase relies on that.
let sqlClient = null

function sql(strings, ...values) {
  if (!sqlClient) sqlClient = neon(process.env.POSTGRES_URL)
  return sqlClient(strings, ...values)
}

// Schema is applied lazily on first use rather than via a migration step —
// small enough (4 tables) that CREATE TABLE IF NOT EXISTS is simpler than
// adding a migration framework, and it self-provisions a fresh dev database
// on the first request that touches it.
let schemaReady = null

export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
      .then(() => sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username))`)
      .then(() => sql`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email))`)
      .then(
        () => sql`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        )
      `,
      )
      .then(
        () => sql`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ
        )
      `,
      )
      .then(
        () => sql`
        CREATE TABLE IF NOT EXISTS rounds (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          track_name TEXT NOT NULL,
          artist TEXT,
          correct BOOLEAN NOT NULL,
          clip_seconds REAL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `,
      )
      .then(() => sql`CREATE INDEX IF NOT EXISTS rounds_user_id_idx ON rounds(user_id)`)
      .catch((err) => {
        schemaReady = null // let the next call retry instead of caching a failure
        throw err
      })
  }
  return schemaReady
}

export { sql }
