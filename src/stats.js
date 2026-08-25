// Lifetime stats, one bucket per Spotify user id — there's no backend here,
// so "attached to the user" means keyed by their account id in localStorage
// rather than one shared bucket for whoever's using this browser. One entry
// gets recorded per finished round (win or loss) — see recordRound.

function storageKey(userId) {
  return `heardle_stats_v1_${userId}`
}

function readRounds(userId) {
  if (!userId) return []
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId))) ?? []
  } catch {
    return []
  }
}

function primaryArtist(artists) {
  return artists?.split(',')[0]?.trim() ?? null
}

export function recordRound(userId, { track, correct, clipSeconds }) {
  if (!userId) return
  const rounds = readRounds(userId)
  rounds.push({
    trackName: track.name,
    artist: primaryArtist(track.artists),
    correct,
    clipSeconds: correct ? clipSeconds : null,
    timestamp: Date.now(),
  })
  localStorage.setItem(storageKey(userId), JSON.stringify(rounds))
}

export function getStatsSummary(userId) {
  const rounds = readRounds(userId)
  const wins = rounds.filter((r) => r.correct)

  const artistCounts = {}
  for (const r of rounds) {
    if (!r.artist) continue
    artistCounts[r.artist] = (artistCounts[r.artist] ?? 0) + 1
  }
  let mostListenedArtist = null
  let mostListenedCount = 0
  for (const [artist, count] of Object.entries(artistCounts)) {
    if (count > mostListenedCount) {
      mostListenedArtist = artist
      mostListenedCount = count
    }
  }

  return {
    totalRounds: rounds.length,
    totalGuessed: wins.length,
    avgClipSeconds: wins.length
      ? wins.reduce((sum, r) => sum + r.clipSeconds, 0) / wins.length
      : null,
    mostListenedArtist,
  }
}
