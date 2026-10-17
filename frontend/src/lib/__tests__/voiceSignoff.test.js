import { describe, it, expect } from 'vitest'
import { checkSignOff } from '../voiceSignoff.js'

describe('checkSignOff', () => {
  it.each([
    "That's all, thanks.",
    'That is all good thanks',
    'no that is all thanks Atlas',
    "Okay, that's it for now.",
    "I'm done",
    'Stop listening.',
    'Perfect, thank you, bye!',
    'All good, cheers',
  ])('ends on “%s”', said => {
    expect(checkSignOff(said)).toEqual({ end: true, rest: '' })
  })

  it('sends what came before the sign-off', () => {
    expect(checkSignOff("Move my run to 7am tomorrow, that's all thanks"))
      .toEqual({ end: true, rest: 'Move my run to 7am tomorrow' })
  })

  it('does not end on a sign-off phrase in the middle of a request', () => {
    expect(checkSignOff("Is that all the meetings I have on Friday?").end).toBe(false)
    expect(checkSignOff("Remind me I'm done with the essay draft and need to send it").end).toBe(false)
    expect(checkSignOff('Add bye-laws reading to my list').end).toBe(false)
  })

  it('leaves ordinary messages alone', () => {
    expect(checkSignOff('What is on tomorrow?')).toEqual({ end: false, rest: 'What is on tomorrow?' })
    expect(checkSignOff('Thanks, can you also move the gym to 6?').end).toBe(false)
  })
})
