import { approvalTitle } from '../components/ApprovalCard.jsx'
import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'
import { onShortcut } from './KeybindsContext.jsx'
import { speech, shouldSpeak } from '../lib/speech.js'
import { getVoiceSettings } from '../lib/voiceSettings.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
// A copy of the current session, so the thread paints instantly on launch.
// The server is the source of truth; this is replaced on the first sync.
const STORE_KEY = 'atlas:assistant-session:v2'
const OLD_KEYS = ['atlas:assistant-thread:v1', 'atlas:assistant-run:v1']
const MAX_STORED = 40
// How often an open app checks for turns sent from another device.
const POLL_MS = 5000
// Tools that change the assistant's own documents, and which document.
const DOC_TOOLS = { write_memory: 'memory', edit_memory: 'memory', write_system_prompt: 'prompt', edit_system_prompt: 'prompt' }

// Tools that write. After a turn that used any of these, the data contexts
// must refetch or the UI keeps showing pre-agent state.
const MUTATING_TOOLS = new Set([
  'add_todo', 'complete_todo', 'move_todo', 'delete_todo', 'set_week_outcomes',
  'log_habit', 'create_note', 'update_note',
  'write_github_note', 'create_github_folder',
  'create_event', 'update_event', 'delete_event',
  'set_transaction_category', 'rename_category', 'add_category_rule', 'set_budget',
  'create_habit', 'update_goal', 'add_subtask', 'append_to_note', 'delete_note',
  'create_routine', 'update_routine', 'delete_routine', 'run_routine',
])

/**
 * What the chat needs from a tool's JSON result:
 *   undoId — the change was logged and can be undone
 *   card   — something to draw (a breakdown, a day, a list)
 *   cards  — several, in order (e.g. today's summary: the day and the to-dos)
 *   show   — what to open to see it
 * Undefined fields when the result has none (or isn't JSON).
 */
export function readToolResult(output) {
  if (!output || output[0] !== '{') return {}
  try {
    const r = JSON.parse(output)
    return { undoId: r.undo_id || undefined, card: r.card || undefined, cards: Array.isArray(r.cards) ? r.cards : undefined, show: r.show || undefined }
  } catch {
    return {}   // cut off by the size cap, or not JSON
  }
}

/** What a memory / system-prompt tool's result says changed, for the chat's Undo. */
export function memoryEdit(name, output) {
  if (!DOC_TOOLS[name] || !output) return undefined
  try {
    const r = JSON.parse(output)
    if (!r.ok || r.unchanged) return undefined
    return { kind: DOC_TOOLS[name], version: r.version, previous: r.previous_version ?? 0 }
  } catch {
    return undefined
  }
}

/**
 * Apply one streamed event to an assistant message.
 *
 * Pure, so the live stream and the replay of a stored run share exactly one
 * implementation — a divergence between them would show as detail that looks
 * different after a reload than it did live.
 */
/** A question as said aloud. An approval asks for an OK on screen. */
function spokenQuestion(ev) {
  if (ev.kind !== 'approval') return ev.question
  if (ev.summary) return `I need your OK to ${ev.summary.replace(/^./, c => c.toLowerCase())}. Approve or reject it on screen.`
  const what = approvalTitle({ tool: ev.tool }).replace(/^./, c => c.toLowerCase())
  return `I need your OK before ${what}. Approve or reject it on screen.`
}

