import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Ctx = createContext(null)

export function LocalCalendarProvider({ children }) {
  const { token } = useAuth()
  const [events, setEvents] = useState([])

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  useEffect(() => {
    call('/api/calendar').then(r => r.json()).then(rows =>
      // API uses snake_case; internal shape uses camelCase
      setEvents(rows.map(r => ({ id: r.id, title: r.title, date: r.date, startH: r.start_h, endH: r.end_h, color: r.color, notes: r.notes })))
    )
  }, [token])

  const addEvent = useCallback(async ({ title, date, startH, endH, color, notes = '' }) => {
    const id = crypto.randomUUID()
    setEvents(prev => [...prev, { id, title, date, startH, endH, color, notes }])
    await call('/api/calendar', { method: 'POST', body: JSON.stringify({ id, title, date, start_h: startH, end_h: endH, color, notes }) })
  }, [call])

  const removeEvent = useCallback(async (id) => {
    setEvents(prev => prev.filter(e => e.id !== id))
    await call(`/api/calendar/${id}`, { method: 'DELETE' })
  }, [call])

  return <Ctx.Provider value={{ events, addEvent, removeEvent }}>{children}</Ctx.Provider>
}

export const useLocalCalendar = () => useContext(Ctx)
