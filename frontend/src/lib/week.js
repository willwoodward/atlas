// Week and date helpers. Weeks run Monday–Sunday and are keyed by the
// Monday's local date string ("2026-10-05"), the same key the backend uses
// for weekly outcomes. Everything is local time — never toISOString, which
// shifts dates across midnight in UTC.

export const localDateStr = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Parse "YYYY-MM-DD" as a local date (new Date(str) would read it as UTC).
export function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function mondayOf(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d
}

export const weekKey = (date = new Date()) => localDateStr(mondayOf(date))

export function shiftWeek(key, n) {
  return localDateStr(addDays(parseLocalDate(key), n * 7))
}

// "6 – 12 Oct", "29 Sep – 5 Oct", "29 Dec 2025 – 4 Jan 2026"
export function formatWeekRange(key) {
  const mon = parseLocalDate(key)
  const sun = addDays(mon, 6)
  const sameYear = mon.getFullYear() === sun.getFullYear()
  const thisYear = sun.getFullYear() === new Date().getFullYear()
  const startOpts = mon.getMonth() === sun.getMonth() && sameYear
    ? { day: 'numeric' }
    : { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }
  const endOpts = { day: 'numeric', month: 'short', ...(thisYear && sameYear ? {} : { year: 'numeric' }) }
  return `${mon.toLocaleDateString('en-GB', startOpts)} – ${sun.toLocaleDateString('en-GB', endOpts)}`
}

// Relative name for a week key, or null if it's not adjacent to this one.
export function relativeWeekLabel(key) {
  const cur = weekKey()
  if (key === cur) return 'This week'
  if (key === shiftWeek(cur, 1)) return 'Next week'
  if (key === shiftWeek(cur, -1)) return 'Last week'
  return null
}

// ─── To-dos ──────────────────────────────────────────────────────────────────

// Local date a todo was completed on (completedAt is an ISO/UTC timestamp).
export function completedOn(t) {
  return t.completedAt ? localDateStr(new Date(t.completedAt)) : null
}

// Whether a todo still shows in its bucket: done items stay visible until the
// day (Today) or week (This week) they were completed in has ended.
export function staysInBucket(t, now = new Date()) {
  if (!t.done) return true
  const d = completedOn(t)
  if (!d) return true
  if (t.bucket === 'today') return d === localDateStr(now)
  if (t.bucket === 'week') return d >= weekKey(now)
  return true
}

// Top-level todos that make up this week's Today + This week lists, using the
// same visibility rule as the To-do page — so a task finished on Tuesday still
// counts towards the week on Friday, and one moved out to Someday drops out.
export function currentWeekTodos(todos, now = new Date()) {
  return todos.filter(t =>
    !t.parentId && (t.bucket === 'today' || t.bucket === 'week') && staysInBucket(t, now))
}
