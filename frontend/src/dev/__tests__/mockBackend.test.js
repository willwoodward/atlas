import { describe, it, expect } from 'vitest'
import { bodyFor } from '../mockBackend.js'

/**
 * The mock only has to satisfy one property: every response must be shaped like
 * the thing its context expects. A wrong shape does not fail loudly — it throws
 * inside a `.then`, React unmounts the subtree, and the page the agent is about
 * to measure renders blank. The probe would then report a layout with none of
 * the elements in it and the agent would have no idea why.
 */
describe('bodyFor', () => {
  it('returns arrays for the collection routes', () => {
    for (const path of ['/api/habits', '/api/todos', '/api/goals',
                        '/api/notes', '/api/calendar']) {
      expect(bodyFor(path), path).toEqual([])
    }
  })

  it('gives finances all three keys it destructures', () => {
    // FinancesContext initialises to { pots, transactions, accounts } and reads
    // all three unguarded; a missing key is a crash, not an empty section.
    expect(bodyFor('/api/finances')).toEqual({
      pots: [], transactions: [], accounts: [],
    })
  })

  it('returns an object with .text for a week outcomes route', () => {
    expect(bodyFor('/api/todos/outcomes/2026-W32')).toEqual({ text: '' })
  })

  it('reads as "nothing connected" for integrations', () => {
    const data = bodyFor('/api/integrations')
    expect(data.github).toBeUndefined()
    expect(data.gcal?.connected).toBeFalsy()
  })

  it('wraps assistant runs in the key the context destructures', () => {
    expect(bodyFor('/assistant/runs')).toEqual({ runs: [] })
  })

  it('matches a sub-resource to its parent collection shape', () => {
    expect(bodyFor('/api/finances/pots')).toEqual({})
    expect(bodyFor('/api/todos/42')).toEqual([])
  })

  it('falls back to an array for an unknown route', () => {
    // An array is the safer default: most consumers .map() over the response,
    // and mapping an object throws where reading a key off an array does not.
    expect(bodyFor('/api/something-new')).toEqual([])
  })
})
