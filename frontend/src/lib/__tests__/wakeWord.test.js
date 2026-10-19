import { describe, it, expect } from 'vitest'
import { matchWake } from '../wakeWord/index.js'

const r = (text, conf = 1) => ({ text, result: text.split(' ').map(word => ({ word, conf })) })

describe('the wake word', () => {
  it('wakes on "hey atlas", "atlas" and "ok atlas, …"', () => {
    expect(matchWake(r('hey atlas'))).toMatchObject({ text: 'hey atlas' })
    expect(matchWake(r('atlas'))).toBeTruthy()
    expect(matchWake(r('[unk] atlas [unk]'))).toBeTruthy()
    expect(matchWake(r('atlas [unk]'))).toBeTruthy()
  })
  it('ignores sound-alikes in the middle of a sentence, or said twice', () => {
    expect(matchWake(r('atlas atlas [unk]'))).toBeNull()          // "at last … a lot less"
    expect(matchWake(r('[unk] [unk] atlas'))).toBeNull()          // mid-sentence
    expect(matchWake(r('atlas [unk] [unk] [unk] [unk]'))).toBeNull()   // a long sentence
    expect(matchWake(r('[unk] [unk]'))).toBeNull()
  })
  it('needs more confidence when strict', () => {
    expect(matchWake(r('atlas', 0.8), 0.5)).toBeTruthy()
    expect(matchWake(r('atlas', 0.8), 0)).toBeNull()
    expect(matchWake(r('atlas', 0.5), 1)).toBeTruthy()
  })
})
