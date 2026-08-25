// Random pick, excluding anything already played this session (tracked by
// the caller, e.g. a ref that starts empty on each page load/sign-in — so a
// refresh makes every song fair game again). Falls back to the full pool if
// everything's already been played, rather than getting stuck.
export function pickUnplayedTrack(tracks, playedIds) {
  if (!tracks || tracks.length === 0) return null
  const unplayed = tracks.filter((t) => !playedIds.has(t.id))
  const candidates = unplayed.length > 0 ? unplayed : tracks
  return candidates[Math.floor(Math.random() * candidates.length)]
}
