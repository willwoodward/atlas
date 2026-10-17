import { describe, it, expect } from 'vitest'
import { goalTime, goalWeeks } from '../goalTime.js'

const goals = [
  { id: 'g1', title: 'Fitness', color: '#6f8168', tags: 'gym, swim' },
  { id: 'g2', title: 'Masters', color: '#5f7591', tags: '[masters]' },
]
const ev = (date, title, start, dur) => ({ date, title, start, dur })
// Thursday 15 Oct 2026, 10:00. Week runs Mon 12 – Sun 18.
const now = new Date(2026, 9, 15, 10, 0)

describe('goalTime for a given week', () => {
  it('counts a past week as fully spent', () => {
    const events = [ev('2026-10-05', 'Gym', 7, 1), ev('2026-10-07', 'Read [masters]', 19, 2), ev('2026-10-12', 'Gym', 7, 1)]
    const t = goalTime(events, goals, now, new Date(2026, 9, 5))
    expect(t.spent).toBe(3)
    expect(t.planned).toBe(3)
  })
})

describe('goalWeeks', () => {
  const events = [
    ev('2026-09-28', 'Swim', 7, 1.5),        // 3 weeks ago
    ev('2026-10-06', 'Gym', 7, 1),           // last week
    ev('2026-10-08', 'Essay [masters]', 9, 2),
    ev('2026-10-13', 'Gym', 7, 1),           // this week, done
    ev('2026-10-17', 'Swim', 9, 1),          // this week, still to come
    ev('2026-10-14', 'Lunch', 12, 1),        // no goal
  ]

  it('returns one row per week, oldest first, ending with this week', () => {
    const w = goalWeeks(events, goals, 4, now)
    expect(w.map(r => r.week)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'])
    expect(w.map(r => r.current)).toEqual([false, false, false, true])
  })

  it('totals each week by goal', () => {
    const w = goalWeeks(events, goals, 4, now)
    expect(w.map(r => r.spent)).toEqual([0, 1.5, 3, 1])
    const last = w[2].perGoal.map(p => [p.goal.id, p.spent])
    expect(last).toEqual([['g1', 1], ['g2', 2]])
  })

  it('splits this week into done and still planned', () => {
    const cur = goalWeeks(events, goals, 4, now)[3]
    expect([cur.spent, cur.planned]).toEqual([1, 2])
  })
})
