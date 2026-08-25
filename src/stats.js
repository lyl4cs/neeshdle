// Lifetime stats across all rounds, persisted locally. One entry gets
// recorded per finished round (win or loss) — see recordRound.

const STORAGE_KEY = 'heardle_stats_v1'

function readRounds() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []
  } catch {
    return []
  }
}

function primaryArtist(artists) {
  return artists?.split(',')[0]?.trim() ?? null
}

export function recordRound({ track, correct, clipSeconds }) {
  const rounds = readRounds()
  rounds.push({
    trackName: track.name,
    artist: primaryArtist(track.artists),
    correct,
    clipSeconds: correct ? clipSeconds : null,
    timestamp: Date.now(),
  })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds))
}

export function getStatsSummary() {
  const rounds = readRounds()
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
