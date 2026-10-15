import { describe, it, expect } from 'vitest'
import { mergeThread, memoryEdit, reduceMessage } from '../AssistantContext.jsx'

const server = (...turns) => turns.flatMap(([id, q, a, status = 'done']) => [
  { role: 'user', content: q, runId: id },
  { role: 'assistant', content: a, runId: id, status },
])

describe('mergeThread', () => {
  it('shows turns sent from another device', () => {
    const next = mergeThread([], server(['r1', 'Hi', 'Hello!']))
    expect(next.map(m => [m.role, m.content])).toEqual([['user', 'Hi'], ['assistant', 'Hello!']])
  })

  it('keeps the detail of turns this device watched', () => {
    const local = [
      { role: 'user', content: 'Hi', runId: 'r1' },
      { role: 'assistant', content: 'Hello!', runId: 'r1', tools: [{ name: 'list_events' }] },
    ]
    expect(mergeThread(local, server(['r1', 'Hi', 'Hello!']))).toBe(local)
    const grown = mergeThread(local, server(['r1', 'Hi', 'Hello!'], ['r2', 'And tomorrow?', 'Free.']))
    expect(grown[1].tools).toEqual([{ name: 'list_events' }])
    expect(grown).toHaveLength(4)
  })

  it('empties when the session has gone stale', () => {
    expect(mergeThread([{ role: 'user', content: 'Hi', runId: 'r1' }], [])).toEqual([])
  })

  it('resets a running turn so replaying its events does not double the text', () => {
    const local = [
      { role: 'user', content: 'Go', runId: 'r1' },
      { role: 'assistant', content: 'Half an ans', runId: 'r1', tools: [] },
    ]
    const next = mergeThread(local, server(['r1', 'Go', '', 'running']))
    expect(next[1]).toEqual({ role: 'assistant', content: '', tools: [], runId: 'r1' })
  })

  it('carries the error of a turn that produced no text', () => {
    const next = mergeThread([], [
      { role: 'user', content: 'Go', runId: 'r1' },
      { role: 'assistant', content: '', runId: 'r1', status: 'error', error: 'Model unavailable' },
    ])
    expect(next[1].error).toBe('Model unavailable')
  })
})

describe('memoryEdit', () => {
  it('reads the version to undo to from a memory tool result', () => {
    expect(memoryEdit('edit_memory', '{"ok": true, "version": 5, "previous_version": 4}')).toEqual({ kind: 'memory', version: 5, previous: 4 })
    expect(memoryEdit('write_memory', '{"ok": true, "version": 1, "previous_version": 0}')).toEqual({ kind: 'memory', version: 1, previous: 0 })
    expect(memoryEdit('edit_system_prompt', '{"ok": true, "version": 7, "previous_version": 0}')).toEqual({ kind: 'prompt', version: 7, previous: 0 })
  })

  it('ignores failures, no-ops and other tools', () => {
    expect(memoryEdit('edit_memory', '{"error": "old_text was not found"}')).toBeUndefined()
    expect(memoryEdit('edit_memory', '{"ok": true, "version": 3, "previous_version": 3, "unchanged": true}')).toBeUndefined()
    expect(memoryEdit('add_todo', '{"ok": true, "version": 1}')).toBeUndefined()
    expect(memoryEdit('edit_memory', 'not json')).toBeUndefined()
  })

  it('is attached to the tool when its result arrives', () => {
    let m = { role: 'assistant', content: '', tools: [] }
    m = reduceMessage(m, { type: 'tool', name: 'edit_memory', toolUseId: 't1' })
    m = reduceMessage(m, { type: 'tool_result', toolUseId: 't1', status: 'success', output: '{"ok": true, "version": 2, "previous_version": 1}' })
    expect(m.tools[0].memory).toEqual({ kind: 'memory', version: 2, previous: 1 })
  })
})
