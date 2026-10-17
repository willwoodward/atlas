import { eyebrow } from './ui.jsx'
import { useState, useRef, useEffect } from 'react'
import { renderMarkdown } from '../lib/markdown.js'
import AtlasOrb from './AtlasOrb.jsx'
import { useAssistant } from '../context/AssistantContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { assistantPrompts } from '../data.js'
import { SettingsButton, MemoryEditChip } from './AssistantMemory.jsx'
import { ToolCards, ActionUndoChip } from './ChatCards.jsx'
import { voiceSupported } from '../hooks/useVoiceInput.js'
import { useVoiceConversation } from '../hooks/useVoiceConversation.js'
import { speech, useSpeaking, unlockAudio } from '../lib/speech.js'
import { useKeybinds } from '../context/KeybindsContext.jsx'
import { displayCombo } from '../lib/keybinds.js'

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
  read_memory: 'Reading its memory',
  write_memory: 'Saved to memory',
  edit_memory: 'Saved to memory',
  read_system_prompt: 'Reading its instructions',
  write_system_prompt: 'Updated its system prompt',
  edit_system_prompt: 'Updated its system prompt',
  finance_breakdown: 'Breaking down your money',
  compare_spending: 'Comparing periods',
  search_transactions: 'Searching transactions',
  list_categories: 'Reading your categories',
  list_recurring: 'Finding subscriptions and bills',
  get_budgets: 'Checking budgets',
  set_transaction_category: 'Categorised transactions',
  rename_category: 'Renamed a category',
  add_category_rule: 'Added a category rule',
  set_budget: 'Set a budget',
  search_events: 'Searching your calendar',
  find_free_time: 'Finding free time',
  show_day: 'Drawing the day',
  create_habit: 'Added a habit',
  update_goal: 'Updated a goal',
  add_subtask: 'Added a sub-task',
  append_to_note: 'Added to a note',
  delete_note: 'Deleted a note',
  show: 'Opening it for you',
}

export const toolLabel = name => TOOL_LABELS[name] || name.replace(/_/g, ' ')

function prettyJson(raw) {
  if (!raw) return ''
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function ToolTrace({ tools = [], latestUndo }) {
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
              style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: failed ? 'var(--accent)' : 'var(--muted)', cursor: hasDetail ? 'pointer' : 'default' }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: failed ? 'var(--accent)' : 'var(--accent)', flexShrink: 0, opacity: failed ? 1 : .6 }} />
              {toolLabel(tool.name)}
              {failed && <span style={{ fontSize: 11 }}>· failed</span>}
              {tool.memory && <MemoryEditChip edit={tool.memory} />}
              {tool.undoId && !tool.memory && <ActionUndoChip id={tool.undoId} isLatest={tool.undoId === latestUndo} />}
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
      <div style={{ ...eyebrow, fontSize: 10, marginBottom: 3 }}>{label}</div>
      <pre style={{ margin: 0, padding: '8px 10px', borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--bd-sm)', fontSize: 11.5, lineHeight: 1.5, color: tone || 'var(--mid)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto' }}>{body}</pre>
    </div>
  )
}

/**
 * A dispatched research team. Each objective is one subagent working in
 * parallel — this is the only window into a run that can take minutes, so it
 * shows what each one is chasing and ticks them off as they report back.
 */
/**
 * A question the agent is blocked on.
 *
 * Rendered inline in the thread rather than as a modal: the run is paused, not
 * urgent, and the user may want to read what the agent did before answering.
 * Answering is optimistic-free — the agent echoes question_answered back down
 * the stream, so this shows the answered state only once it has really landed.
 */
