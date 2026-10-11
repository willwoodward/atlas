import { useMemo } from 'react'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useLocalCalendar } from '../context/LocalCalendarContext.jsx'

export function hexTint(hex, a = 0.15) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

export function fmtH(h) {
  const hrs = Math.floor(h), mins = Math.round((h - hrs) * 60)
  const ampm = hrs >= 12 ? 'PM' : 'AM', h12 = hrs % 12 || 12
  return mins === 0 ? `${h12} ${ampm}` : `${h12}:${String(mins).padStart(2, '0')} ${ampm}`
}

// Google Calendar events plus Atlas-local ones, in the shape the calendar views use.
export function useCalendarEvents() {
  const { gcal } = useIntegrations()
  const { events: localEvents } = useLocalCalendar()

  return useMemo(() => [
    ...gcal.events,
    ...localEvents.map(e => {
      const dur = Math.max(e.endH - e.startH, 0.25)
      return {
        id: e.id, title: e.title, start: e.startH, dur,
        time: `${fmtH(e.startH)}–${fmtH(e.endH)}`,
        timeDisplay: fmtH(e.startH),
        endTimeDisplay: fmtH(e.endH),
        durDisplay: `${Math.round(dur * 60)}m`,
        color: e.color, tint: hexTint(e.color),
        date: e.date, isLocal: true, isAllDay: false, notes: e.notes,
        description: '', location: '',
      }
    }),
  ], [gcal.events, localEvents])
}
