import { useState, useRef, useEffect, useCallback } from 'react'
import { marked } from 'marked'
import AtlasOrb from './AtlasOrb.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { assistantPrompts } from '../data.js'

marked.use({ gfm: true, breaks: true })

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// MCP tool name → what to show while it runs
const TOOL_LABELS = {
  list_todos: 'Reading your to-dos',
  add_todo: 'Adding a to-do',
  complete_todo: 'Completing a to-do',
  move_todo: 'Moving a to-do',
  delete_todo: 'Deleting a to-do',
  get_week_outcomes: 'Reading your weekly outcomes',
  set_week_outcomes: 'Updating your weekly outcomes',
  list_habits: 'Checking your habits',
  log_habit: 'Logging a habit',
  list_goals: 'Reading your goals',
  get_finances_summary: 'Reviewing your finances',
  list_transactions: 'Reading your transactions',
  list_notes: 'Reading your notes',
  search_notes: 'Searching your notes',
  create_note: 'Writing a note',
  update_note: 'Updating a note',
  list_events: 'Checking your calendar',
  get_today_summary: 'Pulling together today',
  list_github_notes: 'Listing your GitHub notes',
  read_github_note: 'Reading a GitHub note',
  write_github_note: 'Drafting a GitHub note',
  create_github_folder: 'Drafting a new folder',
  list_github_drafts: 'Checking your drafts',
  read_github_draft: 'Reading a draft',
}

const toolLabel = name => TOOL_LABELS[name] || name.replace(/_/g, ' ')

function ToolTrace({ tools }) {
  if (tools.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
      {tools.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#c15f3c', flexShrink: 0, opacity: .6 }} />
          {toolLabel(t)}
        </div>
      ))}
    </div>
  )
}

// Both states share this measure so the column doesn't jump width on first send.
const COLUMN = 720

export default function AssistantChat({ orbSize = 200, ring1 = 300, ring2 = 240 }) {
  const { token } = useAuth()
  // The mobile shell renders the assistant with no padding (it was built for the
  // centred orb), so the chat supplies its own gutters and safe-area inset there.
  const isMobile = useIsMobile()
  const gutter = isMobile ? 16 : 0
  const [messages, setMessages] = useState([])   // { role, content, tools? }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)
  const taRef = useRef(null)
  const abortRef = useRef(null)

  const empty = messages.length === 0

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(async (text) => {
    const prompt = text.trim()
    if (!prompt || busy) return

    // The agent is stateless — it gets the whole thread on every turn.
    const history = [...messages, { role: 'user', content: prompt }]
    setMessages([...history, { role: 'assistant', content: '', tools: [] }])
    setInput('')
    setError(null)
    setBusy(true)

    const patchLast = fn => setMessages(prev => {
      const next = [...prev]
      next[next.length - 1] = fn(next[next.length - 1])
      return next
    })

    const controller = new AbortController()
    abortRef.current = controller

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
          else if (ev.type === 'tool') patchLast(m => ({ ...m, tools: [...m.tools, ev.name] }))
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
    }
  }, [messages, busy, token])

  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const composer = (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, width: '100%', maxWidth: 560, padding: '12px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd-lg)', boxShadow: '0 4px 18px var(--bd-xs)' }}>
      <textarea
        ref={taRef}
        rows={1}
        value={input}
        onChange={e => {
          setInput(e.target.value)
          const el = taRef.current
          if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px' }
        }}
        onKeyDown={onKeyDown}
        placeholder="Message Atlas…"
        style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)', lineHeight: 1.5, maxHeight: 140 }}
      />
      <button
        onClick={() => (busy ? abortRef.current?.abort() : send(input))}
        disabled={!busy && !input.trim()}
        style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, border: 'none', background: busy || input.trim() ? '#c15f3c' : 'var(--surface-3)', color: busy || input.trim() ? '#fff' : 'var(--faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: busy || input.trim() ? 'pointer' : 'default', transition: 'all .12s' }}
      >
        {busy
          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
          : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l16 8-16 8 3-8z" /></svg>}
      </button>
    </div>
  )

  if (empty) {
    return (
      <div style={{ flex: 1, minHeight: 0, height: '100%', width: '100%', maxWidth: COLUMN, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: `24px ${Math.max(gutter, orbSize < 160 ? 20 : 0)}px`, paddingBottom: isMobile ? 'max(24px, env(safe-area-inset-bottom))' : 24 }}>
        <AtlasOrb orbSize={orbSize} ring1={ring1} ring2={ring2} />

        <h1 style={{ margin: '14px 0 6px', fontFamily: "'Newsreader', serif", fontSize: 30, fontWeight: 500, color: 'var(--ink)' }}>
          How can I help you plan today?
        </h1>
        <p style={{ margin: '0 0 26px', fontSize: 14.5, color: 'var(--mid)', maxWidth: 440, lineHeight: 1.55 }}>
          Ask me to schedule your week, review your spending, or reflect on a goal. I have the full picture.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 560, marginBottom: 26 }}>
          {assistantPrompts.map(p => (
            <button key={p} onClick={() => send(p)}
              style={{ padding: '9px 15px', borderRadius: 99, background: 'var(--surface)', border: '1px solid var(--bd)', fontSize: 13, fontFamily: 'inherit', color: 'var(--ink-2)', cursor: 'pointer' }}>
              {p}
            </button>
          ))}
        </div>

        {composer}
        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: '#c15f3c' }}>{error}</div>}
      </div>
    )
  }

  return (
    // flex:1 + minHeight:0 rather than a hardcoded viewport calc — this component
    // is mounted inside desktop, tablet and mobile shells with different chrome.
    <div style={{ flex: 1, minHeight: 0, height: '100%', width: '100%', maxWidth: COLUMN, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: `8px ${gutter}px 20px`, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.map((m, i) => m.role === 'user' ? (
          <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '80%', padding: '10px 15px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd)', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>
            {m.content}
          </div>
        ) : (
          <div key={i} style={{ maxWidth: '100%' }}>
            <ToolTrace tools={m.tools} />
            {m.content
              ? <div className="md-prose" style={{ fontSize: 14.5, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: marked.parse(m.content) }} />
              : busy && i === messages.length - 1 && m.tools.length === 0 &&
                  <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Thinking…</span>}
          </div>
        ))}
        {error && <div style={{ fontSize: 12.5, color: '#c15f3c' }}>{error}</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: `0 ${gutter}px`, paddingBottom: isMobile ? 'max(8px, env(safe-area-inset-bottom))' : 8 }}>{composer}</div>
    </div>
  )
}
