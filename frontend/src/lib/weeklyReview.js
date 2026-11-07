// The weekly review: which week it is about, and the small pure pieces the
// screens are built from.

import { addDays, shiftWeek, weekKey, parseLocalDate, mondayOf } from './week.js'
import { goalTime } from './goalTime.js'

export const STEPS = [
  { id: 'week',   label: 'Your week' },
  { id: 'money',  label: 'Money' },
  { id: 'goals',  label: 'Goals' },
  { id: 'habits', label: 'Habits' },
  { id: 'todos',  label: 'To-dos' },
  { id: 'plan',   label: 'Reflect & plan' },
]

/**
 * The week a review started now is about, and how pressing it is.
 *   Sunday          → this week, due.
 *   Monday–Wednesday → last week, which is "missed" until it's done.
 *   Thursday–Saturday → this week so far, an early start (never nagging).
 */
export function reviewTarget(now = new Date()) {
  const day = now.getDay()
  const current = weekKey(now)
  if (day === 0) return { week: current, phase: 'due' }
  if (day <= 3) return { week: shiftWeek(current, -1), phase: 'missed' }
  return { week: current, phase: 'early' }
}

/** Whether a week is still going (its Sunday hasn't ended). */
export const weekIsOpen = (week, now = new Date()) => week >= weekKey(now)

/** How many weeks before the current one `week` is (0 for this week). */
export function weeksAgo(week, now = new Date()) {
  const ms = mondayOf(now) - parseLocalDate(week)
  return Math.round(ms / (7 * 24 * 3600 * 1000))
}

// ─── Opening screen ───────────────────────────────────────────────────────────

const pct = (n) => `${Math.round(n * 100)}%`

/**
 * The big figures on the first screen. Each has a `delta` line comparing it with
 * how the week usually goes, so the number means something. A tile with nothing
 * to show is left out rather than shown as zero.
 */
export function overviewTiles({ habits, todos, money }, goalHours, fmtMoney) {
  const tiles = []
  // "up from 60%", "down from 6", "same as 4": the direction in words, so the
  // arrow isn't the only thing saying it.
  const versus = (now, before, show, noun) =>
    now === before ? `same as ${noun}` : `${now > before ? 'up' : 'down'} from ${show(before)} ${noun}`
  if (habits.possible > 0) {
    const has = habits.prev_rate != null
    tiles.push({ key: 'habits', label: 'Habits', value: `${habits.done}/${habits.possible}`, sub: 'check-ins',
                 delta: has ? versus(habits.rate, habits.prev_rate, pct, 'the week before') : null, tone: 'var(--sage)',
                 better: has ? habits.rate >= habits.prev_rate : null })
  }
  const had = todos.prev_finished_count > 0
  tiles.push({
    key: 'todos', label: 'To-dos', value: String(todos.finished_count), sub: 'finished',
    delta: had ? versus(todos.finished_count, todos.prev_finished_count, String, 'the week before') : null, tone: 'var(--blue)',
    better: had ? todos.finished_count >= todos.prev_finished_count : null,
  })
  if (money.count > 0) {
    const has = money.usual_spent != null
    tiles.push({
      key: 'money', label: 'Spent', value: fmtMoney(money.spent), sub: money.income ? `${fmtMoney(money.income)} came in` : 'this week',
      delta: has ? `${money.spent === money.usual_spent ? 'same as' : money.spent > money.usual_spent ? 'above' : 'below'} your usual ${fmtMoney(money.usual_spent)}` : null, tone: 'var(--gold)',
      // Spending less than usual is the "better" direction.
      better: has ? money.spent <= money.usual_spent : null,
    })
  }
  const hours = goalHours.reduce((s, g) => s + g.hours, 0)
  if (hours > 0) tiles.push({ key: 'goals', label: 'Goal time', value: fmtHours(hours), sub: 'on your goals', delta: null, tone: 'var(--mauve)', better: null })
  return tiles
}

export function fmtHours(h) {
  if (!h) return '0h'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${Math.round(h * 10) / 10}h`.replace('.0h', 'h')
}

/** The best good news and the most pressing warning across every section. */
export function headlines(recap) {
  const all = ['goals', 'habits', 'todos', 'money'].flatMap(s => recap[s].insights.map(i => ({ ...i, section: s })))
  return { good: all.find(i => i.kind === 'good') || null, warn: all.find(i => i.kind === 'warn') || null }
}

/** "5 days", "3 weeks" — how long a to-do has been open. */
export function ageLabel(days) {
  if (days == null) return ''
  if (days < 1) return 'today'
  if (days < 14) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

// ─── Reflection prompts ───────────────────────────────────────────────────────

/**
 * Questions to write under, led by what the week actually showed: a habit that
 * slipped, a to-do that sat, spending that jumped. The general ones fill the rest.
 */
export function reflectionPrompts(recap) {
  const out = []
  const habit = recap.habits.insights.find(i => i.kind === 'warn' && i.ref?.type === 'habit')
  if (habit) {
    const name = recap.habits.habits.find(h => h.id === habit.ref.id)?.name
    if (name) out.push(`What got in the way of “${name}”?`)
  }
  const stale = recap.todos.open.find(t => (t.age_days ?? 0) >= 14)
  if (stale) out.push(`Why has “${stale.text}” sat so long, and what would move it?`)
  if (recap.money.insights.some(i => i.kind === 'warn')) out.push('What drove the spending this week?')
  const quiet = recap.goals.insights.find(i => i.kind === 'warn')
  if (quiet) out.push('Which goal did I neglect, and is that a choice or a drift?')
  for (const p of ['What went well?', 'What drained me?', 'What did I learn?', 'What will I do differently next week?']) {
    if (out.length < 6) out.push(p)
  }
  return out
}

// ─── Calendar time on goals ───────────────────────────────────────────────────

const round1 = (n) => Math.round(n * 10) / 10

/**
 * Hours on each goal in a week, with the average of the weeks before as its
 * "usual". Matched from the calendar by each goal's tags, so goals without tags
 * show zero. [{ id, goal, hours, usual }]
 */
export function goalHoursFor(events, goals, week, weeksBack = 4) {
  const monday = parseLocalDate(week)
  // A whole week at a time: `now` is its Sunday, so nothing is "still to come".
  const at = (m) => goalTime(events, goals, addDays(m, 6), m)
  const current = at(monday)
  const before = Array.from({ length: weeksBack }, (_, i) => at(addDays(monday, -7 * (i + 1))))
  return current.perGoal.map((r, i) => ({
    id: r.goal.id, goal: r.goal.title, hours: round1(r.planned),
    usual: round1(before.reduce((s, w) => s + w.perGoal[i].planned, 0) / weeksBack),
  }))
}

/** One line on how a goal's calendar time compares with usual, or null if unremarkable. */
export function goalHourNote({ goal, hours, usual }) {
  if (hours === 0 && usual === 0) return { kind: 'warn', text: `Nothing on the calendar for “${goal}” in over a month.` }
  if (usual >= 1 && hours === 0) return { kind: 'warn', text: `No calendar time on “${goal}” this week. You usually give it about ${fmtHours(usual)}.` }
  if (usual >= 1 && hours < usual * 0.5) return { kind: 'warn', text: `Only ${fmtHours(hours)} on “${goal}”, about half its usual ${fmtHours(usual)}.` }
  if (usual > 0 && hours >= 1 && hours >= usual * 1.5) return { kind: 'good', text: `${fmtHours(hours)} on “${goal}”, well above its usual ${fmtHours(usual)}.` }
  return null
}
