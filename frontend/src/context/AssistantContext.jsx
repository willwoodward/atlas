import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const STORE_KEY = 'atlas:assistant-thread:v1'
const RUN_KEY = 'atlas:assistant-run:v1'
const MAX_STORED = 40

// Tools that write. After a turn that used any of these, the data contexts
// must refetch or the UI keeps showing pre-agent state.
const MUTATING_TOOLS = new Set([
  'add_todo', 'complete_todo', 'move_todo', 'delete_todo', 'set_week_outcomes',
  'log_habit', 'create_note', 'update_note',
  'write_github_note', 'create_github_folder',
  'create_event', 'update_event', 'delete_event',
])

/**
 * Apply one streamed event to an assistant message.
 *
 * Pure, so the live stream and the replay of a stored run share exactly one
 * implementation — a divergence between them would show as detail that looks
 * different after a reload than it did live.
 */
export function reduceMessage(msg, ev) {
  switch (ev.type) {
    case 'token':
      return { ...msg, content: (msg.content || '') + ev.text }
    case 'tool':
      return { ...msg, tools: [...(msg.tools || []), { name: ev.name, toolUseId: ev.toolUseId }] }
    case 'tool_result':
      return {
        ...msg,
        tools: (msg.tools || []).map(t =>
          (typeof t === 'object' && t.toolUseId === ev.toolUseId)
            ? { ...t, status: ev.status, input: ev.input, output: ev.output }
            : t),
      }
    case 'question':
      return {
        ...msg,
        question: { id: ev.questionId, text: ev.question, options: ev.options || [], status: 'open' },
      }
    case 'question_answered':
      return msg.question?.id === ev.questionId
        ? { ...msg, question: { ...msg.question, status: 'answered', answer: ev.answer } }
        : msg
    case 'question_timeout':
      return msg.question?.id === ev.questionId
        ? { ...msg, question: { ...msg.question, status: 'timeout' } }
        : msg
    case 'coding_started':
      return { ...msg, coding: { repo: ev.repo, branch: ev.branch, task: ev.task,
                                 status: 'running', activity: [], commits: [] } }
    case 'coding_activity':
      return msg.coding
        ? { ...msg, coding: { ...msg.coding,
            activity: [...(msg.coding.activity || []),
                       { tool: ev.tool, detail: ev.detail, status: ev.status }].slice(-30) } }
        : msg
    case 'coding_commit':
      // Commits are the durable milestones of a run — never trimmed, unlike
      // activity, because they map to real pushed work the user can go and read.
      // Failed commits are kept too: an agent that cannot save its work looks
      // identical to one that never tried, and the difference matters a lot.
      return msg.coding
        ? { ...msg, coding: { ...msg.coding,
            commits: [...(msg.coding.commits || []),
                      { sha: ev.sha, message: ev.message, files: ev.files,
                        failed: !ev.committed, error: ev.error }] } }
        : msg
    case 'coding_done':
      // Activity is deliberately kept, unlike research: a coding run's tool
      // calls are how you work out why a diff looks the way it does, and that
      // question is asked after the run, not during it.
      return msg.coding
        ? { ...msg, coding: { ...msg.coding, status: ev.status, prUrl: ev.pr_url,
                              summary: ev.summary } }
        : msg
    case 'research_plan':
      return { ...msg, research: ev.objectives.map(o => ({ objective: o, status: 'running' })) }
    case 'research_activity':
      return {
        ...msg,
        research: (msg.research || []).map((r, i) => i === ev.index
          ? { ...r, activity: [...(r.activity || []), { tool: ev.tool, detail: ev.detail, status: ev.status }].slice(-20) }
          : r),
      }
    case 'research_retry':
      return {
        ...msg,
        research: (msg.research || []).map((r, i) => i === ev.index
          ? { ...r, status: 'running', retried: true, activity: [] }
          : r),
      }
    case 'research_done':
      return {
        ...msg,
        research: (msg.research || []).map((r, i) => i === ev.index
          ? { ...r, status: ev.status, summary: ev.summary, detail: ev.detail, activity: undefined }
          : r),
      }
    default:
      return msg
  }
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const Ctx = createContext(null)

export function AssistantProvider({ children }) {
  const { token } = useAuth()
  const { refresh } = useRefresh()
  const [messages, setMessages] = useState(() => {
    const stored = loadJson(STORE_KEY, [])
    return Array.isArray(stored) ? stored : []
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const runRef = useRef(null)

  // Persist so the thread survives reload / PWA relaunch, not just navigation.
  // Tool arguments, results and research summaries are dropped on the way out —
  // they run to several KB each and would blow the quota within a few threads.
  // The durable run on the server keeps the full record.
  useEffect(() => {
    try {
      // runId is kept so the stripped detail can be fetched back from the server.
      const slim = messages.slice(-MAX_STORED).map(m => ({
        ...m,
        tools: (m.tools || []).map(t => typeof t === 'string'
          ? t : { name: t.name, status: t.status, toolUseId: t.toolUseId }),
        research: m.research?.map(({ objective, status, retried }) => ({ objective, status, retried })),
        question: m.question,
        coding: m.coding && { repo: m.coding.repo, branch: m.coding.branch,
                              status: m.coding.status, prUrl: m.coding.prUrl,
                              commits: m.coding.commits },
      }))
      localStorage.setItem(STORE_KEY, JSON.stringify(slim))
    } catch { /* quota — thread just won't survive reload */ }
  }, [messages])

  const patchLast = useCallback(fn => setMessages(prev => {
    if (prev.length === 0) return prev
    const next = [...prev]
    next[next.length - 1] = fn(next[next.length - 1])
    return next
  }), [])

  /**
   * Follow a run's event stream. Runs are durable server-side, so this can
   * attach to a run started minutes ago on another device: `after` replays
   * everything already stored before switching to live updates.
   */
  const follow = useCallback(async (runId, after = 0) => {
    const controller = new AbortController()
    abortRef.current = controller
    runRef.current = runId
    localStorage.setItem(RUN_KEY, JSON.stringify({ runId, after }))
    setBusy(true)

    let seq = after
    let touchedData = false

    try {
      const res = await fetch(`${API}/assistant/runs/${runId}/events?after=${after}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Could not follow the assistant (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      outer: for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const frames = buffer.split('\n\n')
        buffer = frames.pop()

        for (const frame of frames) {
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue          // keep-alive comment frame
          let ev
          try { ev = JSON.parse(line.slice(6)) } catch { continue }

          if (typeof ev.seq === 'number') {
            seq = ev.seq
            localStorage.setItem(RUN_KEY, JSON.stringify({ runId, after: seq }))
          }

          if (ev.type === 'done') break outer
          if (ev.type === 'error') { setError(ev.message); continue }
          if (ev.type === 'tool' && MUTATING_TOOLS.has(ev.name)) touchedData = true
          patchLast(m => reduceMessage(m, ev))
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Lost contact with the assistant.')
    } finally {
      setBusy(false)
      abortRef.current = null
      runRef.current = null
      localStorage.removeItem(RUN_KEY)
      setMessages(prev => {
        const last = prev[prev.length - 1]
        return last?.role === 'assistant' && !last.content && (last.tools?.length ?? 0) === 0
          ? prev.slice(0, -1) : prev
      })
      if (touchedData) refresh()
    }
  }, [token, patchLast, refresh])

  /**
   * Rebuild the detail stripped from a stored thread.
   *
   * localStorage keeps only the shape of a past turn — tool names, objectives,
   * statuses — because the arguments, results and summaries are far too large.
   * Replaying the run's stored events through the same reducer restores it, so
   * expanding an old answer after a reload shows what it showed live.
   */
  const rehydrate = useCallback(async (runIds) => {
    const histories = await Promise.all(runIds.map(async id => {
      try {
        const res = await fetch(`${API}/assistant/runs/${id}/history`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return null
        const { events } = await res.json()
        return [id, events]
      } catch {
        return null
      }
    }))
    const byRun = new Map(histories.filter(Boolean))
    if (byRun.size === 0) return

    setMessages(prev => prev.map(m => {
      const events = m.runId && byRun.get(m.runId)
      if (!events) return m
      // Content is already stored in full; replaying tokens would double it.
      const detail = events.filter(e => e.type !== 'token')
      return detail.reduce(reduceMessage, { ...m, tools: [], research: undefined })
    }))
  }, [token])

  // On load, restore detail for the most recent turns that have a run behind
  // them. Bounded because each history is a few hundred KB.
  useEffect(() => {
    if (!token) return
    const ids = messages
      .filter(m => m.role === 'assistant' && m.runId && !m.rehydrated)
      .slice(-3)
      .map(m => m.runId)
    if (ids.length === 0) return
    setMessages(prev => prev.map(m => ids.includes(m.runId) ? { ...m, rehydrated: true } : m))
    rehydrate(ids)
  }, [token]) // eslint-disable-line

  // Reattach to a run that was still going when the app was last closed.
  useEffect(() => {
    if (!token) return
    const saved = loadJson(RUN_KEY, null)
    if (!saved?.runId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API}/assistant/runs?limit=10`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const { runs } = await res.json()
        const run = runs.find(r => r.id === saved.runId)
        if (!cancelled && run?.status === 'running') follow(saved.runId, saved.after ?? 0)
        else localStorage.removeItem(RUN_KEY)
      } catch { /* offline — leave the marker for next launch */ }
    })()
    return () => { cancelled = true }
  }, [token]) // eslint-disable-line

  const clear = useCallback(() => {
    abortRef.current?.abort()
    localStorage.removeItem(RUN_KEY)
    setMessages([])
    setError(null)
  }, [])

  const stop = useCallback(async () => {
    const runId = runRef.current
    abortRef.current?.abort()
    if (runId) {
      // Stop the work itself, not just our view of it — the run is server-side.
      try {
        await fetch(`${API}/assistant/runs/${runId}/cancel`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        })
      } catch { /* it will time out on its own */ }
    }
  }, [token])

  /**
   * Answer a question a running agent is blocked on.
   *
   * State is not updated here — the agent echoes a question_answered event back
   * down the same stream, so the live path and a reload replay stay identical.
   */
  const answer = useCallback(async (runId, questionId, text) => {
    const res = await fetch(`${API}/assistant/runs/${runId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question_id: questionId, answer: text }),
    })
    if (!res.ok) {
      throw new Error(res.status === 409
        ? 'That question is no longer waiting for an answer.'
        : 'Could not send your answer.')
    }
  }, [token])

  const send = useCallback(async (text) => {
    const prompt = (text || '').trim()
    if (!prompt || busy) return

    // The agent is stateless — it gets the whole thread on every turn.
    const history = [...messages, { role: 'user', content: prompt }]
    setMessages([...history, { role: 'assistant', content: '', tools: [] }])
    setError(null)
    setBusy(true)

    try {
      const res = await fetch(`${API}/assistant/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      })
      if (!res.ok) throw new Error(res.status === 403 ? 'Not authorised to use the assistant.' : `Assistant error (${res.status})`)
      const { run_id } = await res.json()
      patchLast(m => ({ ...m, runId: run_id }))
      await follow(run_id, 0)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
      setBusy(false)
    }
  }, [messages, busy, token, follow])

  return (
    <Ctx.Provider value={{ messages, busy, error, send, stop, clear, answer }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAssistant = () => useContext(Ctx)
