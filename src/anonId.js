// Public mode has no login, so stats need some per-browser identity to key
// on — a random id persisted locally, distinct from a Spotify user id.
const KEY = 'heardle_anon_id'

export function getAnonId() {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = `anon_${crypto.randomUUID()}`
    localStorage.setItem(KEY, id)
  }
  return id
}
