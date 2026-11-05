// @vitest-environment jsdom
// Each open to-do gets one decision, which is applied at once and can be undone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.React = React

const todoApi = { toggleTodo: vi.fn(), moveTodo: vi.fn(), removeTodo: vi.fn(), todos: [] }
vi.mock('../../../context/TodosContext.jsx', () => ({ useTodos: () => todoApi }))
vi.mock('../../../context/GoalsContext.jsx', () => ({ useGoals: () => ({ goals: [{ id: 'g1', title: 'Fitness', color: '#6f8168' }] }) }))
vi.mock('../../../hooks/useIsMobile.js', () => ({ useIsMobile: () => false }))

import TodosStep from '../TodosStep.jsx'

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString()
const recap = { todos: { finished: [{ id: 'f1', text: 'Sent invoice' }], insights: [] } }

let root, container
function Harness() {
  const [memo, setMemo] = useState({ items: null, decisions: {} })
  return <TodosStep recap={recap} narrative={false} memo={memo} setMemo={setMemo} />
}
const text = () => container.textContent
const click = async (label, nth = 0) => {
  const b = [...container.querySelectorAll('button')].filter(x => x.textContent === label)[nth]
  await act(async () => { b.click() })
}

beforeEach(async () => {
  Object.values(todoApi).forEach(f => f.mockClear?.())
  todoApi.todos = [
    { id: 'old', text: 'File taxes', bucket: 'week', goalId: 'g1', done: false, parentId: null, createdAt: daysAgo(30) },
    { id: 'new', text: 'Buy milk', bucket: 'today', goalId: null, done: false, parentId: null, createdAt: daysAgo(1) },
    { id: 'sub', text: 'A sub-task', bucket: 'week', done: false, parentId: 'old', createdAt: daysAgo(1) },
    { id: 'fin', text: 'Already done', bucket: 'week', done: true, parentId: null, createdAt: daysAgo(3) },
    { id: 'sd', text: 'Someday thing', bucket: 'someday', done: false, parentId: null, createdAt: daysAgo(90) },
  ]
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<Harness />) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('TodosStep', () => {
  it('lists open to-dos in today and this week, oldest first, without sub-tasks or someday', () => {
    const t = text()
    expect(t.indexOf('File taxes')).toBeLessThan(t.indexOf('Buy milk'))
    expect(t).not.toContain('A sub-task')
    expect(t).not.toContain('Someday thing')
    expect(t).toContain('open 4w')
    expect(t).toContain('Been here a while')
    expect(t).toContain('Fitness')
    expect(t).toContain('Sent invoice')
  })

  it('applies a decision at once and keeps the row, with an undo', async () => {
    await click('Done')
    expect(todoApi.toggleTodo).toHaveBeenCalledWith('old')
    expect(text()).toContain('Marked done')
    await act(async () => { todoApi.todos = todoApi.todos.map(t => t.id === 'old' ? { ...t, done: true } : t) })
    expect(text()).toContain('File taxes')                         // not pulled out from under you
    await click('Undo')
    expect(todoApi.toggleTodo).toHaveBeenCalledTimes(2)
    expect(text()).not.toContain('Marked done')
  })

  it('moves a today to-do to this week when kept, and back on undo; leaves a this-week one where it is', async () => {
    await click('Next week', 0)                                     // File taxes, already this week
    expect(todoApi.moveTodo).not.toHaveBeenCalled()
    await click('Next week', 0)                                     // Buy milk (the first one is now decided)
    expect(todoApi.moveTodo).toHaveBeenCalledWith('new', 'week')
    await click('Undo', 1)
    expect(todoApi.moveTodo).toHaveBeenLastCalledWith('new', 'today')
  })

  it('moves to someday and can put it back', async () => {
    await click('Someday', 0)
    expect(todoApi.moveTodo).toHaveBeenCalledWith('old', 'someday')
    await click('Undo')
    expect(todoApi.moveTodo).toHaveBeenLastCalledWith('old', 'week')
  })

  it('only deletes after a second tap', async () => {
    await click('Drop', 0)
    expect(todoApi.removeTodo).not.toHaveBeenCalled()
    await click('Sure?')
    expect(todoApi.removeTodo).toHaveBeenCalledWith('old')
    expect(text()).toContain('Dropped')
  })
})
