// Kept free of React so the rules can be tested in the node environment.

// Must match AUD_APP in backend/auth.py. The API rejects any token without it,
// including every token minted before the claim was added.
export const APP_AUDIENCE = 'atlas-app'

export function isAppToken(payload) {
  return !!payload && payload.aud === APP_AUDIENCE && payload.exp * 1000 > Date.now()
}

// /auth/gcal/* answers 401 when Google Calendar is not connected or its refresh
// fails. That says nothing about the app session, so it must not sign anyone out.
const NON_SESSION_401_PREFIXES = ['/auth/gcal/']

function bearerOf(input, init) {
  const headers = init?.headers ?? (typeof input === 'object' ? input.headers : undefined)
  if (!headers) return null
  const value = typeof headers.get === 'function'
    ? headers.get('Authorization')
    : headers.Authorization ?? headers.authorization
  return value?.startsWith('Bearer ') ? value.slice(7) : null
}

// True when a response means the API no longer accepts `token`. Requests sent
// with some other token are ignored: a slow request still carrying the previous
// token can land after a fresh sign-in, and must not undo it.
export function rejectsSession({ input, init, status, token, apiOrigin, pageOrigin }) {
  if (status !== 401 || !token) return false
  const url = new URL(typeof input === 'string' ? input : input.url, pageOrigin)
  if (url.origin !== apiOrigin) return false
  if (NON_SESSION_401_PREFIXES.some((p) => url.pathname.startsWith(p))) return false
  return bearerOf(input, init) === token
}
