import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const STORE_KEY = 'atlas:assistant-thread:v1'
const MAX_STORED = 40

// Tools that write. After a turn that used any of these, the data contexts
// must refetch or the UI keeps showing pre-agent state.
const MUTATING_TOOLS = new Set([
  'add_todo', 'complete_todo', 'move_todo', 'delete_todo', 'set_week_outcomes',
  'log_habit', 'create_note', 'update_note',
  'write_github_note', 'create_github_folder',
])

function loadStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const Ctx = createContext(null)

export function AssistantProvider({ children }) {
  const { token } = useAuth()
  const { refresh } = useRefresh()
  const [messages, setMessages] = useState(loadStored)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  // Persist so the thread also survives a reload / PWA relaunch, not just navigation.
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-MAX_STORED)))
    } catch { /* quota — thread just won't survive reload */ }
  }, [messages])

  useEffect(() => () => abortRef.current?.abort(), [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
  }, [])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const send = useCallback(async (text) => {
    const prompt = (text || '').trim()
    if (!prompt || busy) return

    // The agent is stateless — it gets the whole thread on every turn.
    const history = [...messages, { role: 'user', content: prompt }]
    setMessages([...history, { role: 'assistant', content: '', tools: [] }])
    setError(null)
    setBusy(true)

    const patchLast = fn => setMessages(prev => {
      const next = [...prev]
      next[next.length - 1] = fn(next[next.length - 1])
      return next
    })

    const controller = new AbortController()
    abortRef.current = controller
    let touchedData = false

    try {
      const res = await fetch(`${API}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(res.status === 403 ? 'Not authorised to use the assistant.' : `Assistant error (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by a blank line
        const frames = buffer.split('\n\n')
        buffer = frames.pop()

        for (const frame of frames) {
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          let ev
          try { ev = JSON.parse(line.slice(6)) } catch { continue }

          if (ev.type === 'token') patchLast(m => ({ ...m, content: m.content + ev.text }))
          else if (ev.type === 'tool') {
            if (MUTATING_TOOLS.has(ev.name)) touchedData = true
            patchLast(m => ({ ...m, tools: [...m.tools, ev.name] }))
          }
          else if (ev.type === 'error') setError(ev.message)
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
      abortRef.current = null
      // Drop a turn that produced nothing so the thread doesn't show an empty bubble
      setMessages(prev => {
        const last = prev[prev.length - 1]
        return last?.role === 'assistant' && !last.content && last.tools.length === 0 ? prev.slice(0, -1) : prev
      })
      // Pull the dashboard back in sync with whatever the agent just changed.
      if (touchedData) refresh()
    }
  }, [messages, busy, token, refresh])

  return (
    <Ctx.Provider value={{ messages, busy, error, send, stop, clear }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAssistant = () => useContext(Ctx)
