import { describe, it, expect } from 'vitest'
import { weekKey, shiftWeek, formatWeekRange, staysInBucket, currentWeekTodos, mondayOf } from '../week.js'
import { goalTime, goalForEvent } from '../goalTime.js'
import { layoutOverlaps } from '../calendarLayout.js'

// Thursday 8 Oct 2026, 14:30 local
const NOW = new Date(2026, 9, 8, 14, 30)

describe('week helpers', () => {
  it('keys weeks by their Monday', () => {
    expect(weekKey(NOW)).toBe('2026-10-05')
    expect(weekKey(new Date(2026, 9, 11, 23, 59))).toBe('2026-10-05') // Sunday night
    expect(weekKey(new Date(2026, 9, 12, 0, 1))).toBe('2026-10-12')   // Monday morning
  })
  it('shifts across month and year boundaries', () => {
    expect(shiftWeek('2026-09-28', 1)).toBe('2026-10-05')
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04')
    expect(shiftWeek('2026-03-23', 1)).toBe('2026-03-30') // across the DST change
  })
  it('formats ranges compactly', () => {
    expect(formatWeekRange('2026-10-05')).toMatch(/^5 – 11 Oct/)
    expect(formatWeekRange('2026-09-28')).toMatch(/^28 Sept? – 4 Oct/)
  })
  it('handles Sunday as the end of the week', () => {
    expect(mondayOf(new Date(2026, 9, 11)).getDate()).toBe(5)
  })
})

describe('todo week counting', () => {
  const t = (id, bucket, done, completedAt, extra = {}) => ({ id, bucket, done, completedAt, parentId: null, ...extra })
  const todos = [
    t('open-today', 'today', false, null),
    t('done-today', 'today', true, new Date(2026, 9, 8, 9).toISOString()),
    t('done-today-yesterday', 'today', true, new Date(2026, 9, 7, 9).toISOString()),
    t('done-week-monday', 'week', true, new Date(2026, 9, 5, 9).toISOString()),
    t('done-week-last-week', 'week', true, new Date(2026, 9, 2, 9).toISOString()),
    t('someday', 'someday', false, null),
    t('sub', 'today', false, null, { parentId: 'open-today' }),
  ]
  it('applies the same visibility rule as the To-do page', () => {
    expect(staysInBucket(todos[1], NOW)).toBe(true)
    expect(staysInBucket(todos[2], NOW)).toBe(false)
    expect(staysInBucket(todos[3], NOW)).toBe(true)
    expect(staysInBucket(todos[4], NOW)).toBe(false)
  })
  it('counts today + this week, excluding subtasks, someday and stale done items', () => {
    expect(currentWeekTodos(todos, NOW).map(x => x.id)).toEqual(['open-today', 'done-today', 'done-week-monday'])
  })
})

describe('goal time', () => {
  const goals = [
    { id: 'body', title: 'Healthy Body', tags: 'gym, swim' },
    { id: 'swe', title: 'Learn SWE', tags: '[masters], rust' },
    { id: 'none', title: 'Untagged', tags: '' },
  ]
  it('matches whole words only', () => {
    expect(goalForEvent('Gym session', goals)?.id).toBe('body')
    expect(goalForEvent('Swimming lesson', goals)).toBe(null)
    expect(goalForEvent('[MASTERS] write-up', goals)?.id).toBe('swe')
    expect(goalForEvent('Trust fall', goals)).toBe(null) // "rust" inside a word
  })
  it('splits elapsed and planned time across the week', () => {
    const ev = (date, start, dur, title) => ({ date, start, dur, title })
    const r = goalTime([
      ev('2026-10-06', 7, 1, 'Gym'),           // past day: fully spent
      ev('2026-10-08', 14, 1, 'Swim'),         // today, half elapsed
      ev('2026-10-10', 10, 2, 'Rust study'),   // future: planned only
      ev('2026-10-13', 10, 2, 'Gym'),          // next week: ignored
      { ...ev('2026-10-07', 0, 8, 'Gym'), isBedtime: true },
    ], goals, NOW)
    const body = r.perGoal.find(p => p.goal.id === 'body')
    expect(body.spent).toBeCloseTo(1.5)
    expect(body.planned).toBe(2)
    expect(r.spent).toBeCloseTo(1.5)
    expect(r.planned).toBe(4)
    expect(r.hasTags).toBe(true)
  })
})

describe('overlap layout', () => {
  it('puts overlapping events side by side and widens into free columns', () => {
    const e = (title, start, dur) => ({ title, start, dur })
    const evs = [e('A', 9, 2), e('B', 9.5, 1), e('C', 10, 0.5), e('E', 10.5, 1), e('D', 12, 1)]
    const out = Object.fromEntries([...layoutOverlaps(evs)].map(([ev, l]) => [ev.title, l]))
    expect(out.A).toEqual({ left: 0, width: 1 / 3 })
    expect(out.E.width).toBeCloseTo(2 / 3)
    expect(out.D).toEqual({ left: 0, width: 1 })
  })
})
