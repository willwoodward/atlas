import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function getWeekStr() {
  const d = new Date(), day = d.getDay()
  const mon = new Date(d)
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); mon.setHours(0,0,0,0)
  return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`
}

const Ctx = createContext(null)

export function TodosProvider({ children }) {
  const { token } = useAuth()
  const [todos, setTodos] = useState([])
  const [outcomes, setOutcomesState] = useState('')
  const weekStr = getWeekStr()

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  // Convert API row (snake_case, int done) → internal shape
  const toInternal = (r) => ({
    id: r.id, text: r.text, bucket: r.bucket,
    goalId: r.goal_id, done: !!r.done, createdAt: r.created_at,
  })

  useEffect(() => {
    call('/api/todos').then(r => r.json()).then(rows => setTodos(rows.map(toInternal)))
    call(`/api/todos/outcomes/${weekStr}`).then(r => r.json()).then(d => setOutcomesState(d.text))
  }, [token])

  const addTodo = useCallback(async (text, bucket = 'today', goalId = null) => {
    const id = crypto.randomUUID()
    const created_at = new Date().toISOString()
    setTodos(prev => [...prev, { id, text, bucket, goalId, done: false, createdAt: created_at }])
    await call('/api/todos', { method: 'POST', body: JSON.stringify({ id, text, bucket, goal_id: goalId, done: false, created_at, sort_order: 0 }) })
  }, [call])

  const toggleTodo = useCallback(async (id) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t))
    await call(`/api/todos/${id}/toggle`, { method: 'PATCH' })
  }, [call])

  const moveTodo = useCallback(async (id, bucket) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, bucket, done: false } : t))
    await call(`/api/todos/${id}/bucket`, { method: 'PATCH', body: JSON.stringify({ bucket }) })
  }, [call])

  const removeTodo = useCallback(async (id) => {
    setTodos(prev => prev.filter(t => t.id !== id))
    await call(`/api/todos/${id}`, { method: 'DELETE' })
  }, [call])

  const clearDone = useCallback(async (bucket) => {
    setTodos(prev => prev.filter(t => !(t.done && t.bucket === bucket)))
    await call('/api/todos/done/clear', { method: 'DELETE' })
  }, [call])

  const setOutcomes = useCallback(async (text) => {
    setOutcomesState(text)
    await call('/api/todos/outcomes', { method: 'PUT', body: JSON.stringify({ week_str: weekStr, text }) })
  }, [call, weekStr])

  const reorderTodo = useCallback(async (dragId, targetId, above, targetBucket) => {
    setTodos(prev => {
      const list = [...prev]
      const fromIdx = list.findIndex(t => t.id === dragId)
      if (fromIdx === -1) return prev
      const [dragged] = list.splice(fromIdx, 1)
      dragged.bucket = targetBucket
      if (targetId) {
        let toIdx = list.findIndex(t => t.id === targetId)
        if (!above) toIdx++
        list.splice(Math.max(0, toIdx), 0, dragged)
      } else {
        list.push(dragged)
      }
      return list
    })
    await call('/api/todos/reorder', {
      method: 'POST',
      body: JSON.stringify({ drag_id: dragId, target_id: targetId, above, target_bucket: targetBucket }),
    })
  }, [call])

  return (
    <Ctx.Provider value={{ todos, outcomes, addTodo, toggleTodo, moveTodo, removeTodo, clearDone, setOutcomes, reorderTodo }}>
      {children}
    </Ctx.Provider>
  )
}

export const useTodos = () => useContext(Ctx)
