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
