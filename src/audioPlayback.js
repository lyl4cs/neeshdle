// Local <audio> playback is a synchronous, local browser API — no network
// round-trip per command like Spotify Connect had, so this doesn't need
// timing.js's elaborate "poll until we see true playback start" dance.
// currentTime is authoritative and immediate.
export async function playPublicStage({ audioEl, previewUrl, targetMs, startOffsetMs = 0 }) {
  if (audioEl.src !== previewUrl) {
    audioEl.src = previewUrl
    await new Promise((resolve, reject) => {
      const onReady = () => {
        audioEl.removeEventListener('loadedmetadata', onReady)
        audioEl.removeEventListener('error', onError)
        resolve()
      }
      const onError = () => {
        audioEl.removeEventListener('loadedmetadata', onReady)
        audioEl.removeEventListener('error', onError)
        reject(new Error('Failed to load audio preview'))
      }
      audioEl.addEventListener('loadedmetadata', onReady)
      audioEl.addEventListener('error', onError)
      audioEl.load()
    })
  }

  audioEl.currentTime = startOffsetMs / 1000
  await audioEl.play()

  if (targetMs === 'full') return

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      audioEl.removeEventListener('ended', onEnded)
      audioEl.pause()
      resolve()
    }
    const onEnded = () => finish()
    const timeoutId = setTimeout(finish, targetMs)
    audioEl.addEventListener('ended', onEnded)
  })
}
