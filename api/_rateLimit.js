// In-memory, per-process — resets on cold start and isn't shared across
// concurrent serverless instances, so this is a best-effort speed bump
// against casual abuse, not a hard guarantee. If any endpoint using this
// sees real abuse, replace with a shared store (Vercel KV / Upstash).
const requestLogs = new Map()

export function isRateLimited(bucket, key, { windowMs, max }) {
  const log = requestLogs.get(bucket) ?? new Map()
  requestLogs.set(bucket, log)

  const now = Date.now()
  const timestamps = (log.get(key) ?? []).filter((t) => now - t < windowMs)
  timestamps.push(now)
  log.set(key, timestamps)
  return timestamps.length > max
}
