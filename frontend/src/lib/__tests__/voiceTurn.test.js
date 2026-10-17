import { describe, it, expect } from 'vitest'
import { endsMidThought, extraPause } from '../voiceTurn.js'

describe('endsMidThought', () => {
  it.each([
    ['move my dentist appointment to', true],
    ['add milk and', true],
    ['um', true],
    ["what's on today", false],
    ['what is on today?', false],
    ['remind me about the bank.', false],
    ['', false],
  ])('%s → %s', (text, want) => expect(endsMidThought(text)).toBe(want))
  it('waits longer only mid-thought', () => {
    expect(extraPause('book it for')).toBe(1.5)
    expect(extraPause('book it for Tuesday')).toBe(0)
  })
})
