// @vitest-environment jsdom
// Calendar changes show on screen before Google answers, and are put back if it refuses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.React = React   // the provider's JSX is compiled for the classic runtime under vitest
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ token: 'jwt' }) }))
vi.mock('../RefreshContext.jsx', () => ({ useRefresh: () => ({ tick: 0 }) }))

import { IntegrationsProvider, useIntegrations } from '../IntegrationsContext.jsx'

const WEEK_START = new Date(2026, 10, 2), WEEK_END = new Date(2026, 10, 8, 23, 59)
const gItem = (id, summary, hour) => ({
  id, summary, start: { dateTime: `2026-11-04T${String(hour).padStart(2, '0')}:00:00` }, end: { dateTime: `2026-11-04T${String(hour + 1).padStart(2, '0')}:00:00` },
})

let google, ctx, root, container

// A fake Google whose answers we release by hand.
function fakeGoogle() {
  const g = { items: [gItem('a', 'Gym', 9)], held: [], fail: false }
  const answer = (make) => new Promise((resolve, reject) => {
    const settle = () => (g.fail ? resolve({ ok: false, status: 500, json: async () => ({}) }) : resolve({ ok: true, status: 200, json: async () => make() }))
    g.held.push(settle)
  })
  g.release = async () => { const h = g.held.splice(0); await act(async () => { h.forEach(f => f()) }) }
  g.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET'
    if (u.endsWith('/api/integrations')) return { ok: true, json: async () => ({ gcal: { connected: true } }) }
    if (u.includes('/auth/gcal/token')) return { ok: true, json: async () => ({ access_token: 'tok' }) }
    if (u.includes('/api/calendar/color-rules')) return { ok: true, json: async () => ({ rules: [], fallback: null }) }
    if (u.includes('/calendars/primary/events')) {
      if (method === 'POST') return answer(() => ({ id: 'real-1', ...JSON.parse(opts.body) }))
      if (method === 'DELETE') return answer(() => ({}))
      if (method === 'PATCH') return answer(() => ({}))
      if (u.match(/events\/[^?]+$/)) return { ok: true, json: async () => ({ id: 'a', start: g.items[0].start, end: g.items[0].end }) }
      return { ok: true, json: async () => ({ items: g.items }) }
    }
    return { ok: true, json: async () => ({}) }
  })
  return g
}

const titles = () => ctx.gcal.events.map(e => e.title).sort()
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

function Probe() { ctx = useIntegrations(); return null }

beforeEach(async () => {
  google = fakeGoogle()
  vi.stubGlobal('fetch', google.fetch)
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => { root.render(<IntegrationsProvider><Probe /></IntegrationsProvider>) })
  await flush()
  await act(async () => { await ctx.refetchEvents(WEEK_START, WEEK_END) })
})
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals() })

describe('Google Calendar changes', () => {
  it('starts with what Google has', () => {
    expect(titles()).toEqual(['Gym'])
  })

  it('shows a new event at once, before Google has made it', async () => {
    let done
    await act(async () => { done = ctx.createGcalEvent({ title: 'Dentist', date: '2026-11-04', startH: 14, endH: 15, color: '#5f7591', atlasColor: 'blue' }) })
    expect(titles()).toEqual(['Dentist', 'Gym'])          // Google hasn't answered yet
    await google.release(); await flush()
    google.items = [gItem('a', 'Gym', 9), gItem('real-1', 'Dentist', 14)]
    await google.release(); await flush()
    await act(async () => { await done; await ctx.refetchEvents(WEEK_START, WEEK_END) })
    expect(titles()).toEqual(['Dentist', 'Gym'])          // not shown twice once Google's copy arrives
  })

  it('shows a new all-day event at once, dated and without times', async () => {
    let done
    await act(async () => { done = ctx.createGcalEvent({ title: 'Holiday', date: '2026-11-04', startH: 9, endH: 10, color: '#5f7591', allDay: true }) })
    expect(ctx.gcal.events.find(e => e.title === 'Holiday')).toMatchObject({ isAllDay: true, date: '2026-11-04', timeDisplay: 'All day' })
    await google.release(); await flush()
    const post = google.fetch.mock.calls.find(([, o]) => o?.method === 'POST')
    expect(JSON.parse(post[1].body)).toMatchObject({ start: { date: '2026-11-04' }, end: { date: '2026-11-05' } })
    await google.release(); await flush()
    await act(async () => { await done })
  })

  it('takes a new event off again if Google refuses it', async () => {
    google.fail = true
    let done
    await act(async () => { done = ctx.createGcalEvent({ title: 'Dentist', date: '2026-11-04', startH: 14, endH: 15, color: '#5f7591' }).catch(e => e) })
    expect(titles()).toEqual(['Dentist', 'Gym'])
    await google.release(); await flush()
    expect(await done).toBeInstanceOf(Error)
    expect(titles()).toEqual(['Gym'])
  })

  it('removes a deleted event at once', async () => {
    let done
    await act(async () => { done = ctx.removeGcalEvent('a') })
    expect(titles()).toEqual([])
    await google.release(); await flush()
    await act(async () => { await done })
    expect(titles()).toEqual([])
  })

  it('brings a deleted event back if Google refuses', async () => {
    google.fail = true
    let done
    await act(async () => { done = ctx.removeGcalEvent('a').catch(e => e) })
    expect(titles()).toEqual([])
    await google.release(); await flush()
    expect(await done).toBeInstanceOf(Error)
    expect(titles()).toEqual(['Gym'])
  })

  it('moves an event at once and puts it back if Google refuses', async () => {
    google.fail = true
    let done
    await act(async () => { done = ctx.shiftGcalEvents(['a'], { days: 1, startHours: 2, endHours: 2 }).catch(e => e) })
    expect(ctx.gcal.events[0]).toMatchObject({ date: '2026-11-05', start: 11 })
    await google.release(); await flush()
    await act(async () => { await done })
    expect(ctx.gcal.events[0]).toMatchObject({ date: '2026-11-04', start: 9 })
  })

  it('updates the time text on a moved or resized event too', async () => {
    let done
    await act(async () => { done = ctx.shiftGcalEvents(['a'], { days: 0, startHours: 2, endHours: 3 }) })
    const e = ctx.gcal.events[0]                              // 9–10 became 11–13
    const t = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    expect(e).toMatchObject({ time: `${t(11)}–${t(13)}`, timeDisplay: t(11), endTimeDisplay: t(13), durDisplay: '120m' })
    await google.release(); await flush()
    await act(async () => { await done })
  })

  it('deleting an event while Google is still making it removes it from Google too', async () => {
    let created
    await act(async () => { created = ctx.createGcalEvent({ title: 'Oops', date: '2026-11-04', startH: 14, endH: 15, color: '#5f7591' }) })
    const draft = ctx.gcal.events.find(e => e.title === 'Oops')
    await act(async () => { await ctx.removeGcalEvent(draft.id) })
    expect(titles()).toEqual(['Gym'])
    await google.release(); await flush()
    await google.release(); await flush()
    await act(async () => { await created })
    expect(google.fetch.mock.calls.some(([u, o]) => o?.method === 'DELETE' && String(u).endsWith('/real-1'))).toBe(true)
    expect(titles()).toEqual(['Gym'])
  })
})
