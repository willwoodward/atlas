import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Ctx = createContext(null)

export function LocalCalendarProvider({ children }) {
  const { token } = useAuth()
  // Bumped when the assistant mutates data via MCP, forcing a refetch.
  const { tick } = useRefresh()
  const [events, setEvents] = useState([])

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  useEffect(() => {
    call('/api/calendar').then(r => r.json()).then(rows =>
      // API uses snake_case; internal shape uses camelCase
      setEvents(rows.map(r => ({ id: r.id, title: r.title, date: r.date, startH: r.start_h, endH: r.end_h, color: r.color, notes: r.notes, allDay: !!r.all_day })))
    )
  }, [token, tick])

  // Each change shows at once; if the server refuses it, it's put back.
  const send = useCallback(async (path, opts, undo) => {
    let ok = false
    try { ok = (await call(path, opts)).ok } catch { /* offline */ }
    if (!ok) { undo(); throw new Error('Could not save the event') }
  }, [call])

  const addEvent = useCallback(async ({ title, date, startH, endH, color, notes = '', allDay = false }) => {
    const id = crypto.randomUUID()
    setEvents(prev => [...prev, { id, title, date, startH, endH, color, notes, allDay }])
    await send('/api/calendar', { method: 'POST', body: JSON.stringify({ id, title, date, start_h: startH, end_h: endH, color, notes, all_day: allDay }) },
      () => setEvents(prev => prev.filter(e => e.id !== id)))
  }, [send])

  const removeEvent = useCallback(async (id) => {
    const gone = events.find(e => e.id === id)
    setEvents(prev => prev.filter(e => e.id !== id))
    await send(`/api/calendar/${id}`, { method: 'DELETE' },
      () => gone && setEvents(prev => prev.some(e => e.id === id) ? prev : [...prev, gone]))
  }, [send, events])

  const moveEvent = useCallback(async (id, { date, startH, endH }) => {
    const was = events.find(e => e.id === id)
    setEvents(prev => prev.map(e => e.id === id ? { ...e, date, startH, endH } : e))
    await send(`/api/calendar/${id}`, { method: 'PATCH', body: JSON.stringify({ date, start_h: startH, end_h: endH }) },
      () => was && setEvents(prev => prev.map(e => e.id === id ? was : e)))
  }, [send, events])

  return <Ctx.Provider value={{ events, addEvent, removeEvent, moveEvent }}>{children}</Ctx.Provider>
}

export const useLocalCalendar = () => useContext(Ctx)
