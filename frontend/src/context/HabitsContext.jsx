import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'

export const HABIT_PERIODS = [
  { label: 'Morning', color: '#6f8168' },
  { label: 'Daytime', color: '#b08a3e' },
  { label: 'Evening', color: '#9a6d84' },
]

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function toDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function calcStreak(dates = []) {
  const set = new Set(dates)
  let streak = 0
  const d = new Date(); d.setHours(0,0,0,0)
  while (set.has(toDateStr(d))) { streak++; d.setDate(d.getDate() - 1) }
  return streak
}

function getWeekDates() {
  const today = new Date()
  const day = today.getDay()
  const mon = new Date(today)
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
  mon.setHours(0,0,0,0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return toDateStr(d)
  })
}

function getLast30() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i)); return toDateStr(d)
  })
}

const Ctx = createContext(null)

export function HabitsProvider({ children }) {
  const { token } = useAuth()
  // Internal shape: { habits: [{id,name,color,createdAt}], completions: {[id]: [dateStr]} }
  const [data, setData] = useState({ habits: [], completions: {} })

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  // Load from API on mount
  useEffect(() => {
    call('/api/habits').then(r => r.json()).then(rows => {
      const habits = rows.map(({ completions: _, created_at, ...h }) => ({ ...h, createdAt: created_at }))
      const completions = Object.fromEntries(rows.map(r => [r.id, r.completions]))
      setData({ habits, completions })
    })
  }, [token])

  const addHabit = useCallback(async (name, color) => {
    const id = crypto.randomUUID()
    const created_at = toDateStr()
    const newHabit = { id, name, color, createdAt: created_at }
    setData(d => ({ ...d, habits: [...d.habits, newHabit], completions: { ...d.completions, [id]: [] } }))
    await call('/api/habits', { method: 'POST', body: JSON.stringify({ id, name, color, created_at }) })
  }, [call])

  const removeHabit = useCallback(async (id) => {
    setData(d => {
      const { [id]: _, ...completions } = d.completions
      return { habits: d.habits.filter(h => h.id !== id), completions }
    })
    await call(`/api/habits/${id}`, { method: 'DELETE' })
  }, [call])

  const toggleCompletion = useCallback(async (id, dateStr) => {
    setData(d => {
      const prev = d.completions[id] || []
      const next = prev.includes(dateStr) ? prev.filter(x => x !== dateStr) : [...prev, dateStr]
      return { ...d, completions: { ...d.completions, [id]: next } }
    })
    await call(`/api/habits/${id}/toggle`, { method: 'POST', body: JSON.stringify({ date: dateStr }) })
  }, [call])

  const weekDates = getWeekDates()
  const last30 = getLast30()
  const today = toDateStr()

  const habits = data.habits.map(h => {
    const comps = data.completions[h.id] || []
    const set = new Set(comps)
    return {
      ...h,
      streak: calcStreak(comps),
      pct: Math.round(last30.filter(d => set.has(d)).length / 30 * 100),
      week: weekDates.map(d => set.has(d)),
      history: last30.map(d => set.has(d)),
      todayDone: set.has(today),
    }
  })

  return (
    <Ctx.Provider value={{ habits, weekDates, today, addHabit, removeHabit, toggleCompletion }}>
      {children}
    </Ctx.Provider>
  )
}

export const useHabits = () => useContext(Ctx)
