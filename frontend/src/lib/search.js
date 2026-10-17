// Search across everything Atlas already has loaded in the browser. No
// server round-trip, so results update on every keystroke.
//
// buildIndex() turns the app's data into flat items; searchItems() ranks them
// against a query. Both are pure so they can be tested without React.

export const KINDS = {
  page:        { label: 'Pages',        order: 0 },
  note:        { label: 'Notes',        order: 1 },
  todo:        { label: 'To-dos',       order: 2 },
  event:       { label: 'Calendar',     order: 3 },
  goal:        { label: 'Goals',        order: 4 },
  habit:       { label: 'Habits',       order: 5 },
  transaction: { label: 'Transactions', order: 6 },
}

export const PAGE_ENTRIES = [
  { id: 'home', title: 'Home' }, { id: 'calendar', title: 'Calendar' }, { id: 'habits', title: 'Habits' },
  { id: 'todos', title: 'To-do', also: 'todos tasks' }, { id: 'goals', title: 'Goals' }, { id: 'notes', title: 'Notes' },
  { id: 'finances', title: 'Finances', also: 'money spending budget transactions' }, { id: 'fitness', title: 'Fitness' },
  { id: 'assistant', title: 'Assistant', also: 'atlas chat ai' },
  { id: 'accounts', title: 'Settings', also: 'accounts connections shortcuts keyboard sign out' },
]

const norm = s => (s || '').toLowerCase()
const firstLine = body => (body || '').split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').trim() || 'Untitled'

/**
 * Flatten the app's data into searchable items:
 * { kind, key, title, subtitle, body, page, target, date, color }.
 * `target` is what the page needs to show the item (see lib/focus.js).
 */
export function buildIndex({ notes = [], githubTree = [], todos = [], goals = [], habits = [], events = [], transactions = [], fmtMoney } = {}) {
  const items = []

  for (const p of PAGE_ENTRIES) {
    items.push({ kind: 'page', key: `page:${p.id}`, title: p.title, extra: p.also || '', page: p.id, target: null })
  }

  for (const n of notes) {
    const title = firstLine(n.body)
    items.push({ kind: 'note', key: `note:${n.id}`, title, body: n.body || '', subtitle: 'Quick note',
                 date: (n.updatedAt || n.createdAt || '').slice(0, 10), page: 'notes', target: { kind: 'note', id: n.id } })
  }
  for (const f of githubTree) {
    if (f.type && f.type !== 'blob' && f.type !== 'file') continue
    if (!/\.md$/i.test(f.path)) continue
    const name = f.path.split('/').pop().replace(/\.md$/i, '')
    items.push({ kind: 'note', key: `gh:${f.path}`, title: name, extra: f.path, subtitle: f.path,
                 page: 'notes', target: { kind: 'github', path: f.path } })
  }

  const byId = new Map(todos.map(t => [t.id, t]))
  for (const t of todos) {
    const parent = t.parentId ? byId.get(t.parentId) : null
    items.push({ kind: 'todo', key: `todo:${t.id}`, title: t.text, done: !!t.done,
                 subtitle: [parent ? `in “${parent.text}”` : null, { today: 'Today', week: 'This week', someday: 'Someday' }[t.bucket] || t.bucket, t.done ? 'done' : null].filter(Boolean).join(' · '),
                 // Sub-tasks can be folded away, so point at the parent row.
                 page: 'todos', target: { kind: 'todo', id: parent ? parent.id : t.id } })
  }

  // Events can repeat (recurring, or cached in two weeks) — one per id+date.
  const seen = new Set()
  for (const e of events) {
    if (!e.title || e.isSleepWakeUp) continue
    const k = `${e.id}|${e.date}`
    if (seen.has(k)) continue
    seen.add(k)
    items.push({ kind: 'event', key: `event:${k}`, title: e.title, body: [e.description, e.location, e.notes].filter(Boolean).join(' '),
                 subtitle: [fmtDay(e.date), e.isAllDay ? 'All day' : e.timeDisplay].filter(Boolean).join(' · '),
                 date: e.date, color: e.color, page: 'calendar', target: { kind: 'event', id: e.id, date: e.date } })
  }

  for (const g of goals) {
    const focus = Object.values(g.quarters || {}).filter(Boolean).join(' ')
    items.push({ kind: 'goal', key: `goal:${g.id}`, title: g.title, body: focus, extra: g.tags || '',
                 subtitle: g.tags ? `Tags: ${g.tags}` : 'Goal', color: g.color, page: 'goals', target: { kind: 'goal', id: g.id } })
  }

  for (const h of habits) {
    items.push({ kind: 'habit', key: `habit:${h.id}`, title: h.name || h.title, subtitle: 'Habit', color: h.color,
                 page: 'habits', target: { kind: 'habit', id: h.id } })
  }

  for (const t of transactions) {
    const amount = fmtMoney ? fmtMoney(t) : String(t.amount)
    items.push({ kind: 'transaction', key: `txn:${t.id}`, title: t.merchant || t.description || 'Transaction',
                 extra: [t.category, t.notes].filter(Boolean).join(' '),
                 subtitle: [fmtDay(t.date), t.category].filter(Boolean).join(' · '), meta: amount,
                 date: t.date, page: 'finances', target: { kind: 'transaction', id: t.id } })
  }

  for (const it of items) {
    it.titleN = norm(it.title)
    it.hay = norm([it.title, it.extra, it.body].filter(Boolean).join(' \n '))
  }
  return items
}

