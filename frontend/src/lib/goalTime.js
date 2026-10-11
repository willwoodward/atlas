import { localDateStr, mondayOf, addDays } from './week.js'

export const parseTags = (tags = '') =>
  tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)

// Whole-word, case-insensitive match that also works for tags like "[masters]",
// where \b would fail next to the brackets.
function matchesTag(title, tag) {
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
 * Hours of this week's calendar spent on each goal, matched by the goal's tags.
 * `spent` is time already elapsed; `planned` includes the rest of the week.
 * Returns { perGoal: [{ goal, spent, planned }], spent, planned, hasTags }.
 */
export function goalTime(events, goals, now = new Date()) {
  const weekStart = localDateStr(mondayOf(now))
  const weekEnd = localDateStr(addDays(mondayOf(now), 6))
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

export const fmtHours = h => {
  if (h === 0) return '0h'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${Math.round(h * 10) / 10}h`.replace('.0h', 'h')
}
