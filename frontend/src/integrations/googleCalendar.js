const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

export function buildAuthUrl(clientId, redirectUri) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: 'atlas-gcal',
  })
}

export async function fetchEvents(token, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '200',
  })
  const res = await fetch(`${CAL_BASE}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GCal ${res.status}`)
  return res.json()
}

export async function insertGcalEvent(token, { title, date, startH, endH, notes = '' }) {
  const pad = n => String(Math.floor(n)).padStart(2, '0')
  const toTime = h => `${pad(h)}:${pad((h % 1) * 60)}:00`
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const body = {
    summary: title,
    description: notes,
    start: { dateTime: `${date}T${toTime(startH)}`, timeZone: tz },
    end:   { dateTime: `${date}T${toTime(endH)}`,   timeZone: tz },
  }
  const res = await fetch(`${CAL_BASE}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GCal insert ${res.status}`)
  return res.json()
}

// GCal colorId → palette
const COLOR_MAP = {
  '1':  { c: '#9a6d84', t: 'rgba(154,109,132,.16)' },
  '2':  { c: '#6f8168', t: 'rgba(111,129,104,.16)' },
  '3':  { c: '#9a6d84', t: 'rgba(154,109,132,.16)' },
  '4':  { c: '#c15f3c', t: 'rgba(193,95,60,.13)'  },
  '5':  { c: '#b08a3e', t: 'rgba(176,138,62,.16)'  },
  '6':  { c: '#c15f3c', t: 'rgba(193,95,60,.13)'  },
  '7':  { c: '#5f7591', t: 'rgba(95,117,145,.16)'  },
  '8':  { c: '#9a9488', t: 'rgba(154,148,136,.16)' },
  '9':  { c: '#5f7591', t: 'rgba(95,117,145,.16)'  },
  '10': { c: '#6f8168', t: 'rgba(111,129,104,.16)' },
  '11': { c: '#c15f3c', t: 'rgba(193,95,60,.13)'  },
}
const DEFAULT_COL = { c: '#5f7591', t: 'rgba(95,117,145,.16)' }
const SLEEP_COL   = { c: '#9a9488', t: 'rgba(154,148,136,.16)' }

// Use local date parts to avoid UTC offset shifting the date
export const localDateStr = d =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

export const isSleepEvent = (title = '') => /\bsleep\b/i.test(title)

