import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'

export const GOAL_PALETTE = ['#c15f3c', '#6f8168', '#5f7591', '#b08a3e', '#9a6d84']

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Convert API row → internal shape
const toInternal = (r) => ({
  id: r.id, title: r.title, color: r.color, createdAt: r.created_at,
  quarters: { Q1: r.q1, Q2: r.q2, Q3: r.q3, Q4: r.q4 },
})

const Ctx = createContext(null)

export function GoalsProvider({ children }) {
  const { token } = useAuth()
  const [goals, setGoals] = useState([])

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  useEffect(() => {
    call('/api/goals').then(r => r.json()).then(rows => setGoals(rows.map(toInternal)))
  }, [token])

  const addGoal = useCallback(async (title, color) => {
    const id = crypto.randomUUID()
    const created_at = new Date().toISOString()
    const goal = { id, title, color, createdAt: created_at, quarters: { Q1: '', Q2: '', Q3: '', Q4: '' } }
    setGoals(prev => [...prev, goal])
    await call('/api/goals', { method: 'POST', body: JSON.stringify({ id, title, color, created_at }) })
    return id
  }, [call])

  const removeGoal = useCallback(async (id) => {
    setGoals(prev => prev.filter(g => g.id !== id))
    await call(`/api/goals/${id}`, { method: 'DELETE' })
  }, [call])

  const updateGoal = useCallback(async (id, changes) => {
    setGoals(prev => prev.map(g => g.id === id ? { ...g, ...changes } : g))
    await call(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(changes) })
  }, [call])

  const setQuarterFocus = useCallback(async (id, quarter, text) => {
    setGoals(prev => prev.map(g =>
      g.id === id ? { ...g, quarters: { ...g.quarters, [quarter]: text } } : g
    ))
    await call(`/api/goals/${id}/quarter/${quarter}`, { method: 'PATCH', body: JSON.stringify({ text }) })
  }, [call])

  return (
    <Ctx.Provider value={{ goals, addGoal, removeGoal, updateGoal, setQuarterFocus }}>
      {children}
    </Ctx.Provider>
  )
}

export const useGoals = () => useContext(Ctx)