function QuestionPanel({ question, runId, onAnswer }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(null)
  if (!question) return null

  const submit = async (value) => {
    const body = (value ?? text).trim()
    if (!body || sending) return
    setSending(true)
    setFailed(null)
    try {
      await onAnswer(runId, question.id, body)
      setText('')
    } catch (err) {
      setFailed(err.message || 'Could not send your answer.')
    } finally {
      setSending(false)
    }
  }

  if (question.status === 'answered') {
    return (
      <div style={{ margin: '8px 0', fontSize: 12.5, color: 'var(--muted)' }}>
        <span style={{ color: 'var(--mid)' }}>{question.text}</span>
        <div style={{ marginTop: 2, color: 'var(--ink)' }}>→ {question.answer}</div>
      </div>
    )
  }

  if (question.status === 'timeout') {
    return (
      <div style={{ margin: '8px 0', fontSize: 12.5, color: 'var(--muted)' }}>
        {question.text} <em>— not answered in time; the agent carried on.</em>
      </div>
    )
  }

  return (
    <div style={{ margin: '10px 0', padding: 12, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--bd)' }}>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)', marginBottom: 8 }}>
        {question.text}
      </div>
      {question.options?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {question.options.map((o, i) => (
            <button key={i} onClick={() => submit(o)} disabled={sending}
              style={{ fontSize: 12.5, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
                       border: '1px solid var(--bd)', background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit' }}>
              {o}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={e => { e.preventDefault(); submit() }} style={{ display: 'flex', gap: 6 }}>
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Your answer…"
          disabled={sending}
          style={{ flex: 1, fontSize: 13, padding: '6px 9px', borderRadius: 7, border: '1px solid var(--bd-xl)',
                   background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
        />
        <button type="submit" disabled={sending || !text.trim()}
          style={{ fontSize: 12.5, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--bd)',
                   background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit' }}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
      {failed && <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 5 }}>{failed}</div>}
    </div>
  )
}

/**
 * A coding run in progress.
 *
 * Collapsed by default, like ResearchPanel — a 30-minute run emits a lot of tool
 * calls and an always-expanded list would push the page down continuously while
 * the user is trying to read something else.
 *
 * Commits are shown even when collapsed: they are the milestones that survive a
 * failed run, so "3 commits pushed" is the difference between a wasted half hour
 * and work waiting on a branch.
 */
function CodingPanel({ coding }) {
  const [open, setOpen] = useState(false)
  if (!coding) return null

  const { branch, status, commits = [], activity, prUrl, prNumber, summary, mode } = coding
  const revising = mode === 'revision'
  const saved = commits.filter(c => !c.failed)
  const failedCommits = commits.filter(c => c.failed)
  const running = status === 'running'
  const failed = status && status !== 'running' && status !== 'ok'
  const last = activity?.[activity.length - 1]

  return (
    <div style={{ margin: '8px 0', border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: 'none',
                 background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--ink)' }}
      >
        <span style={{ fontSize: 12, color: failed ? 'var(--accent)' : 'var(--muted)' }}>
          {running ? '○' : failed ? '!' : '●'}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {branch}
        </span>
        {revising && (
          <span style={{ fontSize: 10.5, color: 'var(--muted)', border: '1px solid var(--bd-xl)',
                         borderRadius: 5, padding: '1px 5px', flex: 'none' }}>
            revising{prNumber ? ` #${prNumber}` : ''}
          </span>
        )}
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {saved.length} commit{saved.length === 1 ? '' : 's'}
          {failedCommits.length > 0 ? ` · ${failedCommits.length} failed` : ''}
          {running && last ? ` · ${last.tool}` : ''}
        </span>
        <span style={{ fontSize: 10, color: 'var(--faint)' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 11px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {commits.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: c.failed ? 'var(--accent)' : 'var(--mid)', display: 'flex', gap: 6 }}>
              <code style={{ fontSize: 11, color: 'var(--faint)' }}>{c.failed ? '—' : c.sha}</code>
              <span style={{ flex: 1 }}>{c.message}{c.failed && c.error ? ` · ${c.error}` : ''}</span>
              {c.files ? <span style={{ color: 'var(--faint)', fontSize: 11 }}>{c.files}f</span> : null}
            </div>
          ))}
          {activity?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: commits.length ? 4 : 0 }}>
              {activity.map((a, i) => (
                <div key={i} style={{ fontSize: 11.5, color: a.status === 'error' ? 'var(--accent)' : 'var(--muted)',
                                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.tool}{a.detail ? ` · ${a.detail}` : ''}
                </div>
              ))}
            </div>
          )}
          {!running && summary && (
            <div style={{ fontSize: 12.5, color: 'var(--mid)', lineHeight: 1.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {/* Marked when cut, so a capped summary is not mistaken for an
                  agent that stopped mid-sentence. The full text is on the PR. */}
              {summary.length > 1200 ? summary.slice(0, 1200).trimEnd() + '…' : summary}
            </div>
          )}
        </div>
      )}

      {prUrl && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer"
           style={{ display: 'block', padding: '8px 11px', borderTop: '1px solid var(--bd-xl)', fontSize: 12.5,
                    color: 'var(--ink)', textDecoration: 'none', background: 'var(--surface-2)' }}>
          {revising
            ? `Back to pull request${prNumber ? ` #${prNumber}` : ''} →`
            : 'Review the draft pull request →'}
        </a>
      )}
    </div>
  )
}

function ResearchPanel({ research }) {
  const [open, setOpen] = useState({})
  if (!research?.length) return null
  const done = research.filter(r => r.status !== 'running').length
  return (
    <div style={{ margin: '4px 0 12px', padding: '11px 13px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <span style={{ ...eyebrow }}>
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
                <span style={{ flexShrink: 0, marginTop: 1, width: 13, textAlign: 'center', color: failed ? 'var(--accent)' : running ? 'var(--accent)' : 'var(--sage)' }}>
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
                        <div key={k} style={{ fontSize: 11.5, lineHeight: 1.5, color: a.status === 'error' ? 'var(--accent)' : 'var(--muted)', wordBreak: 'break-word' }}>
                          <span style={{ color: 'var(--faint)' }}>{toolLabel(a.tool)}</span>
                          {a.detail ? ` · ${a.detail}` : ''}
                        </div>
                      ))
                    : failed
                      ? <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>{body}</div>
                      : <div className="md-prose" style={{ fontSize: 12.5, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />}
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

export default function AssistantChat({ orbSize = 200, ring1 = 300, ring2 = 240, showNewChat = true, panel = false }) {
  // Thread state lives in AssistantContext so it survives navigating away and back.
  const { messages, busy, error, send, stop, clear, answer, registerVoiceTarget, queued, unqueue } = useAssistant()
  const { bindings } = useKeybinds() || {}
  // The mobile shell renders the assistant with no padding (it was built for the
  // centred orb), so the chat supplies its own gutters and safe-area inset there.
  const isMobile = useIsMobile()
  // `contained`: the chat scrolls itself and supplies its own gutters — on a
  // phone, and in the desktop side panel. Elsewhere the page scrolls it.
  const contained = isMobile || panel
  const gutter = isMobile ? 16 : panel ? 14 : 0
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)
  const taRef = useRef(null)

  const empty = messages.length === 0
  // The newest change Atlas made in this thread: undoing anything older asks first.
  const latestUndo = [...messages].reverse().flatMap(m => [...(m.tools || [])].reverse()).find(t => t?.undoId)?.undoId

  // Only stick to the bottom if you were already there. Research turns update
  // many times a second, and yanking the view down while you are reading
  // something further up is worse than losing the follow.
  useEffect(() => {
    const page = contained ? scrollRef.current : scrollRef.current?.parentElement
    if (!page) return
    const nearBottom = page.scrollHeight - page.scrollTop - page.clientHeight < 120
    if (nearBottom) page.scrollTo({ top: page.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, contained])

  const submit = (text, opts) => {
    unlockAudio()
    send(text, opts)
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const autosize = () => {
    const el = taRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px' }
  }

  // Voice: words stream into the box as a live preview while you speak, then
  // the accurate transcript replaces the preview when you stop. With auto-send
  // on (the default) it goes straight off; otherwise it's left in the box so a
  // misheard word can be fixed first. Conversation mode, barge-in and the rest
  // live in useVoiceConversation, shared with the corner mic.
  const { voice, live, conversing, listening, begin: beginVoice, end: endVoice, toggle: toggleVoice, joinText } = useVoiceConversation({
    draft: input,
    onSend: text => submit(text, { spoken: true }),
    onDraft: text => {
      setInput(text)
      requestAnimationFrame(() => { autosize(); const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
    },
  })
  useEffect(() => { requestAnimationFrame(autosize) }, [live]) // eslint-disable-line

  const canVoice = voiceSupported()
  // The voice shortcut: start, or end — in conversation mode it ends the
  // conversation; otherwise it stops and transcribes. Cuts a spoken reply off.
  const voiceRef = useRef(null)
  voiceRef.current = toggleVoice
  useEffect(() => {
    if (!canVoice) return
    return registerVoiceTarget(() => voiceRef.current())
  }, [canVoice, registerVoiceTarget])
  const speaking = useSpeaking()
  const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input) }
  }

  const composer = (
    // Clicking anywhere in the box (its padding included) goes to the text field.
    <div onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); taRef.current?.focus() } }}
      style={{ cursor: 'text', display: 'flex', alignItems: 'flex-end', gap: 12, width: '100%', maxWidth: 560, padding: '12px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd-lg)', boxShadow: '0 4px 18px var(--bd-xs)' }}>
      {voice.state !== 'idle' && (
        <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 36, flex: 'none', fontSize: 13, color: 'var(--mid)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: listening ? 'var(--accent)' : 'var(--faint)', animation: 'atlas-pulse 1.2s ease-in-out infinite', flex: 'none' }} />
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>{listening ? clock(voice.seconds) : 'Finishing…'}</span>
          <style>{'@keyframes atlas-pulse{0%,100%{opacity:.25}50%{opacity:1}}'}</style>
        </div>
      )}
      <textarea
        ref={taRef}
        rows={1}
        // While listening, the box shows what you've typed plus the live preview.
        value={voice.state === 'idle' ? input : joinText(input, live)}
        readOnly={voice.state !== 'idle'}
        onChange={e => { setInput(e.target.value); autosize(); if (voice.error) voice.clearError() }}
        onKeyDown={onKeyDown}
        placeholder={listening ? 'Listening…' : voice.state === 'transcribing' ? 'Transcribing…' : 'Message Atlas…'}
        style={{ flex: 1, alignSelf: 'center', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontSize: 14, fontFamily: 'inherit', color: voice.state === 'idle' ? 'var(--ink)' : 'var(--mid)', lineHeight: 1.5, maxHeight: 140 }}
      />
      {listening && (
        <button onClick={endVoice} aria-label="Cancel recording" title="Cancel (Esc)"
          style={{ alignSelf: 'center', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', padding: 4, flex: 'none' }}>Cancel</button>
      )}
      {canVoice && (
        <button onClick={() => {
            // While Atlas is talking, the tap only cuts the reply off.
            if (speech.speaking && !listening) { speech.cancel(); return }
            if (listening) voice.stop(); else beginVoice()
          }} disabled={voice.state === 'transcribing'}
          aria-label={listening ? 'Stop and transcribe' : speaking ? 'Stop speaking' : 'Speak'}
          title={(listening ? 'Stop and transcribe' : speaking ? 'Stop speaking' : 'Speak') + (bindings?.voice ? ` (${displayCombo(bindings.voice)})` : '')}
          style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, border: listening ? 'none' : '1px solid var(--bd)', background: listening ? 'var(--accent)' : 'transparent', color: listening ? '#fff' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: voice.state === 'transcribing' ? 'default' : 'pointer', transition: 'all .12s' }}>
          {listening
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
            : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>}
        </button>
      )}
      {!listening && <button
        // While Atlas is answering: with something typed it queues it, otherwise it stops the answer.
        onClick={() => (input.trim() ? submit(input) : busy ? stop() : null)}
        disabled={!busy && !input.trim()}
        aria-label={input.trim() ? (busy ? 'Queue message' : 'Send') : busy ? 'Stop' : 'Send'}
        title={input.trim() && busy ? 'Send when Atlas finishes' : undefined}
        style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, border: 'none', background: busy || input.trim() ? 'var(--accent)' : 'var(--surface-3)', color: busy || input.trim() ? '#fff' : 'var(--faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: busy || input.trim() ? 'pointer' : 'default', transition: 'all .12s' }}
      >
        {busy && !input.trim()
          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
          : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l16 8-16 8 3-8z" /></svg>}
      </button>}
    </div>
  )
  // While in conversation mode, a strip above the box says so (it's on even
  // while Atlas is answering and the mic is off) and offers a way out.
  const voiceBanner = (conversing || speaking) && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 560, marginBottom: 6, fontSize: 12.5, color: 'var(--mid)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flex: 'none' }} />
      <span style={{ flex: 1 }}>
        {[conversing ? 'Voice mode' : null, speaking ? 'Atlas is speaking' : null, listening ? 'listening' : voice.state === 'transcribing' ? 'transcribing' : null, busy && !speaking ? 'Atlas is answering' : null,
          queued.length ? `${queued.length} queued` : null].filter(Boolean).join(' · ')}
      </span>
      {speaking && conversing && <button onClick={() => speech.cancel()} style={{ fontSize: 12, padding: '2px 9px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', fontFamily: 'inherit', cursor: 'pointer' }}>Skip</button>}
      <button onClick={conversing ? endVoice : () => speech.cancel()} style={{ fontSize: 12, padding: '2px 9px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', fontFamily: 'inherit', cursor: 'pointer' }}>{conversing ? 'End' : 'Stop'}</button>
    </div>
  )
  const voiceError = voice.error && (
    <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--accent)' }}>{voice.error}</div>
  )

  if (empty) {
    return (
      <div style={{ position: 'relative', flex: 1, minHeight: 0, height: '100%', width: '100%', maxWidth: COLUMN, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: `24px ${Math.max(gutter, orbSize < 160 ? 20 : 0)}px`, paddingBottom: isMobile ? 'max(24px, env(safe-area-inset-bottom))' : 24 }}>
        <SettingsButton style={{ position: 'absolute', top: 6, right: gutter }} />
        {!panel && <AtlasOrb orbSize={orbSize} ring1={ring1} ring2={ring2} />}

        <h1 style={{ margin: '14px 0 6px', fontFamily: 'var(--font-serif)', fontSize: panel ? 24 : 30, fontWeight: 500, color: 'var(--ink)' }}>
          How can I help you plan today?
        </h1>
        <p style={{ margin: '0 0 26px', fontSize: panel ? 13.5 : 14.5, color: 'var(--mid)', maxWidth: 440, lineHeight: 1.55 }}>
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

        {voiceBanner}
        {composer}
        {voiceError}
        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--accent)' }}>{error}</div>}
      </div>
    )
  }

  return (
    // The desktop and tablet shells provide the page-level scroll container;
    // mobile keeps it here because its shell deliberately hides page overflow.
    <div ref={scrollRef} style={{ flex: 1, minWidth: 0, minHeight: '100%', width: '100%', maxWidth: COLUMN, margin: '0 auto', display: 'flex', flexDirection: 'column', overflowY: contained ? 'auto' : 'visible', overflowX: 'hidden', ...(panel && { height: '100%', minHeight: 0 }) }}>
      {/* Threads persist across navigation and reloads, so there has to be a way
          out. Desktop and mobile get it from the header "+ New chat"; the tablet
          deck has no header, so it keeps this one. */}
      <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', gap: 8, padding: `6px ${gutter}px 0` }}>
        <SettingsButton />
        {showNewChat && <button onClick={clear}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--muted)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New chat
        </button>}
      </div>
      {/* Grows to fill the page, so the composer sits at the bottom even when the thread is short. */}
      <div style={{ flex: '1 0 auto', padding: `8px ${gutter}px 20px`, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.map((m, i) => m.role === 'user' ? (
          <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '80%', padding: '10px 15px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd)', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>
            {m.content}
          </div>
        ) : (
          <div key={i} style={{ maxWidth: '100%' }}>
            <ToolTrace tools={m.tools} latestUndo={latestUndo} />
            <ToolCards tools={m.tools} />
            <ResearchPanel research={m.research} />
            <CodingPanel coding={m.coding} />
            <QuestionPanel question={m.question} runId={m.runId} onAnswer={answer} />
            {m.content
              ? <div className="md-prose" style={{ fontSize: 14.5, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
              : m.error ? <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{m.error}</div>
              : busy && i === messages.length - 1 && (m.tools?.length ?? 0) === 0 && !m.research?.length && !m.question && !m.coding &&
                  <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Thinking…</span>}
          </div>
        ))}
        {/* Sent while Atlas was answering: they go in order as each turn ends. */}
        {queued.map(q => (
          <div key={q.id} style={{ alignSelf: 'flex-end', maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ padding: '10px 15px', borderRadius: 14, background: 'var(--surface)', border: '1px dashed var(--bd-xl)', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--mid)' }}>
              {q.text}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--faint)' }}>
              Queued · sends when Atlas finishes
              <button onClick={() => unqueue(q.id)} aria-label="Remove from queue"
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}>Remove</button>
            </div>
          </div>
        ))}
        {error && <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{error}</div>}
      </div>

      <div style={{ position: 'sticky', bottom: 0, zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: `8px ${gutter}px`, paddingBottom: isMobile ? 'max(8px, env(safe-area-inset-bottom))' : 8, background: 'var(--bg)' }}>{voiceBanner}{composer}{voiceError}</div>
    </div>
  )
}
