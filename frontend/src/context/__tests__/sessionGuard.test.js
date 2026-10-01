import { describe, it, expect } from 'vitest'
import { isAppToken, rejectsSession } from '../sessionGuard.js'

const future = Math.floor(Date.now() / 1000) + 3600

describe('isAppToken', () => {
  it('accepts an unexpired token with the app audience', () => {
    expect(isAppToken({ aud: 'atlas-app', exp: future })).toBe(true)
  })

  it('rejects a token minted before the audience claim existed', () => {
    // The case that left the app looking signed in while every request 401'd.
    expect(isAppToken({ exp: future })).toBe(false)
  })

  it('rejects an MCP token and an expired one', () => {
    expect(isAppToken({ aud: 'atlas-mcp', exp: future })).toBe(false)
    expect(isAppToken({ aud: 'atlas-app', exp: 1 })).toBe(false)
    expect(isAppToken(null)).toBe(false)
  })
})

describe('rejectsSession', () => {
  const base = {
    input: 'https://api.example/api/todos',
    init: { headers: { Authorization: 'Bearer t1' } },
    status: 401,
    token: 't1',
    apiOrigin: 'https://api.example',
    pageOrigin: 'https://app.example',
  }

  it('flags a 401 from the API for the current token', () => {
    expect(rejectsSession(base)).toBe(true)
  })

  it('reads the header from a Headers instance', () => {
    expect(rejectsSession({ ...base, init: { headers: new Headers({ Authorization: 'Bearer t1' }) } })).toBe(true)
  })

  it('ignores other statuses', () => {
    expect(rejectsSession({ ...base, status: 403 })).toBe(false)
    expect(rejectsSession({ ...base, status: 200 })).toBe(false)
  })

  it('ignores Google Calendar not being connected', () => {
    expect(rejectsSession({ ...base, input: 'https://api.example/auth/gcal/token' })).toBe(false)
  })

  it('ignores other origins, such as Google or GitHub', () => {
    expect(rejectsSession({ ...base, input: 'https://www.googleapis.com/calendar/v3/x' })).toBe(false)
  })

  it('ignores a late response sent with a previous token', () => {
    expect(rejectsSession({ ...base, token: 't2' })).toBe(false)
  })
})
