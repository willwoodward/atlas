import { localDateStr, mondayOf, addDays } from './week.js'

export const parseTags = (tags = '') =>
  tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)

const escapeRe = s => s.replace(/[.+?^${}()|[\]\\/-]/g, '\\$&')

// A tag with * is a pattern, * meaning "any text": "dinner w/*" matches
// "Dinner w/ Sam". Edges without a * stay anchored to word boundaries like a
// plain tag, so "*run" matches "Long run" but not "Brunch" (the "c" after
// "run" fails the end anchor).
const patternCache = new Map()
function wildcardRe(tag) {
  if (!patternCache.has(tag)) {
    const body = tag.split('*').map(escapeRe).join('.*')
    const start = tag.startsWith('*') ? '' : '(?:^|[^a-z0-9])'
    const end = tag.endsWith('*') ? '' : '(?:$|[^a-z0-9])'
    patternCache.set(tag, new RegExp(start + body + end))
  }
  return patternCache.get(tag)
}

// Whole-word, case-insensitive match that also works for tags like "[masters]",
// where \b would fail next to the brackets.
export function matchesTag(title, tag) {
  if (tag.includes('*')) return tag.replace(/\*/g, '') !== '' && wildcardRe(tag).test(title.toLowerCase())
  const t = title.toLowerCase()
  let i = t.indexOf(tag)
  while (i !== -1) {
    const before = t[i - 1], after = t[i + tag.length]
    const isWord = c => c !== undefined && /[a-z0-9]/.test(c)
    if (!isWord(before) && !isWord(after)) return true
    i = t.indexOf(tag, i + 1)
  }
  return false
}

export function goalForEvent(title, goals) {
  return goals.find(g => parseTags(g.tags).some(tag => matchesTag(title || '', tag))) || null
}

/**
 * Hours of a week's calendar spent on each goal, matched by the goal's tags.
 * `spent` is time already elapsed; `planned` includes the rest of the week.
 * The week is the one containing `now` unless `monday` (a Date) says otherwise.
 * Returns { perGoal: [{ goal, spent, planned }], spent, planned, hasTags }.
 */
export function goalTime(events, goals, now = new Date(), monday = mondayOf(now)) {
  const weekStart = localDateStr(monday)
  const weekEnd = localDateStr(addDays(monday, 6))
  const todayStr = localDateStr(now)
  const nowH = now.getHours() + now.getMinutes() / 60

  const totals = new Map(goals.map(g => [g.id, { goal: g, spent: 0, planned: 0 }]))
  for (const ev of events) {
    if (ev.isAllDay || ev.isSleepWakeUp || ev.isBedtime) continue
    if (ev.date < weekStart || ev.date > weekEnd) continue
    const goal = goalForEvent(ev.title, goals)
    if (!goal) continue
    const elapsed = ev.date < todayStr ? ev.dur
      : ev.date > todayStr ? 0
      : Math.min(Math.max(nowH - ev.start, 0), ev.dur)
    const row = totals.get(goal.id)
    row.planned += ev.dur
    row.spent += elapsed
  }
  const perGoal = [...totals.values()]
  return {
    perGoal,
    spent: perGoal.reduce((s, r) => s + r.spent, 0),
    planned: perGoal.reduce((s, r) => s + r.planned, 0),
    hasTags: goals.some(g => parseTags(g.tags).length > 0),
  }
}

/**
 * Goal time for each of the last `weeks` weeks, oldest first, ending with the
 * current one: [{ week: 'YYYY-MM-DD' (Monday), perGoal, spent, planned, current }].
 */
export function goalWeeks(events, goals, weeks = 12, now = new Date()) {
  const thisMonday = mondayOf(now)
  return Array.from({ length: weeks }, (_, i) => {
    const monday = addDays(thisMonday, (i - weeks + 1) * 7)
    return { week: localDateStr(monday), current: i === weeks - 1, ...goalTime(events, goals, now, monday) }
  })
}

export const fmtHours = h => {
  if (h === 0) return '0h'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${Math.round(h * 10) / 10}h`.replace('.0h', 'h')
}

// The goal shine runs as a wave: goal events light up one after another in
// date/time order, then the whole wave repeats every SHINE_CYCLE seconds.
export const SHINE_CYCLE = 9

const shines = (ev, goals) => ev && !ev.isBedtime && !ev.isSleepWakeUp && !!goalForEvent(ev.title, goals)

// Map(event → { className, shineDelay }) for the events on screen that belong
// to a goal. Gaps shrink when there are many, so the wave always finishes
// well inside one cycle.
export function shineWave(events, goals) {
  const lit = events.filter(ev => shines(ev, goals))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.start - b.start)
  const step = Math.min(0.35, 5 / Math.max(lit.length, 1))
  return new Map(lit.map((ev, i) => [ev, { className: 'goal-shine', shineDelay: `${(i * step).toFixed(2)}s` }]))
}
