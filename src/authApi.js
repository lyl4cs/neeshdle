async function request(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json' },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export function signup({ username, email, password }) {
  return request('/api/signup', { method: 'POST', body: JSON.stringify({ username, email, password }) })
}

export function login({ username, password }) {
  return request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export function logout() {
  return request('/api/logout', { method: 'POST' })
}

// Called on mount to restore login state from the session cookie — resolves
// to {username} if logged in, or null (not thrown) if not, since "logged
// out" is an expected steady state here, not a failure.
export async function getCurrentUser() {
  try {
    return await request('/api/me', { method: 'GET' })
  } catch {
    return null
  }
}
