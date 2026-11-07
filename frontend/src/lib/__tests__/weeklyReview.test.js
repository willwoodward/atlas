import { describe, it, expect } from 'vitest'
import { ageLabel, goalHourNote, goalHoursFor, headlines, overviewTiles, reflectionPrompts, reviewTarget, STEPS, weeksAgo } from '../weeklyReview.js'

// Nov 2026: Mon 2, Thu 5, Sun 1 and 8.
const at = (d, h = 10) => new Date(2026, 10, d, h)

describe('reviewTarget', () => {
  it('is this week, due, on a Sunday', () => {
    expect(reviewTarget(at(8))).toEqual({ week: '2026-11-02', phase: 'due' })
  })
  it('is last week, missed, from Monday to Wednesday', () => {
    expect(reviewTarget(at(2))).toEqual({ week: '2026-10-26', phase: 'missed' })
    expect(reviewTarget(at(4))).toEqual({ week: '2026-10-26', phase: 'missed' })
  })
  it('is this week, early, from Thursday to Saturday', () => {
    expect(reviewTarget(at(5))).toEqual({ week: '2026-11-02', phase: 'early' })
    expect(reviewTarget(at(7))).toEqual({ week: '2026-11-02', phase: 'early' })
  })
  it('puts a Sunday in the week that started the Monday before', () => {
    expect(reviewTarget(at(1)).week).toBe('2026-10-26')
  })
})

describe('weeksAgo', () => {
  it('counts whole weeks back from now', () => {
    expect(weeksAgo('2026-11-02', at(5))).toBe(0)
    expect(weeksAgo('2026-10-26', at(5))).toBe(1)
    expect(weeksAgo('2026-10-12', at(5))).toBe(3)
  })
})

const recap = (over = {}) => ({
  habits: { done: 28, possible: 35, rate: 0.8, prev_rate: 0.6, habits: [{ id: 'h1', name: 'Run' }], insights: [] },
  todos: { finished_count: 4, prev_finished_count: 9, open: [], insights: [] },
  money: { count: 12, spent: 300, income: 2000, usual_spent: 250, insights: [] },
  goals: { insights: [] },
  ...over,
})
const money = n => `€${n}`

describe('overviewTiles', () => {
  it('says whether each figure is better or worse than usual', () => {
    const t = Object.fromEntries(overviewTiles(recap(), [], money).map(x => [x.key, x]))
    expect(t.habits).toMatchObject({ value: '28/35', better: true, delta: 'up from 60% the week before' })
    expect(t.todos).toMatchObject({ value: '4', better: false, delta: 'down from 9 the week before' })
    expect(t.money).toMatchObject({ value: '€300', better: false, delta: 'above your usual €250' })   // spending more is not "better"
  })
  it('leaves out what it has nothing to say about', () => {
    const r = recap({ habits: { ...recap().habits, possible: 0 }, money: { ...recap().money, count: 0 } })
    expect(overviewTiles(r, [], money).map(t => t.key)).toEqual(['todos'])
  })
  it('adds goal time when the calendar has some', () => {
    const t = overviewTiles(recap(), [{ hours: 4.5 }, { hours: 3 }], money).find(x => x.key === 'goals')
    expect(t.value).toBe('7.5h')
  })
})

describe('headlines', () => {
  it('picks the first good and the first warning across sections', () => {
    const r = recap({
      goals: { insights: [{ kind: 'note', text: 'n' }] },
      habits: { ...recap().habits, insights: [{ kind: 'warn', text: 'Run slipped' }, { kind: 'good', text: 'Read daily' }] },
      todos: { ...recap().todos, insights: [{ kind: 'warn', text: 'Old one' }] },
    })
    expect(headlines(r)).toMatchObject({ good: { text: 'Read daily' }, warn: { text: 'Run slipped' } })
  })
  it('is empty when there is nothing to say', () => {
    expect(headlines(recap())).toEqual({ good: null, warn: null })
  })
})

describe('reflectionPrompts', () => {
  it('leads with what the week showed, then the general questions', () => {
    const r = recap({
      habits: { ...recap().habits, insights: [{ kind: 'warn', text: '', ref: { type: 'habit', id: 'h1' } }] },
      todos: { ...recap().todos, open: [{ text: 'File taxes', age_days: 30 }] },
    })
    const p = reflectionPrompts(r)
    expect(p[0]).toBe('What got in the way of “Run”?')
    expect(p[1]).toContain('File taxes')
    expect(p).toContain('What went well?')
    expect(p.length).toBeLessThanOrEqual(6)
  })
  it('is just the general questions for a quiet week', () => {
    expect(reflectionPrompts(recap())[0]).toBe('What went well?')
  })
})

describe('ageLabel', () => {
  it('is days, then weeks', () => {
    expect([0, 3, 13, 14, 30].map(ageLabel)).toEqual(['today', '3d', '13d', '2w', '4w'])
    expect(ageLabel(null)).toBe('')
  })
})

describe('step order', () => {
  it('looks at money before goals, then habits, to-dos and the plan', () => {
    expect(STEPS.map(s => s.id)).toEqual(['week', 'money', 'goals', 'habits', 'todos', 'plan'])
  })
})

describe('goalHoursFor', () => {
  const goals = [{ id: 'g1', title: 'Fitness', color: '#6f8168', tags: 'gym' }, { id: 'g2', title: 'Spanish', color: '#c15f3c', tags: '' }]
  // Review of Mon 2 – Sun 8 Nov 2026; the four weeks before it are 5 Oct – 1 Nov.
  const ev = (date, dur) => ({ date, title: 'Gym', start: 9, dur })
  const events = [ev('2026-11-03', 2), ev('2026-10-27', 4), ev('2026-10-20', 4), ev('2026-10-13', 4), ev('2026-10-06', 4)]
  it('is the hours this week and the average of the four before', () => {
    expect(goalHoursFor(events, goals, '2026-11-02')).toEqual([
      { id: 'g1', goal: 'Fitness', hours: 2, usual: 4 },
      { id: 'g2', goal: 'Spanish', hours: 0, usual: 0 },
    ])
  })
})

describe('goalHourNote', () => {
  const g = (hours, usual) => goalHourNote({ goal: 'Fitness', hours, usual })
  it('flags a goal that got nothing, or half, of what it usually gets', () => {
    expect(g(0, 4)).toMatchObject({ kind: 'warn', text: expect.stringContaining('usually give it about 4h') })
    expect(g(1, 4)).toMatchObject({ kind: 'warn', text: expect.stringContaining('half its usual 4h') })
  })
  it('says so when a goal has had nothing for over a month', () => {
    expect(g(0, 0)).toMatchObject({ kind: 'warn', text: expect.stringContaining('over a month') })
  })
  it('praises a goal well above its usual, and leaves ordinary weeks alone', () => {
    expect(g(7, 4)).toMatchObject({ kind: 'good' })
    expect(g(3.5, 4)).toBeNull()
  })
})