function parsedt(dt) {
  if (!dt) return null
  if (dt.dateTime) return new Date(dt.dateTime)
  if (dt.date) { const d = new Date(dt.date); d.setHours(0,0,0,0); return d }
  return null
}
const toH = d => d.getHours() + d.getMinutes() / 60
const fmtT = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function toCalendarEvents(items = []) {
  const result = []

  for (const e of items) {
    if (e.status === 'cancelled' || !e.start) continue

    // ── All-day events (start.date, no dateTime) ──────────────────────────
    if (!e.start.dateTime) {
      const pal = COLOR_MAP[e.colorId] || DEFAULT_COL
      result.push({
        id:          e.id,
        title:       e.summary || '(No title)',
        description: e.description || '',
        location:    e.location || '',
        isAllDay:    true,
        start:       -1, // sort before timed events
        dur:         0,
        time:        'All day',
        timeDisplay: 'All day',
        endTimeDisplay: '',
        durDisplay:  '',
        color:       pal.c,
        tint:        pal.t,
        date:        e.start.date,
        isLocal:     false,
      })
      continue
    }

    // ── Timed events ──────────────────────────────────────────────────────
    const start = parsedt(e.start)
    const end   = parsedt(e.end)
    if (!start || !end) continue

    const pal       = COLOR_MAP[e.colorId] || DEFAULT_COL
    const startH    = toH(start)
    const startDate = localDateStr(start)
    const endDate   = localDateStr(end)
    const crossesMidnight = endDate > startDate
    const endH      = crossesMidnight ? 24 : toH(end)
    const dur       = Math.max(endH - startH, 0.25)

    // ── Sleep events — special handling ─────────────────────────────────────
    if (isSleepEvent(e.summary)) {
      const wakeH = toH(end)
      if (!crossesMidnight && startH < 12) {
        // Early-morning same-day sleep (e.g. midnight → 8am)
        // Emit actual sleep block for calendar view
        result.push({
          id: e.id, title: e.summary || '(No title)',
          description: e.description || '', location: e.location || '',
          isAllDay: false, isBedtime: true,
          start: startH, dur: Math.max(wakeH - startH, 0.25),
          time: `${fmtT(start)}–${fmtT(end)}`, timeDisplay: fmtT(start),
          endTimeDisplay: fmtT(end), durDisplay: `${Math.round((wakeH - startH) * 60)}m`,
          color: SLEEP_COL.c, tint: SLEEP_COL.t, date: startDate, isLocal: false,
        })
        // Emit wake-up hint for homepage schedule
        result.push({
          id: `${e.id}_wakeup`, title: 'Wake up', description: '', location: '',
          isAllDay: false, isSleepWakeUp: true,
          start: wakeH, dur: wakeH,
          time: fmtT(end), timeDisplay: fmtT(end), endTimeDisplay: '', durDisplay: '',
          color: SLEEP_COL.c, tint: SLEEP_COL.t, date: startDate, isLocal: false,
        })
      } else if (crossesMidnight && wakeH > 0) {
        // Cross-midnight sleep ending in morning → bedtime + wake-up
        result.push({
          id: e.id, title: e.summary || '(No title)',
          description: e.description || '', location: e.location || '',
          isAllDay: false, isBedtime: true,
          start: startH, dur,
          time: `${fmtT(start)}–${fmtT(end)}`, timeDisplay: fmtT(start),
          endTimeDisplay: fmtT(end), durDisplay: `${Math.round(dur * 60)}m`,
          color: SLEEP_COL.c, tint: SLEEP_COL.t, date: startDate, isLocal: false,
        })
        result.push({
          id: `${e.id}_wakeup`, title: 'Wake up', description: '', location: '',
          isAllDay: false, isSleepWakeUp: true,
          start: wakeH, dur: wakeH,
          time: fmtT(end), timeDisplay: fmtT(end), endTimeDisplay: '', durDisplay: '',
          color: SLEEP_COL.c, tint: SLEEP_COL.t, date: endDate, isLocal: false,
        })
      } else {
        // Evening sleep going to midnight (calendar boundary) → bedtime only
        result.push({
          id: e.id, title: e.summary || '(No title)',
          description: e.description || '', location: e.location || '',
          isAllDay: false, isBedtime: true,
          start: startH, dur,
          time: `${fmtT(start)}–${fmtT(end)}`, timeDisplay: fmtT(start),
          endTimeDisplay: fmtT(end), durDisplay: `${Math.round(dur * 60)}m`,
          color: SLEEP_COL.c, tint: SLEEP_COL.t, date: startDate, isLocal: false,
        })
      }
      continue
    }

    // ── Regular timed events ─────────────────────────────────────────────────
    result.push({
      id:          e.id,
      title:       e.summary || '(No title)',
      description: e.description || '',
      location:    e.location || '',
      isAllDay:    false,
      start:       startH,
      dur,
      time:        `${fmtT(start)}–${fmtT(end)}`,
      timeDisplay: fmtT(start),
      endTimeDisplay: fmtT(end),
      durDisplay:  `${Math.round(dur * 60)}m`,
      color:       pal.c,
      tint:        pal.t,
      date:        startDate,
      isLocal:     false,
    })
  }

  return result
}

// offset: 0 = current week, 1 = next week, -1 = prev week, etc.
export function getWeekRange(offset = 0) {
  const today = new Date()
  const day = today.getDay()
  const mon = new Date(today)
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + offset * 7)
  mon.setHours(0, 0, 0, 0)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  sun.setHours(23, 59, 59, 999)
  return { weekStart: mon, weekEnd: sun, todayStr: localDateStr(today) }
}