function fmtDay(date) {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() && { year: 'numeric' }) })
}

const wordStart = (text, tok) => {
  let i = text.indexOf(tok)
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9]/.test(text[i - 1])) return true
    i = text.indexOf(tok, i + 1)
  }
  return false
}

/** Score one item, or 0 if it doesn't match. Every word of the query must appear. */
export function scoreItem(item, tokens, today = new Date()) {
  let score = 0
  for (const tok of tokens) {
    if (!item.hay.includes(tok)) return 0
    if (item.titleN === tok) score += 100
    else if (item.titleN.startsWith(tok)) score += 60
    else if (wordStart(item.titleN, tok)) score += 40
    else if (item.titleN.includes(tok)) score += 25
    else if (wordStart(item.hay, tok)) score += 12
    else score += 5
  }
  if (item.kind === 'page') score += 10
  if (item.done) score -= 8
  // Nearer dates first: what's coming up or just happened beats last year.
  if (item.date) {
    const days = Math.abs((new Date(item.date + 'T12:00') - today) / 86_400_000)
    score += Math.max(0, 10 - Math.log2(1 + days) * 1.5)
  }
  return score
}

/**
 * Ranked results grouped by kind: [{ kind, label, items }], best group first.
 * At most `perKind` items per group (more for the group the query is mostly about).
 */
export function searchItems(index, query, { perKind = 5, today = new Date() } = {}) {
  const tokens = norm(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const groups = new Map()
  for (const item of index) {
    const s = scoreItem(item, tokens, today)
    if (!s) continue
    if (!groups.has(item.kind)) groups.set(item.kind, [])
    groups.get(item.kind).push({ ...item, score: s })
  }
  return [...groups.entries()]
    .map(([kind, items]) => {
      items.sort((a, b) => b.score - a.score)
      return { kind, label: KINDS[kind]?.label || kind, best: items[0].score, total: items.length, items: items.slice(0, perKind) }
    })
    .sort((a, b) => b.best - a.best || KINDS[a.kind].order - KINDS[b.kind].order)
}

/** A short excerpt of `text` around the first query word, for body matches. */
export function snippet(text, query, width = 90) {
  if (!text) return ''
  const t = text.replace(/\s+/g, ' ')
  const tok = norm(query).split(/\s+/).find(Boolean)
  const i = tok ? t.toLowerCase().indexOf(tok) : -1
  if (i < 0) return ''
  const start = Math.max(0, i - Math.floor(width / 3))
  return (start > 0 ? '…' : '') + t.slice(start, start + width).trim() + (start + width < t.length ? '…' : '')
}
