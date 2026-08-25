// Per-track "audible start" offsets, keyed by Spotify track id. There's no
// way to detect a silent intro automatically — the SDK streams DRM-protected
// audio, so the Web Audio API can't inspect loudness/waveform, and Spotify's
// Audio Analysis endpoint (which used to expose exactly this) is restricted
// for Development Mode apps. So this is manually calibrated once per song
// and remembered from then on.

const STORAGE_KEY = 'heardle_intro_offsets_ms'

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

export function getIntroOffsetMs(trackId) {
  if (!trackId) return 0
  return readAll()[trackId] ?? 0
}

export function setIntroOffsetMs(trackId, offsetMs) {
  const all = readAll()
  all[trackId] = offsetMs
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}
