// One simple session cookie, no exotic attributes needed — not worth adding
// the `cookie` package for this.

export function parseCookie(header, name) {
  if (!header) return null
  const match = header.split(';').find((part) => part.trim().startsWith(`${name}=`))
  if (!match) return null
  return decodeURIComponent(match.trim().slice(name.length + 1))
}

export function serializeCookie(name, value, { maxAgeSeconds, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (maxAgeSeconds != null) parts.push(`Max-Age=${maxAgeSeconds}`)
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearCookie(name, { secure }) {
  return serializeCookie(name, '', { maxAgeSeconds: 0, secure })
}
