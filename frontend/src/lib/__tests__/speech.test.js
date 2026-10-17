import { describe, it, expect } from 'vitest'
import { splitSpeech, speakable, isEcho } from '../speech.js'

describe('splitSpeech', () => {
  it('sends the first sentence on its own as soon as it is complete', () => {
    expect(splitSpeech('You have three things on. The first', { first: true }))
      .toEqual({ chunks: ['You have three things on. '], rest: 'The first' })
  })
  it('holds a sentence that may not be finished', () => {
    expect(splitSpeech('It costs 3.', { first: true }).chunks).toEqual([])
    expect(splitSpeech('It costs 3.5 euros. ', { first: true }).chunks).toEqual(['It costs 3.5 euros. '])
  })
  it('gathers later sentences into longer clips', () => {
    const { chunks } = splitSpeech('One. Two. Three. ')
    expect(chunks).toEqual([])
    expect(splitSpeech('One. Two. Three. ', { final: true }).chunks).toEqual(['One. Two. Three. '])
  })
  it('keeps a code block whole', () => {
    const { chunks, rest } = splitSpeech('Run this:\n```\na = 1.\nb = 2.\n', { first: true })
    expect(chunks).toEqual(['Run this:\n'])
    expect(rest).toBe('```\na = 1.\nb = 2.\n')
  })
  it('cuts a very long run-on at a space', () => {
    const long = 'word '.repeat(150)
    const { chunks, rest } = splitSpeech(long)
    expect(chunks.length).toBe(1)
    expect(chunks[0].length + rest.length).toBe(long.length)
  })
})

describe('speakable', () => {
  it('drops Markdown markers, links and code', () => {
    expect(speakable('**Groceries** is up — see [the breakdown](https://x.y/z) and `code`.'))
      .toBe('Groceries is up — see the breakdown and code.')
    expect(speakable('Run:\n```js\nconsole.log(1)\n```\nDone')).toBe('Run: Done.')
  })
  it('turns list items into sentences', () => {
    expect(speakable('## Today\n- Gym at 7\n- Call mum\n1. Pay rent')).toBe('Today. Gym at 7. Call mum. Pay rent.')
  })
  it('leaves out tables and emoji', () => {
    expect(speakable('Here you go 🎉\n| a | b |\n|---|---|\n| 1 | 2 |')).toBe('Here you go.')
  })
  it('keeps snake_case and single underscores intact', () => {
    expect(speakable('Use my_file_name now.')).toBe('Use my_file_name now.')
    expect(speakable('That is *really* good.')).toBe('That is really good.')
  })
})

describe('isEcho', () => {
  const said = 'You have a dentist appointment at three, then the train into town at five.'
  it('spots Atlas hearing itself', () => {
    expect(isEcho('a dentist appointment at three then the train', said)).toBe(true)
  })
  it('lets the user talk', () => {
    expect(isEcho('move the dentist to Friday please', said)).toBe(false)
    expect(isEcho('yes', 'Shall I add it? Yes or no.')).toBe(false)
  })
})
