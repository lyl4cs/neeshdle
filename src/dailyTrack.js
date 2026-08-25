// Deterministic pick from the pool, seeded by UTC calendar date — everyone
// opening the app on the same day gets the same track, with no backend or
// persistence needed to guarantee it.
export function pickDailyTrack(tracks) {
  if (!tracks || tracks.length === 0) return null
  const now = new Date()
  const utcDayNumber = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000,
  )
  return tracks[utcDayNumber % tracks.length]
}

// Random pick for "New song" — excludes the current track (when possible)
// so hitting the button doesn't just hand you the same song back.
export function pickRandomTrack(tracks, excludeId) {
  if (!tracks || tracks.length === 0) return null
  const candidates = tracks.length > 1 ? tracks.filter((t) => t.id !== excludeId) : tracks
  return candidates[Math.floor(Math.random() * candidates.length)]
}
