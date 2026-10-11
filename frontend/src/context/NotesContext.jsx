import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Ctx = createContext(null)

export function NotesProvider({ children }) {
  const { token } = useAuth()
  // Bumped when the assistant mutates data via MCP, forcing a refetch.
  const { tick } = useRefresh()
  const [rawNotes, setNotes] = useState([])
  // Most recently edited first. ISO timestamps sort correctly as strings.
  const notes = useMemo(() => [...rawNotes].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')), [rawNotes])

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  useEffect(() => {
    // API rows are snake_case; the rest of the app reads updatedAt.
    call('/api/notes').then(r => r.json()).then(rows =>
      setNotes(rows.map(r => ({ id: r.id, body: r.body, updatedAt: r.updated_at }))))
  }, [token, tick])

  const addNote = useCallback(async () => {
    const id = crypto.randomUUID()
    const updatedAt = new Date().toISOString()
    const note = { id, body: '', updatedAt }
    setNotes(prev => [note, ...prev])
    await call('/api/notes', { method: 'POST', body: JSON.stringify({ id, body: '', updated_at: updatedAt }) })
    return id
  }, [call])

  const updateNote = useCallback(async (id, body) => {
    const updatedAt = new Date().toISOString()
    setNotes(prev => prev.map(n => n.id === id ? { ...n, body, updatedAt } : n))
    await call(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ body, updated_at: updatedAt }) })
  }, [call])

  const removeNote = useCallback(async (id) => {
    setNotes(prev => prev.filter(n => n.id !== id))
    await call(`/api/notes/${id}`, { method: 'DELETE' })
  }, [call])

  return (
    <Ctx.Provider value={{ notes, addNote, updateNote, removeNote }}>
      {children}
    </Ctx.Provider>
  )
}

export const useNotes = () => useContext(Ctx)
