import { getAnonId } from './anonId'
import { getStatsSummary, recordRound } from './stats'

// Both backends expose the same async interface, so PublicMode.jsx always
// awaits statsBackend.recordRound(...)/getStatsSummary() and never knows
// which one it's talking to.

export function createLocalStatsBackend() {
  const userId = getAnonId()
  return {
    recordRound: (args) => Promise.resolve(recordRound(userId, args)),
    getStatsSummary: () => Promise.resolve(getStatsSummary(userId)),
  }
}

export function createServerStatsBackend() {
  return {
    recordRound: async ({ track, correct, clipSeconds }) => {
      const res = await fetch('/api/record-round', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ track, correct, clipSeconds }),
      })
      if (!res.ok) console.error('[statsBackend] record-round failed', res.status)
    },
    getStatsSummary: async () => {
      const res = await fetch('/api/stats')
      if (!res.ok) throw new Error('Could not load stats')
      return res.json()
    },
  }
}
