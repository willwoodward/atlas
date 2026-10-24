import { describe, it, expect, vi, afterEach } from 'vitest'
import { shiftDateTime, insertGcalEvent, shiftGcalEvent, toCalendarEvents } from '../googleCalendar.js'

afterEach(() => vi.unstubAllGlobals())

const stubFetch = (getBody) => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    calls.push({ url, ...opts, body: opts.body && JSON.parse(opts.body) })
    return { ok: true, json: async () => getBody ?? {} }
  }))
  return calls
}

describe('shiftDateTime', () => {
  it('moves by days and hours in local wall-clock time', () => {
    expect(shiftDateTime('2026-10-20T09:00:00', 1, 2.25)).toBe('2026-10-21T11:15:00')
    expect(shiftDateTime('2026-10-20T23:30:00', 0, 1)).toBe('2026-10-21T00:30:00')
    expect(shiftDateTime('2026-10-20T09:00:00', -1, -0.5)).toBe('2026-10-19T08:30:00')
  })
})

describe('insertGcalEvent', () => {
  it('sends the Google colour and keeps the Atlas colour private', async () => {
    const calls = stubFetch()
    await insertGcalEvent('t', { title: 'Coffee', date: '2026-10-20', startH: 9, endH: 10, colorId: '4', atlasColor: 'sage' })
    expect(calls[0].body.colorId).toBe('4')
    expect(calls[0].body.extendedProperties).toEqual({ private: { atlasColor: 'sage' } })
  })
  it('leaves both out when neither is set', async () => {
    const calls = stubFetch()
    await insertGcalEvent('t', { title: 'Lunch', date: '2026-10-20', startH: 12, endH: 13, colorId: null, atlasColor: '' })
    expect('colorId' in calls[0].body).toBe(false)
    expect('extendedProperties' in calls[0].body).toBe(false)
  })
})

describe('toCalendarEvents colours', () => {
  const ev = (extra) => ({ id: 'a', summary: 'Gym', start: { dateTime: '2026-10-20T09:00:00' }, end: { dateTime: '2026-10-20T10:00:00' }, ...extra })
  it('draws the Atlas colour when the event has one', () => {
    expect(toCalendarEvents([ev({ colorId: '9', extendedProperties: { private: { atlasColor: 'coral' } } })])[0].color).toBe('#c15f3c')
  })
  it('otherwise maps the Google colour', () => {
    expect(toCalendarEvents([ev({ colorId: '2' })])[0].color).toBe('#6f8168')
  })
})

describe('shiftGcalEvent', () => {
  const ev = { start: { dateTime: '2026-10-20T09:00:00+01:00', timeZone: 'Europe/London' }, end: { dateTime: '2026-10-20T10:00:00+01:00', timeZone: 'Europe/London' } }
  it('moves both ends for a move', async () => {
    const calls = stubFetch(ev)
    await shiftGcalEvent('t', 'e1', { days: 1, startHours: 0.5, endHours: 0.5 })
    expect(calls[1].method).toBe('PATCH')
    expect(calls[1].body.start.dateTime.slice(0, 16)).toMatch(/^2026-10-21T\d\d:30$/)
    expect(calls[1].body.end.timeZone).toBe('Europe/London')
  })
  it('moves only the end for a bottom-edge resize', async () => {
    const calls = stubFetch(ev)
    await shiftGcalEvent('t', 'e1', { endHours: 1.5 })
    const { start, end } = calls[1].body
    const h = s => new Date(s).getHours() + new Date(s).getMinutes() / 60
    expect(h(end.dateTime) - h(start.dateTime)).toBe(2.5)
  })
  it('moves an all-day event by days only', async () => {
    const calls = stubFetch({ start: { date: '2026-10-20' }, end: { date: '2026-10-21' } })
    await shiftGcalEvent('t', 'e1', { days: 2, startHours: 3, endHours: 3 })
    expect(calls[1].body).toEqual({ start: { date: '2026-10-22' }, end: { date: '2026-10-23' } })
  })
})
