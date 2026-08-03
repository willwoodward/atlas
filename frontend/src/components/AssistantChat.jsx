import { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import AtlasOrb from './AtlasOrb.jsx'
import { useAssistant } from '../context/AssistantContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { assistantPrompts } from '../data.js'

marked.use({ gfm: true, breaks: true })
// Citations point off-site, so they must not navigate away from the app.
marked.use({
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const t = title ? ` title="${title}"` : ''
      return `<a href="${href}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`
    },
  },
})

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
  delegate_research: 'Sending out a research team',
  tavily_search: 'Searching the web',
  tavily_extract: 'Reading a page',
  http_request: 'Fetching a page',
  create_event: 'Adding to your calendar',
  update_event: 'Rescheduling an event',
  delete_event: 'Removing a calendar event',
  get_today_summary: 'Pulling together today',
  list_github_notes: 'Listing your GitHub notes',
  read_github_note: 'Reading a GitHub note',
  write_github_note: 'Drafting a GitHub note',
  create_github_folder: 'Drafting a new folder',
  list_github_drafts: 'Checking your drafts',
  read_github_draft: 'Reading a draft',
}

const toolLabel = name => TOOL_LABELS[name] || name.replace(/_/g, ' ')

function prettyJson(raw) {
  if (!raw) return ''
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function ToolTrace({ tools = [] }) {
  const [open, setOpen] = useState({})
  if (tools.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
      {tools.map((t, i) => {
        // Threads saved before tool details existed stored plain names.
        const tool = typeof t === 'string' ? { name: t } : t
        const failed = tool.status === 'error'
        const hasDetail = tool.input || tool.output
        const isOpen = open[i]
        return (
          <div key={i}>
            <div
              onClick={() => hasDetail && setOpen(p => ({ ...p, [i]: !p[i] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: failed ? '#c15f3c' : 'var(--muted)', cursor: hasDetail ? 'pointer' : 'default' }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: failed ? '#c15f3c' : '#c15f3c', flexShrink: 0, opacity: failed ? 1 : .6 }} />
              {toolLabel(tool.name)}
              {failed && <span style={{ fontSize: 11 }}>· failed</span>}
              {hasDetail && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ color: 'var(--faint)', transition: 'transform .18s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                  <path d="M9 6l6 6-6 6" />
                </svg>
              )}
            </div>
            {isOpen && hasDetail && (
              <div style={{ margin: '6px 0 6px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tool.input && <CodeBlock label="Arguments" body={prettyJson(tool.input)} />}
                {tool.output && <CodeBlock label={failed ? 'Error' : 'Result'} body={tool.output} tone={failed ? '#c15f3c' : undefined} />}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CodeBlock({ label, body, tone }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 3 }}>{label}</div>
      <pre style={{ margin: 0, padding: '8px 10px', borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--bd-sm)', fontSize: 11.5, lineHeight: 1.5, color: tone || 'var(--mid)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto' }}>{body}</pre>
    </div>
  )
}

/**
 * A dispatched research team. Each objective is one subagent working in
 * parallel — this is the only window into a run that can take minutes, so it
 * shows what each one is chasing and ticks them off as they report back.
 */
function ResearchPanel({ research }) {
  const [open, setOpen] = useState({})
  if (!research?.length) return null
  const done = research.filter(r => r.status !== 'running').length
  return (
    <div style={{ margin: '4px 0 12px', padding: '11px 13px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>
          Research team
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{done} / {research.length} reported</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {research.map((r, i) => {
          const running = r.status === 'running'
          const failed = !running && r.status !== 'ok'
          const body = failed ? r.detail : r.summary
          const steps = r.activity || []
          // Collapsed by default: an open trace grows while you read, which
          // shifts everything below it.
          const expandable = body || (running && steps.length > 0)
          const isOpen = open[i]
          return (
            <div key={i}>
              <div
                onClick={() => expandable && setOpen(p => ({ ...p, [i]: !p[i] }))}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: running ? 'var(--mid)' : 'var(--muted)', cursor: expandable ? 'pointer' : 'default' }}
              >
                <span style={{ flexShrink: 0, marginTop: 1, width: 13, textAlign: 'center', color: failed ? '#c15f3c' : running ? '#c15f3c' : '#6f8168' }}>
                  {running
                    ? <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'atlas-pulse 1.2s ease-in-out infinite' }} />
                    : failed ? '!' : '✓'}
                </span>
                <span style={{ flex: 1 }}>
                  {r.objective}
                  {/* Step count stands in for the trace so the row height is stable. */}
                  {running && steps.length > 0 && (
                    <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--faint)' }}>
                      {steps.length} step{steps.length === 1 ? '' : 's'} · {toolLabel(steps[steps.length - 1].tool)}
                    </span>
                  )}
                </span>
                {expandable && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ flexShrink: 0, marginTop: 3, color: 'var(--faint)', transition: 'transform .18s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                )}
              </div>
              {isOpen && (
                <div style={{ margin: '7px 0 4px 21px', padding: '9px 11px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--bd-sm)' }}>
                  {running
                    ? steps.map((a, k) => (
                        <div key={k} style={{ fontSize: 11.5, lineHeight: 1.5, color: a.status === 'error' ? '#c15f3c' : 'var(--muted)', wordBreak: 'break-word' }}>
                          <span style={{ color: 'var(--faint)' }}>{toolLabel(a.tool)}</span>
                          {a.detail ? ` · ${a.detail}` : ''}
                        </div>
                      ))
                    : failed
                      ? <div style={{ fontSize: 12, color: '#c15f3c', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>{body}</div>
                      : <div className="md-prose" style={{ fontSize: 12.5, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: marked.parse(body || '') }} />}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <style>{'@keyframes atlas-pulse{0%,100%{opacity:.25}50%{opacity:1}}'}</style>
    </div>
  )
}

// Both states share this measure so the column doesn't jump width on first send.
const COLUMN = 720

export default function AssistantChat({ orbSize = 200, ring1 = 300, ring2 = 240 }) {
  // Thread state lives in AssistantContext so it survives navigating away and back.
  const { messages, busy, error, send, stop, clear } = useAssistant()
  // The mobile shell renders the assistant with no padding (it was built for the
  // centred orb), so the chat supplies its own gutters and safe-area inset there.
  const isMobile = useIsMobile()
  const gutter = isMobile ? 16 : 0
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)
  const taRef = useRef(null)

  const empty = messages.length === 0

  // Only stick to the bottom if you were already there. Research turns update
  // many times a second, and yanking the view down while you are reading
  // something further up is worse than losing the follow.
  useEffect(() => {
    const page = isMobile ? scrollRef.current : scrollRef.current?.parentElement
    if (!page) return
    const nearBottom = page.scrollHeight - page.scrollTop - page.clientHeight < 120
    if (nearBottom) page.scrollTo({ top: page.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, isMobile])

  const submit = (text) => {
    send(text)
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input) }
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
        onClick={() => (busy ? stop() : submit(input))}
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
            <button key={p} onClick={() => submit(p)}
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
    // The desktop and tablet shells provide the page-level scroll container;
    // mobile keeps it here because its shell deliberately hides page overflow.
    <div ref={scrollRef} style={{ flex: 1, minWidth: 0, minHeight: '100%', width: '100%', maxWidth: COLUMN, margin: '0 auto', display: 'flex', flexDirection: 'column', overflowY: isMobile ? 'auto' : 'visible', overflowX: 'hidden' }}>
      {/* Threads now persist across navigation and reloads, so there has to be a way out. */}
      <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', padding: `6px ${gutter}px 0` }}>
        <button onClick={clear}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--muted)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New chat
        </button>
      </div>
      <div style={{ padding: `8px ${gutter}px 20px`, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.map((m, i) => m.role === 'user' ? (
          <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '80%', padding: '10px 15px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd)', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>
            {m.content}
          </div>
        ) : (
          <div key={i} style={{ maxWidth: '100%' }}>
            <ToolTrace tools={m.tools} />
            <ResearchPanel research={m.research} />
            {m.content
              ? <div className="md-prose" style={{ fontSize: 14.5, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: marked.parse(m.content) }} />
              : busy && i === messages.length - 1 && (m.tools?.length ?? 0) === 0 && !m.research?.length &&
                  <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Thinking…</span>}
          </div>
        ))}
        {error && <div style={{ fontSize: 12.5, color: '#c15f3c' }}>{error}</div>}
      </div>

      <div style={{ position: 'sticky', bottom: 0, zIndex: 1, display: 'flex', justifyContent: 'center', padding: `8px ${gutter}px`, paddingBottom: isMobile ? 'max(8px, env(safe-area-inset-bottom))' : 8, background: 'var(--bg)' }}>{composer}</div>
    </div>
  )
}
