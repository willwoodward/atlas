// Category breakdowns for the spending / income donuts.

export const UNCATEGORISED = 'Uncategorised'
export const OTHER = 'Other'

// Named slices per chart; everything past them folds into "Other".
export const MAX_SLICES = 5
// CSS custom properties defined in index.css (light + dark).
export const SLOT_COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)']
export const OTHER_COLOR = 'var(--cat-other)'
export const NONE_COLOR = 'var(--cat-none)'

export const PERIODS = [
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: '3m', label: '3 months' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
]

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Inclusive local-date range for a period key; null bounds mean open-ended.
export function periodRange(key, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth()
  switch (key) {
    // Rolling: today and the 29 days before — same window as the headline
    // income / spending figures.
    case '30d': return { from: ymd(new Date(y, m, now.getDate() - 29)), to: ymd(now) }
    case 'month': return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) }
    case 'last-month': return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) }
    case '3m': return { from: ymd(new Date(y, m - 2, 1)), to: ymd(new Date(y, m + 1, 0)) }
    case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` }
    default: return { from: null, to: null }
  }
}

const categoryOf = (t) => (t.category || '').trim() || UNCATEGORISED

// Totals per category for one type ('expense' | 'income') within a range,
// largest first. `value` converts a transaction into the display currency.
export function categoryTotals(transactions, type, value, range = {}) {
  const totals = new Map()
  for (const t of transactions) {
    if (t.type !== type) continue
    if (range.from && t.date < range.from) continue
    if (range.to && t.date > range.to) continue
    const v = value(t)
    if (v == null) continue
    const c = categoryOf(t)
    totals.set(c, (totals.get(c) || 0) + v)
  }
  return [...totals].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)
}

// Category → colour, fixed from all-time totals so a category keeps its colour
// whichever period is selected (switching period never repaints the chart).
export function colorMap(transactions, type, value) {
  const named = categoryTotals(transactions, type, value).filter(r => r.category !== UNCATEGORISED)
  const map = new Map(named.slice(0, MAX_SLICES).map((r, i) => [r.category, SLOT_COLORS[i]]))
  map.set(UNCATEGORISED, NONE_COLOR)
  return map
}

// Slices for the donut: categories with a colour of their own, then
// Uncategorised, then everything else folded into Other.
export function slices(totals, colors) {
  const named = [], rest = []
  let none = null
  for (const r of totals) {
    if (r.category === UNCATEGORISED) none = { ...r, color: NONE_COLOR }
    else if (colors.has(r.category)) named.push({ ...r, color: colors.get(r.category) })
    else rest.push(r)
  }
  const out = [...named]
  if (none) out.push(none)
  if (rest.length) out.push({ category: OTHER, total: rest.reduce((s, r) => s + r.total, 0), color: OTHER_COLOR, members: rest.map(r => r.category) })
  return out
}

// A starting pattern for "categorise everything like this": the merchant's
// first word, or first two when the first is too short to be distinctive.
export function suggestPattern(merchant = '') {
  const words = merchant.toLowerCase().replace(/[^a-z0-9&' ]+/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  return (words[0].length < 4 && words[1] ? `${words[0]} ${words[1]}` : words[0])
}
