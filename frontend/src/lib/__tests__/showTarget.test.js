import { describe, it, expect } from 'vitest'
import { showTarget } from '../focus.js'
import { readToolResult, reduceMessage } from '../../context/AssistantContext.jsx'

describe('showTarget', () => {
  it('maps what a tool points at to a page and a focus target', () => {
    expect(showTarget({ kind: 'event', id: 'e1', date: '2026-11-02' })).toEqual({ page: 'calendar', target: { kind: 'event', id: 'e1', date: '2026-11-02' } })
    expect(showTarget({ kind: 'finances', category: 'Groceries', range: { from: 'a', to: 'b' }, type: 'expense' }))
      .toEqual({ page: 'finances', target: { kind: 'finances', category: 'Groceries', range: { from: 'a', to: 'b' }, type: 'expense' } })
    expect(showTarget({ kind: 'page', page: 'goals' })).toEqual({ page: 'goals', target: null })
    expect(showTarget({ kind: 'github', path: 'a/b.md' }).target).toEqual({ kind: 'github', path: 'a/b.md' })
    expect(showTarget({ kind: 'nonsense' })).toBeNull()
  })
})

describe('readToolResult', () => {
  it('picks out the undo id, card and show', () => {
    const out = JSON.stringify({ ok: true, undo_id: 'abc', card: { type: 'day' }, show: { kind: 'calendar', date: 'x' } })
    expect(readToolResult(out)).toEqual({ undoId: 'abc', card: { type: 'day' }, show: { kind: 'calendar', date: 'x' } })
  })
  it('ignores text, cut-off JSON and plain results', () => {
    expect(readToolResult('Error: nope')).toEqual({})
    expect(readToolResult('{"ok": true, "card": {"type"')).toEqual({})
    expect(readToolResult('{"ok": true}')).toEqual({ undoId: undefined, card: undefined, show: undefined })
  })
  it('is attached to the tool when its result arrives', () => {
    let m = { role: 'assistant', content: '', tools: [] }
    m = reduceMessage(m, { type: 'tool', name: 'add_todo', toolUseId: 't1' })
    m = reduceMessage(m, { type: 'tool_result', toolUseId: 't1', status: 'success', output: '{"ok": true, "undo_id": "u9"}' })
    expect(m.tools[0].undoId).toBe('u9')
  })
  it('opens an inbox item', () => {
    expect(showTarget({ kind: 'inbox', id: 'abc' })).toEqual({ page: 'inbox', target: { kind: 'inbox', id: 'abc' } })
    expect(showTarget({ kind: 'inbox' })).toEqual({ page: 'inbox', target: null })
    expect(showTarget({ kind: 'routine', id: 'r1' })).toEqual({ page: 'inbox', target: { kind: 'routine', id: 'r1' } })
  })
})

describe('agents page', () => {
  it('opens an agent or a skill', () => {
    expect(showTarget({ kind: 'agent', id: 'researcher' })).toEqual({ page: 'agents', target: { kind: 'agent', id: 'researcher' } })
    expect(showTarget({ kind: 'skill', id: 'trip' })).toEqual({ page: 'agents', target: { kind: 'skill', id: 'trip' } })
  })
})
