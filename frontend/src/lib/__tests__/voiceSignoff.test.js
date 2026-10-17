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

  it.each([
    'Brilliant, thanks very much.',
    'Perfect, thank you!',
    'Great stuff, cheers Atlas',
    'Thanks so much',
    "That's great, thanks a lot.",
    'Amazing, thanks mate',
  ])('ends on thanks alone: “%s”', said => {
    expect(checkSignOff(said)).toEqual({ end: true, rest: '' })
  })

  it('does not end on praise without thanks, or thanks with a request', () => {
    expect(checkSignOff('Perfect').end).toBe(false)
    expect(checkSignOff('Thanks, now add gym at 7 tomorrow').end).toBe(false)
    expect(checkSignOff('Great, can you move the gym to 7').end).toBe(false)
    expect(checkSignOff('Thanks, what is on tomorrow?').end).toBe(false)
    expect(checkSignOff('Cheers, add milk to my list').end).toBe(false)
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
