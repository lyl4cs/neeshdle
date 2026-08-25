// The core instrumentation for the spike: play a track from 0 and measure
// how the actual stop point compares to the target duration.
//
// Two different clocks are in play here, deliberately:
//  - performance.now() wall-clock, for when we *issued* commands and when
//    setTimeout actually fired (this is where jitter/latency shows up).
//  - player.getCurrentState().position, which is the SDK's own read of
//    where the audio engine is — this is "ground truth" for how much audio
//    actually played, independent of when our JS callbacks ran.
//
// Strategy per stage:
//  1. PUT /v1/me/player/play to start the hardcoded track at position_ms 0.
//  2. Poll getCurrentState() every animation frame until we see paused:false
//     with position > 0 — that first non-zero position both confirms audio
//     has truly started (not just that the command was acknowledged) and
//     lets us extrapolate the true start time (now - position).
//  3. Schedule pause() for (targetMs - position-already-elapsed) from now,
//     compensating for however much of the stage already silently played
//     during step 2's polling delay.
//  4. After pause() resolves, read getCurrentState() once more — its
//     position is the actual measured play duration for this stage.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Spotify Connect briefly rejects playback commands with 403 "Restriction
// violated" (reason UNKNOWN) when commands come in too close together —
// seen in practice when clicking through clips/guesses quickly. It's
// transient, so a short retry clears it without surfacing an error for
// what's really just normal fast play.
async function issuePlayCommand(accessToken, deviceId, trackUri, attempt = 0) {
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [trackUri], position_ms: 0 }),
  })
  if (res.ok || res.status === 204) return

  const body = await res.text().catch(() => '')
  const isRestrictionViolation = res.status === 403 && body.includes('Restriction violated')
  if (isRestrictionViolation && attempt < 2) {
    await sleep(400 * (attempt + 1))
    return issuePlayCommand(accessToken, deviceId, trackUri, attempt + 1)
  }
  throw new Error(`Play command failed: ${res.status} ${body}`)
}

export async function playStage({ player, accessToken, deviceId, trackUri, targetMs }) {
  const commandSentAt = performance.now()

  await issuePlayCommand(accessToken, deviceId, trackUri)

  return new Promise((resolve, reject) => {
    let rafId = null
    let intervalId = null
    let timeoutId = null
    let settled = false
    let startedAt = null // performance.now() estimate of true audio start

    const cleanup = () => {
      settled = true
      if (rafId != null) cancelAnimationFrame(rafId)
      if (intervalId != null) clearInterval(intervalId)
      if (timeoutId != null) clearTimeout(timeoutId)
    }

    const finish = (measurement) => {
      if (settled) return
      cleanup()
      resolve(measurement)
    }

    const fail = (err) => {
      if (settled) return
      cleanup()
      reject(err)
    }

    const schedulePauseAfterStart = (state, now) => {
      startedAt = now - state.position
      const alreadyElapsed = state.position
      const remaining = Math.max(0, targetMs - alreadyElapsed)
      timeoutId = setTimeout(async () => {
        try {
          const pauseCalledAt = performance.now()
          await player.pause()
          const finalState = await player.getCurrentState()
          const actualPlayedMs = finalState ? finalState.position : targetMs
          finish({
            targetMs,
            startLatencyMs: startedAt - commandSentAt,
            actualPlayedMs,
            deltaMs: actualPlayedMs - targetMs,
            wallClockFromCommandMs: pauseCalledAt - commandSentAt,
          })
        } catch (err) {
          fail(err)
        }
      }, remaining)
    }

    if (targetMs === 'full') {
      // Start the track and return once audio is actually rolling so the
      // game UI is not locked for the rest of the song.
      intervalId = setInterval(async () => {
        try {
          const state = await player.getCurrentState()
          if (!state) return
          const now = performance.now()
          if (startedAt === null && !state.paused && state.position > 0) {
            startedAt = now - state.position
            finish({
              targetMs: 'full',
              startLatencyMs: startedAt - commandSentAt,
              actualPlayedMs: state.position,
              deltaMs: null,
              wallClockFromCommandMs: now - commandSentAt,
            })
          }
        } catch (err) {
          fail(err)
        }
      }, 250)
      return
    }

    const poll = async () => {
      if (settled) return
      try {
        const state = await player.getCurrentState()
        const now = performance.now()
        if (state && startedAt === null && !state.paused && state.position > 0) {
          schedulePauseAfterStart(state, now)
        }
      } catch (err) {
        fail(err)
        return
      }
      if (!settled && startedAt === null) rafId = requestAnimationFrame(poll)
    }
    rafId = requestAnimationFrame(poll)
  })
}
