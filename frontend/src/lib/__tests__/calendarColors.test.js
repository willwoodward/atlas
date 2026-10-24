import { describe, it, expect } from 'vitest'
import { gcalColorNameFor, gcalColorIdFor, isValidPattern, atlasNameForHex } from '../calendarColors.js'

const cfg = {
  rules: [
    { pattern: '^\\s*(lunch|dinner)\\s*$', color: 'default' },
    { pattern: '(', color: 'tomato' },
    { pattern: '\\bgym\\b|run', color: 'blueberry' },
    { pattern: '\\bwith\\b', color: 'flamingo' },
  ],
  fallback: 'lavender',
}

describe('calendar colour rules', () => {
  it('takes the first matching rule, ignoring case', () => {
    expect(gcalColorNameFor('GYM with Tom', cfg)).toBe('blueberry')
    expect(gcalColorNameFor('Lunch with Sam', cfg)).toBe('flamingo')
    expect(gcalColorNameFor('Lunch', cfg)).toBe('default')
    expect(gcalColorNameFor('Admin', cfg)).toBe('lavender')
  })
  it('gives Google colour ids, with null for the calendar default', () => {
    expect(gcalColorIdFor('Gym', cfg)).toBe('9')
    expect(gcalColorIdFor('Dinner', cfg)).toBe(null)
    expect(gcalColorIdFor('Admin', cfg)).toBe('1')
  })
  it('skips patterns that do not compile', () => {
    expect(isValidPattern('(')).toBe(false)
    expect(isValidPattern('')).toBe(false)
    expect(isValidPattern('a|b')).toBe(true)
  })
  it('names Atlas colours from a local event hex', () => {
    expect(atlasNameForHex('#6F8168')).toBe('sage')
    expect(atlasNameForHex('#123456')).toBe('')
  })
})
