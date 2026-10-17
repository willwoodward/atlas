import { describe, it, expect, vi } from 'vitest'
import { createLiveController, chunkAnswer, IDLE_CLOSE_MS } from '../liveSession.js'

function setup() {
  let t = 0
  const sent = [], runs = []
  const close = vi.fn()
  const c = createLiveController({
    emit: e => sent.push(e), close, now: () => t,
    runAtlas: (text, h) => runs.push({ text, h }),
    describeTool: n => ({ list_events: 'Reading your calendar' }[n] || n),
  })
  c.handle({ type: 'session.started', session: { id: 's1' } })
  const say = text => text.split(' ').forEach(w => c.handle({ type: 'session.input_transcript.delta', delta: w + ' ' }))
  return { c, sent, runs, close, say, advance: ms => { t += ms } }
}

describe('fast voice delegation', () => {
  it('runs what the user just said through Atlas and sends back the answer to speak', () => {
    const { c, sent, runs, say } = setup()
    say("what's on tomorrow")
    c.handle({ type: 'session.delegation.created', delegation: { id: 'd1', type: 'delegation', target: 'client' } })
    expect(runs.map(r => r.text)).toEqual(["what's on tomorrow"])
    runs[0].h.onTool('list_events')
    expect(sent[0]).toMatchObject({ type: 'session.thinking.append', delegation_id: 'd1', content: 'Atlas is working on it: Reading your calendar.' })
    runs[0].h.onDone('You have the **dentist** at 10.\n\n- Lunch with Sam at 12:30')
    expect(sent[1]).toMatchObject({ type: 'session.commentary.append', delegation_id: 'd1', content: 'You have the dentist at 10. Lunch with Sam at 12:30.' })
  })

  it('uses the last finished turn when the voice has already started replying', () => {
    const { c, runs, say } = setup()
    say('move the dentist to Friday')
    c.handle({ type: 'session.output_transcript.delta', delta: 'Sure, ' })
    c.handle({ type: 'session.delegation.created', delegation: { id: 'd2', target: 'client' } })
    expect(runs[0].text).toBe('move the dentist to Friday')
  })

  it('does not repeat an old request for a later delegation', () => {
    const { c, runs, sent, say } = setup()
    say('add milk to my list')
    c.handle({ type: 'session.delegation.created', delegation: { id: 'd1', target: 'client' } })
    c.handle({ type: 'session.delegation.created', delegation: { id: 'd2', target: 'client' } })
    expect(runs).toHaveLength(1)
    expect(sent.at(-1)).toMatchObject({ delegation_id: 'd2', type: 'session.commentary.append' })
  })

  it('reports failures so the voice can say so', () => {
    const { c, runs, sent, say } = setup()
    say('book it')
    c.handle({ type: 'session.delegation.created', delegation: { id: 'd1', target: 'client' } })
    runs[0].h.onError('Google Calendar is not connected')
    expect(sent.at(-1).content).toBe('Sorry, that didn\'t work: Google Calendar is not connected.')
  })

  it('ends after a sign-off, once the goodbye has been said', () => {
    vi.useFakeTimers()
    const { c, close, say } = setup()
    say("that's all thanks")
    c.handle({ type: 'session.output_transcript.delta', delta: 'Bye!' })
    expect(c.state().phase).toBe('closing')
    vi.advanceTimersByTime(4000)
    expect(close).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('closes when nobody has said anything for a while', () => {
    vi.useFakeTimers()
    const { c, close, advance } = setup()
    advance(IDLE_CLOSE_MS + 1)
    c.tick()
    vi.advanceTimersByTime(1)
    expect(close).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('stays open while Atlas is still working', () => {
    vi.useFakeTimers()
    const { c, close, say, advance } = setup()
    say('review my spending')
    c.handle({ type: 'session.delegation.created', delegation: { id: 'd1', target: 'client' } })
    advance(IDLE_CLOSE_MS + 1)
    c.tick()
    vi.advanceTimersByTime(10)
    expect(close).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('chunkAnswer', () => {
  it('splits long answers at sentences, under the size limit', () => {
    const parts = chunkAnswer('One two three. '.repeat(200), 300)
    expect(parts.length).toBeGreaterThan(5)
    expect(parts.every(p => p.length <= 300)).toBe(true)
  })
})