const AGENT_KEY = 'atlas:chat-agent'

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
            ? { ...t, status: ev.status, input: ev.input, output: ev.output,
                memory: memoryEdit(t.name, ev.output), ...readToolResult(ev.output) }
            : t),
      }
    case 'question':
      return {
        ...msg,
        question: { id: ev.questionId, text: ev.question, options: ev.options || [], status: 'open',
                    // An "ask first" tool (Agents page): drawn as an approve card.
                    ...(ev.kind === 'approval' && { kind: 'approval', tool: ev.tool, input: ev.input || {}, agent: ev.agent, summary: ev.summary }) },
      }
    case 'agent_activity':
      // One of the user's own agents at work (Atlas handed it a task).
      return { ...msg, agentActivity: [...(msg.agentActivity || []), { agent: ev.agent, tool: ev.tool, status: ev.status }].slice(-20) }
    case 'question_answered':
      return msg.question?.id === ev.questionId
        ? { ...msg, question: { ...msg.question, status: 'answered', answer: ev.answer } }
        : msg
    case 'question_timeout':
      return msg.question?.id === ev.questionId
        ? { ...msg, question: { ...msg.question, status: 'timeout' } }
        : msg
    case 'coding_started':
      // A revision already has its PR, so the link is available from the start
      // rather than only once the run finishes.
      return { ...msg, coding: { repo: ev.repo, branch: ev.branch, task: ev.task,
                                 mode: ev.mode || 'new', prNumber: ev.pr_number,
                                 prUrl: ev.pr_url,
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
        ? { ...msg, coding: { ...msg.coding, status: ev.status,
                              prUrl: ev.pr_url || msg.coding.prUrl,
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

const isLive = status => status === 'running' || status === 'awaiting_input'

/**
 * Lay the server's view of a session over what this device already shows.
 *
 * The server knows every turn (including ones sent from another device) but only
 * their text; this device may hold the detail of turns it watched — tool calls,
 * research, questions. Turns are matched by run id, so that detail survives.
 * Returns `local` itself when nothing changed, so polling doesn't re-render.
 */
export function mergeThread(local, server) {
  const mine = new Map(local.filter(m => m.role === 'assistant' && m.runId).map(m => [m.runId, m]))
  const next = server.map(m => {
    if (m.role === 'user') return { role: 'user', content: m.content, runId: m.runId }
    const have = mine.get(m.runId)
    // A turn still running is rebuilt by replaying its events, text included.
    if (isLive(m.status)) return { role: 'assistant', content: '', tools: [], runId: m.runId }
    const base = have || { role: 'assistant', tools: [], runId: m.runId }
    return { ...base, content: m.content || base.content || '', error: m.content ? undefined : m.error || undefined }
  })
  const same = next.length === local.length && next.every((m, i) =>
    m.role === local[i].role && m.runId === local[i].runId && m.content === local[i].content && m.error === local[i].error)
  return same ? local : next
}

const Ctx = createContext(null)

export function AssistantProvider({ children }) {
  const { token } = useAuth()
  const { refresh } = useRefresh()
  const [initial] = useState(() => {
    for (const k of OLD_KEYS) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
    const stored = loadJson(STORE_KEY, null)
    // Don't flash a thread that has already gone stale; the sync would clear it.
    if (!stored || !Array.isArray(stored.messages) || (stored.expiresAt && new Date(stored.expiresAt) < new Date())) {
      return { sessionId: null, messages: [] }
    }
    return { sessionId: stored.sessionId ?? null, messages: stored.messages }
  })
  const initialSession = initial.sessionId
  const initialMessages = initial.messages
  const [messages, setMessages] = useState(initialMessages)
  const [sessionId, setSessionId] = useState(initialSession)
  const [expiresAt, setExpiresAt] = useState(null)
  // Chats are temporary unless kept (backend/conversations.py).
  const [kept, setKept] = useState(false)
  // Who you're talking to (Agents page): Atlas or one of your agents. The
  // current chat's agent, or the one picked for the next chat. Remembered.
  const [chatAgent, setChatAgent] = useState(() => { try { return localStorage.getItem(AGENT_KEY) || 'atlas' } catch { return 'atlas' } })
  const chatAgentRef = useRef(chatAgent)
  chatAgentRef.current = chatAgent
  useEffect(() => { try { localStorage.setItem(AGENT_KEY, chatAgent) } catch { /* not kept */ } }, [chatAgent])
  const [busy, setBusy] = useState(false)
  // Messages sent while Atlas was answering, oldest first. Each goes when the
  // turn before it has finished, so replies stay in order. Kept on this device.
  const [queued, setQueued] = useState([])
  const [hold, setHold] = useState(false)   // brief pause after a "still answering" refusal
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const runRef = useRef(null)
  const sentHere = useRef(new Set())   // runs this device started
  const speakRuns = useRef(new Set())  // …and whose replies are read aloud
  const liveRuns = useRef(new Map())   // …and whose answers go back to fast voice (GPT-Live)
  const busyRef = useRef(false)
  const sessionRef = useRef(initialSession)
  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  // Spoken replies fetch their audio from the API with this device's token.
  useEffect(() => {
    // A stream of raw PCM per piece of text (backend/speech_engine.py).
    speech.setFetcher(async (text, signal) => {
      const res = await fetch(`${API}/assistant/speak`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: text.slice(0, 2000), voice: getVoiceSettings().ttsVoice }),
      })
      if (!res.ok) throw new Error(`speak ${res.status}`)
      return res
    })
    speech.setWarmer(() => fetch(`${API}/assistant/speak/warm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ voice: getVoiceSettings().ttsVoice }),
    }).catch(() => {}))
  }, [token])

  // Cache for an instant first paint. Tool arguments, results and research
  // summaries are dropped — they run to several KB each; the server keeps the
  // full record and rehydrate() fetches it back.
  useEffect(() => {
    try {
      const slim = messages.slice(-MAX_STORED).map(({ rehydrated, ...m }) => ({
        ...m,
        tools: (m.tools || []).map(t => typeof t === 'string'
          ? t : { name: t.name, status: t.status, toolUseId: t.toolUseId, memory: t.memory,
                  undoId: t.undoId, card: t.card, cards: t.cards, show: t.show }),
        research: m.research?.map(({ objective, status, retried }) => ({ objective, status, retried })),
        question: m.question,
        coding: m.coding && { repo: m.coding.repo, branch: m.coding.branch,
                              status: m.coding.status, prUrl: m.coding.prUrl,
                              commits: m.coding.commits },
      }))
      localStorage.setItem(STORE_KEY, JSON.stringify({ sessionId, expiresAt, messages: slim }))
    } catch { /* quota — the thread just won't paint before the first sync */ }
  }, [messages, sessionId, expiresAt])

  const patchLast = useCallback(fn => setMessages(prev => {
    if (prev.length === 0) return prev
    const next = [...prev]
    next[next.length - 1] = fn(next[next.length - 1])
    return next
  }), [])

  const setBusyBoth = useCallback(v => { busyRef.current = v; setBusy(v) }, [])

  /**
   * Follow a run's event stream. Runs are durable server-side, so this can
   * attach to a run started minutes ago on another device: `after` replays
   * everything already stored before switching to live updates.
   */
  const follow = useCallback(async (runId, after = 0) => {
    const controller = new AbortController()
    abortRef.current = controller
    runRef.current = runId
    setBusyBoth(true)

    let touchedData = false
    const writes = new Set()   // toolUseIds of tools that change data
    // Read aloud as it streams. A replay from the start would repeat what was
    // already said, so only a run followed from its first event is spoken.
    const speak = speakRuns.current.has(runId) && after === 0
    if (speak) speech.begin(runId)
    // Fast voice: tools as they start, then the whole answer at the end.
    const live = liveRuns.current.get(runId)
    let liveText = '', liveError = null

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

          if (ev.type === 'done') break outer
          if (speak && ev.type === 'token') speech.push(runId, ev.text)
          if (live) {
            if (ev.type === 'token') liveText += ev.text
            if (ev.type === 'tool') live.onTool?.(ev.name)
            if (ev.type === 'error') liveError = ev.message
            if (ev.type === 'question') liveText += (liveText ? '\n\n' : '') + spokenQuestion(ev)
          }
          if (speak && ev.type === 'question') { speech.end(runId); speech.say(spokenQuestion(ev)) }
          if (ev.type === 'error') { setError(ev.message); continue }
          if (ev.type === 'tool' && MUTATING_TOOLS.has(ev.name)) { touchedData = true; writes.add(ev.toolUseId) }
          // Show each change as soon as it lands, not only when the reply ends.
          if (ev.type === 'tool_result' && writes.has(ev.toolUseId) && ev.status !== 'error') refresh()
          // Open what a tool points at — only on the device that asked, so the
          // phone doesn't jump around while you're using the laptop.
          // Two cases: an explicit `show`, or a change Atlas made (follow-along).
          // A read-only tool's `show` is only for its card's Open button.
          if (ev.type === 'tool_result' && ev.status !== 'error' && sentHere.current.has(runId)) {
            const { show } = readToolResult(ev.output)
            if (show && (show.explicit || writes.has(ev.toolUseId))) {
              window.dispatchEvent(new CustomEvent('atlas:show', { detail: show }))
            }
          }
          patchLast(m => m.runId === runId || !m.runId ? reduceMessage(m, ev) : m)
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Lost contact with the assistant.')
    } finally {
      if (speak) { speech.end(runId); speakRuns.current.delete(runId) }
      if (live) {
        liveRuns.current.delete(runId)
        if (liveError && !liveText) live.onError?.(liveError)
        else live.onDone?.(liveText)
      }
      setBusyBoth(false)
      abortRef.current = null
      runRef.current = null
      // Watched live, so its detail is all here already.
      setMessages(prev => prev.map(m => m.role === 'assistant' && m.runId === runId ? { ...m, rehydrated: true } : m))
      if (touchedData) refresh()
    }
  }, [token, patchLast, refresh, setBusyBoth])

  /**
   * Bring this device up to date with the session on the server: turns sent
   * from elsewhere appear, a stale session clears, and a turn still running
   * (perhaps started on the phone) is followed live.
   */
  const sync = useCallback(async () => {
    if (!token || busyRef.current) return
    let body
    try {
      const res = await fetch(`${API}/assistant/sessions/current`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      body = await res.json()
    } catch {
      return // offline — keep showing what we have
    }
    if (busyRef.current) return // a send started while we were asking
    setSessionId(body.session?.id ?? null)
    setExpiresAt(body.session?.expires_at ?? null)
    setKept(!!body.session?.kept)
    // The conversation going on (maybe from another device) decides who it's with.
    if (body.session) setChatAgent(body.session.agent_id || 'atlas')
    if (!body.session) setError(null)
    setMessages(prev => mergeThread(prev, body.messages || []))
    const active = body.active_run
    if (active && runRef.current !== active.id) follow(active.id, 0)
  }, [token, follow])

  // On launch, whenever the app comes back into view, and every few seconds
  // while it is visible.
  useEffect(() => {
    if (!token) return
    sync()
    const onShow = () => { if (document.visibilityState === 'visible') sync() }
    const id = setInterval(onShow, POLL_MS)
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', onShow)
    }
  }, [token, sync])

  /**
   * Rebuild the detail of turns this device didn't watch, or watched before a
   * reload. Replaying the run's stored events through the same reducer
   * restores what it showed live.
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
      const events = m.role === 'assistant' && m.runId && byRun.get(m.runId)
      if (!events) return m
      // Content is already stored in full; replaying tokens would double it.
      const detail = events.filter(e => e.type !== 'token' && e.type !== 'error')
      return detail.reduce(reduceMessage, { ...m, tools: [], research: undefined, rehydrated: true })
    }))
  }, [token])

  // Restore detail for the most recent finished turns that lack it. Bounded
  // because each history can be a few hundred KB.
  const pendingDetail = messages
    .filter(m => m.role === 'assistant' && m.runId && !m.rehydrated && !(busy && m === messages[messages.length - 1]))
    .slice(-3).map(m => m.runId).join(',')
  const askedRef = useRef(new Set())
  useEffect(() => {
    if (!token || !pendingDetail) return
    const ids = pendingDetail.split(',').filter(id => !askedRef.current.has(id))
    if (ids.length === 0) return
    ids.forEach(id => askedRef.current.add(id))
    rehydrate(ids)
  }, [token, pendingDetail, rehydrate])

  /** New chat: end the session for every device. It stays in the session log. */
  const clear = useCallback(() => {
    abortRef.current?.abort()
    speech.cancel()
    const sid = sessionRef.current
    setMessages([])
    setQueued([])
    setSessionId(null)
    setExpiresAt(null)
    setKept(false)
    setError(null)
    if (sid) {
      fetch(`${API}/assistant/sessions/${sid}/close`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { /* it will go stale on its own */ })
    }
  }, [token])

  const stop = useCallback(async () => {
    // Stopping means stop: don't carry straight on with what was queued.
    setQueued([])
    speech.cancel()
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

  // `spoken`: said aloud, not typed. Whether the reply is read out follows
  // Assistant settings → Voice → "Read replies aloud".
  // `viaDock`: said to the corner mic, with no chat open.
  // `live`: from fast voice — { onTool, onDone, onError } get the turn's
  // progress and answer, and it isn't read aloud here (GPT-Live speaks it).
  const send = useCallback(async (text, { spoken = false, viaDock = false, live = null } = {}) => {
    const prompt = (text || '').trim()
    if (!prompt) return
    // Atlas is mid-answer: hold this one and send it when the turn finishes.
    if (busyRef.current) {
      setQueued(q => [...q, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: prompt, spoken, viaDock, live }])
      return
    }
    const aloud = !live && shouldSpeak(spoken, viaDock)

    // Only the new message goes up; the server holds the rest of the session.
    setMessages(prev => [...prev, { role: 'user', content: prompt }, { role: 'assistant', content: '', tools: [] }])
    setError(null)
    setBusyBoth(true)

    try {
      const res = await fetch(`${API}/assistant/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: prompt, session_id: sessionRef.current, spoken: aloud || !!live, voice_only: viaDock, agent_id: chatAgentRef.current }),
      })
      if (res.status === 409) {
        // A reply is still running that this device isn't following yet
        // (started on another device, or just after a reload). Queue this
        // message instead of dropping it, attach to that reply, and send when
        // it ends. The hold stops a tight retry loop if the server is a
        // moment behind.
        setMessages(prev => prev.slice(0, -2))
        setQueued(q => [{ id: `${Date.now()}-retry`, text: prompt, spoken, viaDock, live }, ...q])
        setHold(true)
        setTimeout(() => setHold(false), 2000)
        setBusyBoth(false)
        sync()
        return
      }
      if (!res.ok) {
        throw new Error(res.status === 403 ? 'Not authorised to use the assistant.' : `Assistant error (${res.status})`)
      }
      const { run_id, session_id, new_session } = await res.json()
      sentHere.current.add(run_id)
      if (aloud) speakRuns.current.add(run_id)
      if (live) liveRuns.current.set(run_id, live)
      setSessionId(session_id)
      sessionRef.current = session_id
      const pair = [{ role: 'user', content: prompt, runId: run_id }, { role: 'assistant', content: '', tools: [], runId: run_id }]
      // The old session had gone stale, so this message started a new one.
      setMessages(prev => new_session ? pair : [...prev.slice(0, -2), ...pair])
      await follow(run_id, 0)
    } catch (err) {
      setMessages(prev => prev.slice(0, -2))
      setError(err.message || 'Something went wrong.')
      setBusyBoth(false)
      live?.onError?.(err.message)
    }
    // Pick up the saved reply and the session's new expiry.
    sync()
  }, [token, follow, sync, setBusyBoth])

  // Send what was queued, one at a time, as each turn finishes.
  useEffect(() => {
    if (busy || hold || queued.length === 0) return
    const [next, ...rest] = queued
    setQueued(rest)
    send(next.text, { spoken: next.spoken, viaDock: next.viaDock, live: next.live })
  }, [busy, hold, queued, send])
  const unqueue = useCallback(id => setQueued(q => q.filter(x => x.id !== id)), [])

  // ── Keeping chats ──
  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API}/assistant${path}`, {
      ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json()).detail } catch { /* not JSON */ }
      throw new Error(typeof detail === 'string' && detail ? detail : `Error (${res.status})`)
    }
    return res.json()
  }, [token])

  /** Keep the current chat (or stop keeping it — then it's deleted once it's over). */
  const keep = useCallback(async (on, title) => {
    const sid = sessionRef.current
    if (!sid) return
    setKept(on)
    try {
      const r = await api(`/sessions/${sid}`, { method: 'PATCH', body: JSON.stringify({ kept: on, ...(title ? { title } : {}) }) })
      setKept(r.kept)
    } catch (e) { setKept(!on); setError(e.message) }
  }, [api])

  /** Talk to someone else: a new chat with them (the current one ends, as with "New chat"). */
  const chooseAgent = useCallback(id => {
    if (id === chatAgentRef.current) return
    if (sessionRef.current || messages.length) clear()
    chatAgentRef.current = id
    setChatAgent(id)
  }, [clear, messages.length])

  /** Carry on a kept chat: it becomes the current one on every device. */
  const resume = useCallback(async (id) => {
    if (busyRef.current) throw new Error('Atlas is still answering here.')
    const view = await api(`/sessions/${id}/resume`, { method: 'POST' })
    setSessionId(view.session.id)
    sessionRef.current = view.session.id
    setExpiresAt(view.session.expires_at)
    setKept(true)
    setChatAgent(view.session.agent_id || 'atlas')
    setQueued([])
    setError(null)
    setMessages(mergeThread([], view.messages || []))
  }, [api])

  // ── Voice shortcut ──
  // Each chat on screen registers a toggle; the shortcut goes to the most
  // recent one. With no chat on screen it goes to the corner mic (VoiceDock),
  // or — with "Voice shortcut opens the chat" on, or no corner mic — the
  // layout is asked to show a chat, which starts listening as it mounts.
  // A conversation already running in the corner keeps the shortcut.
  const voiceTargets = useRef([])
  const pendingVoice = useRef(false)
  const dock = useRef(null)            // { toggle, active }
  const [chatsOnScreen, setChatsOnScreen] = useState(0)
  const registerVoiceTarget = useCallback(fn => {
    voiceTargets.current.push(fn)
    setChatsOnScreen(voiceTargets.current.length)
    if (pendingVoice.current) { pendingVoice.current = false; setTimeout(fn, 0) }
    return () => {
      voiceTargets.current = voiceTargets.current.filter(f => f !== fn)
      setChatsOnScreen(voiceTargets.current.length)
    }
  }, [])
  const registerVoiceDock = useCallback(d => {
    dock.current = d
    return () => { if (dock.current === d) dock.current = null }
  }, [])
  useEffect(() => onShortcut('voice', () => {
    if (dock.current?.active()) return dock.current.toggle()
    const target = voiceTargets.current[voiceTargets.current.length - 1]
    if (target) return target()
    if (dock.current && !getVoiceSettings().voiceOpensChat) return dock.current.toggle()
    pendingVoice.current = true
    window.dispatchEvent(new CustomEvent('atlas:show-assistant'))
  }), [])

  return (
    <Ctx.Provider value={{ messages, busy, error, send, stop, clear, answer, registerVoiceTarget, registerVoiceDock, chatsOnScreen, queued, unqueue,
                          sessionId, kept, keep, resume, assistantApi: api, chatAgent, chooseAgent }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAssistant = () => useContext(Ctx)
