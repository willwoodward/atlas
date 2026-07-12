import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
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
  const todosRef = useRef(todos)
  useEffect(() => { todosRef.current = todos }, [todos])

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  // Convert API row (snake_case, int done) → internal shape
  const toInternal = (r) => ({
    id: r.id, text: r.text, bucket: r.bucket,
    goalId: r.goal_id, parentId: r.parent_id || null, done: !!r.done,
    createdAt: r.created_at, completedAt: r.completed_at || null,
  })

  useEffect(() => {
    call('/api/todos').then(r => r.json()).then(rows => setTodos(rows.map(toInternal)))
    call(`/api/todos/outcomes/${weekStr}`).then(r => r.json()).then(d => setOutcomesState(d.text))
  }, [token])

  const addTodo = useCallback(async (text, bucket = 'today', goalId = null, parentId = null) => {
    const id = crypto.randomUUID()
    const created_at = new Date().toISOString()
    setTodos(prev => [...prev, { id, text, bucket, goalId, parentId, done: false, createdAt: created_at }])
    await call('/api/todos', { method: 'POST', body: JSON.stringify({ id, text, bucket, goal_id: goalId, parent_id: parentId, done: false, created_at, sort_order: 0 }) })
  }, [call])

  const toggleTodo = useCallback(async (id) => {
    const current = todosRef.current
    const toggled = current.find(t => t.id === id)
    const nowDone = toggled ? !toggled.done : false
    const now = nowDone ? new Date().toISOString() : null

    // If completing a sub-todo, check if all siblings are now done → auto-complete parent
    let parentToComplete = null
    if (toggled?.parentId && nowDone) {
      const siblings = current.filter(t => t.parentId === toggled.parentId && t.id !== id)
      const parent = current.find(t => t.id === toggled.parentId)
      if (siblings.every(t => t.done) && parent && !parent.done) {
        parentToComplete = toggled.parentId
      }
    }

    // If un-ticking a sub-todo, also un-tick parent
    let parentToUncomplete = null
    if (toggled?.parentId && !nowDone) {
      const parent = current.find(t => t.id === toggled.parentId)
      if (parent?.done) parentToUncomplete = toggled.parentId
    }

    setTodos(prev => {
      let next = prev.map(t => t.id === id ? { ...t, done: nowDone, completedAt: now } : t)
      if (parentToComplete) next = next.map(t => t.id === parentToComplete ? { ...t, done: true, completedAt: new Date().toISOString() } : t)
      if (parentToUncomplete) next = next.map(t => t.id === parentToUncomplete ? { ...t, done: false, completedAt: null } : t)
      return next
    })
    await call(`/api/todos/${id}/toggle`, { method: 'PATCH' })
    if (parentToComplete) await call(`/api/todos/${parentToComplete}/toggle`, { method: 'PATCH' })
    if (parentToUncomplete) await call(`/api/todos/${parentToUncomplete}/toggle`, { method: 'PATCH' })
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

  const addSubTodo = useCallback((parentId, text) => addTodo(text, todos.find(t => t.id === parentId)?.bucket ?? 'today', null, parentId), [addTodo, todos])

  return (
    <Ctx.Provider value={{ todos, outcomes, addTodo, addSubTodo, toggleTodo, moveTodo, removeTodo, clearDone, setOutcomes, reorderTodo }}>
      {children}
    </Ctx.Provider>
  )
}

export const useTodos = () => useContext(Ctx)
