import { describe, it, expect } from 'vitest'
import { buildIndex, searchItems, snippet } from '../search.js'

const today = new Date(2026, 9, 17)
const index = buildIndex({
  notes: [
    { id: 'n1', body: '# Train times\nThe 8:10 into town takes 30 minutes', updatedAt: '2026-10-10' },
    { id: 'n2', body: 'Shopping list\nmilk, eggs, train tickets?', updatedAt: '2026-09-01' },
  ],
  githubTree: [{ path: 'masters/thesis-plan.md', type: 'blob' }, { path: 'img/logo.png', type: 'blob' }],
  todos: [
    { id: 't1', text: 'Book train to Galway', bucket: 'week', done: false },
    { id: 't2', text: 'Check seat', bucket: 'week', done: true, parentId: 't1' },
  ],
  goals: [{ id: 'g1', title: 'Masters', tags: '[masters]', color: '#5f7591', quarters: { Q4: 'Finish the thesis draft' } }],
  habits: [{ id: 'h1', name: 'Morning walk', color: '#6f8168' }],
  events: [
    { id: 'e1', title: 'Train to Dublin', date: '2026-10-19', timeDisplay: '8 AM', color: '#5f7591' },
    { id: 'e1', title: 'Train to Dublin', date: '2026-10-19', timeDisplay: '8 AM' },  // cached twice
    { id: 'e2', title: 'Train to Cork', date: '2025-03-02', timeDisplay: '9 AM' },
  ],
  transactions: [{ id: 'x1', merchant: 'Irish Rail', category: 'Transport', amount: 12, date: '2026-10-01', type: 'expense' }],
})
const kinds = r => r.map(g => g.kind)
const titles = (r, kind) => r.find(g => g.kind === kind)?.items.map(i => i.title) || []

describe('searchItems', () => {
  it('finds a word across every kind of thing', () => {
    const r = searchItems(index, 'train', { today })
    expect(kinds(r)).toEqual(expect.arrayContaining(['note', 'todo', 'event']))
    expect(titles(r, 'note')[0]).toBe('Train times')          // title match beats a body match
  })

  it('needs every word to match', () => {
    const r = searchItems(index, 'train dublin', { today })
    expect(kinds(r)).toEqual(['event'])
  })

  it('puts nearer dates first and shows a repeated event once', () => {
    expect(titles(searchItems(index, 'train to', { today }), 'event')).toEqual(['Train to Dublin', 'Train to Cork'])
  })

  it('searches tags, goal focus, categories and note paths', () => {
    expect(titles(searchItems(index, 'thesis', { today }), 'goal')).toEqual(['Masters'])
    expect(titles(searchItems(index, 'thesis', { today }), 'note')).toEqual(['thesis-plan'])
    expect(titles(searchItems(index, 'transport', { today }), 'transaction')).toEqual(['Irish Rail'])
  })

  it('skips non-markdown files and points sub-tasks at their parent', () => {
    expect(searchItems(index, 'logo', { today })).toEqual([])
    const sub = searchItems(index, 'seat', { today })[0].items[0]
    expect(sub.target).toEqual({ kind: 'todo', id: 't1' })
    expect(sub.subtitle).toContain('Book train to Galway')
  })

  it('finds pages by name and by what is on them', () => {
    expect(titles(searchItems(index, 'shortcuts', { today }), 'page')).toEqual(['Settings'])
  })

  it('returns nothing for an empty query', () => {
    expect(searchItems(index, '   ', { today })).toEqual([])
  })
})

describe('snippet', () => {
  it('shows the text around the match', () => {
    expect(snippet('a '.repeat(80) + 'the thesis draft is due', 'thesis', 40)).toMatch(/^….*thesis draft/)
  })
})
