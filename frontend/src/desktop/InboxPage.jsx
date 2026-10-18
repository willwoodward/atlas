import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useRefresh } from '../context/RefreshContext.jsx'
import { useInbox, inboxFetch, API } from '../context/InboxContext.jsx'
import { reduceMessage, useAssistant } from '../context/AssistantContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { useFocusRequest } from '../lib/focus.js'
import { renderMarkdown } from '../lib/markdown.js'
import { ToolTrace, QuestionPanel } from '../components/AssistantChat.jsx'
import { ToolCards, ActionUndoChip } from '../components/ChatCards.jsx'
import RoutinesSheet from '../components/RoutinesSheet.jsx'
import { Button, IconButton, BinButton, Input, Textarea, Switch, PageHeader, eyebrow } from '../components/ui.jsx'

// The inbox: what Atlas did in the background. Each item is a thread from a
// routine's run (backend/inbox.py): its message, any changes it suggested —
// approve, edit or reject each — and room to reply and carry on.

const VIEWS = [['all', 'All'], ['unread', 'Unread'], ['action', 'Needs action']]

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000)
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (days === 0) return hm
  if (days === 1) return `Yesterday ${hm}`
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ` ${hm}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Follow a run's events as they happen; resolves when it ends. */
async function followRun(token, runId, onEvent, signal) {
  const res = await fetch(`${API}/assistant/runs/${runId}/events?after=0`, { headers: { Authorization: `Bearer ${token}` }, signal })
  if (!res.ok || !res.body) return
  const reader = res.body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop()
    for (const frame of frames) {
      const line = frame.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      let ev
      try { ev = JSON.parse(line.slice(6)) } catch { continue }
      if (ev.type === 'done') return
      onEvent(ev)
    }
  }
}

// ── The list ─────────────────────────────────────────────────────────────────

function Dot({ on, color = 'var(--accent)' }) {
  return <span style={{ display: 'block', width: 8, height: 8, borderRadius: '50%', flex: 'none', background: on ? color : 'transparent' }} />
}

function ItemRow({ item, selected, onClick, onDelete }) {
  const unread = !item.read
  return (
    <div className="inbox-row" style={{ position: 'relative' }}>
    <button onClick={onClick} data-inbox-item={item.id}
      style={{ display: 'flex', gap: 10, width: '100%', textAlign: 'left', padding: '12px 14px', paddingRight: 44, border: 'none', borderRadius: 'var(--radius)',
               background: selected ? 'var(--surface-3)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', alignItems: 'flex-start' }}>
      <span style={{ display: 'block', paddingTop: 6, flex: 'none' }}><Dot on={unread} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: unread ? 650 : 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
          <span style={{ flex: 'none', fontSize: 11.5, color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>{when(item.updated_at)}</span>
        </span>
        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: 3, fontSize: 12.5, lineHeight: 1.45, color: 'var(--muted)' }}>
          {item.status === 'running' ? 'Atlas is working on this…' : item.preview || '—'}
        </span>
        {item.test && <span style={{ display: 'inline-block', marginTop: 6, marginRight: 6, padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: 'var(--surface-3)', color: 'var(--mid)' }}>Test run</span>}
        {(item.pending > 0 || item.status === 'error') && (
          <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                         background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {item.status === 'error' ? 'Didn’t finish' : `${item.pending} to approve`}
          </span>
        )}
      </span>
    </button>
    {item.status !== 'running' && (
      <BinButton size={28} aria-label={`Delete “${item.title}”`} title="Delete" className="inbox-row-bin"
        onClick={onDelete} style={{ position: 'absolute', right: 8, bottom: 10 }} />
    )}
    </div>
  )
}

// ── Suggested changes ────────────────────────────────────────────────────────

const LABELS = { text: 'Text', bucket: 'List', title: 'Title', date: 'Date', start: 'Starts (hour)', end: 'Ends (hour)',
                 description: 'Description', location: 'Location', body: 'Note', category: 'Category', name: 'Name', prompt: 'Instruction' }

function EditArgs({ args, onSave, onCancel, busy }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])))
  const [err, setErr] = useState(null)
  const save = () => {
    try {
      const out = {}
      for (const [k, v] of Object.entries(draft)) {
        const orig = args[k]
        out[k] = typeof orig === 'number' ? Number(v) : typeof orig === 'object' && orig !== null ? JSON.parse(v) : v
      }
      onSave(out)
    } catch { setErr('One of the fields isn’t valid.') }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      {Object.entries(args).filter(([k]) => k !== 'id').map(([k, orig]) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--mid)' }}>
          <span style={{ width: 96, flex: 'none' }}>{LABELS[k] || k.replace(/_/g, ' ')}</span>
          {typeof orig === 'boolean'
            ? <Switch checked={!!draft[k]} onChange={v => setDraft(d => ({ ...d, [k]: v }))} label={k} />
            : String(draft[k]).length > 60 || k === 'body' || k === 'prompt'
              ? <Textarea value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} rows={3} style={{ flex: 1, fontSize: 13 }} />
              : <Input value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} type={typeof orig === 'number' ? 'number' : 'text'} step="any" style={{ flex: 1, fontSize: 13 }} />}
        </label>
      ))}
      {err && <div style={{ fontSize: 12, color: 'var(--accent)' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={busy}>Save and approve</Button>
      </div>
    </div>
  )
}

function Proposal({ p, onDecide }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const act = async (approve, args) => {
    setBusy(true); setErr(null)
    try { await onDecide(p.id, approve, args); setEditing(false) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const pending = p.status === 'pending'
  const editable = Object.keys(p.args || {}).some(k => k !== 'id')
  return (
    <div style={{ padding: '10px 12px', borderRadius: 'var(--radius)', background: pending ? 'var(--surface)' : 'transparent', border: `1px solid ${pending ? 'var(--bd)' : 'var(--bd-sm)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, color: p.status === 'rejected' ? 'var(--faint)' : 'var(--ink)', textDecoration: p.status === 'rejected' ? 'line-through' : 'none' }}>
          {p.summary}
        </span>
        {pending && !editing && (
          <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
            <Button size="sm" variant="ghost" onClick={() => act(false)} disabled={busy}>Reject</Button>
            {editable && <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}>Edit</Button>}
            <Button size="sm" variant="primary" onClick={() => act(true)} disabled={busy}>{busy ? '…' : 'Approve'}</Button>
          </span>
        )}
        {p.status === 'approved' && (
          <span style={{ fontSize: 12, color: 'var(--sage)', flex: 'none', display: 'flex', alignItems: 'center' }}>
            Done{p.undo_id && <ActionUndoChip id={p.undo_id} />}
          </span>
        )}
        {p.status === 'rejected' && <span style={{ fontSize: 12, color: 'var(--faint)', flex: 'none' }}>Rejected</span>}
        {p.status === 'failed' && <span style={{ fontSize: 12, color: 'var(--accent)', flex: 'none' }}>Couldn’t do it</span>}
      </div>
      {editing && <EditArgs args={p.args} busy={busy} onCancel={() => setEditing(false)} onSave={args => act(true, args)} />}
      {err && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--accent)' }}>{err}</div>}
    </div>
  )
}

function Proposals({ list, onDecide, onApproveAll }) {
  if (!list.length) return null
  const pending = list.filter(p => p.status === 'pending').length
  return (
    <div style={{ margin: '4px 0 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ ...eyebrow, flex: 1 }}>Suggested changes{pending ? ` · ${pending} waiting` : ''}</div>
        {pending > 1 && <Button size="sm" variant="link" onClick={onApproveAll}>Approve all</Button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.map(p => <Proposal key={p.id} p={p} onDecide={onDecide} />)}
      </div>
    </div>
  )
}

// ── One item ─────────────────────────────────────────────────────────────────

function Detail({ id, onBack, onChanged, isMobile, onRunAgain, onDelete }) {
  const { token } = useAuth()
  const { refresh } = useRefresh()
  const [item, setItem] = useState(null)
  const [detail, setDetail] = useState({})   // runId → { tools, research }
  const [live, setLive] = useState(null)     // the turn being written now
  const { answer } = useAssistant()
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const following = useRef(null)

  const load = useCallback(async () => {
    try {
      const it = await inboxFetch(token, `/${id}`)
      setItem(it)
      setErr(null)
      return it
    } catch (e) { setErr(e.message) }
  }, [id, token])

  // Open: load, and mark read.
  useEffect(() => {
    setItem(null); setDetail({}); setLive(null); setReply(''); setShowPrompt(false)
    load().then(it => {
      if (it && !it.read) inboxFetch(token, `/${id}`, { method: 'PATCH', body: { read: true } }).then(() => onChanged()).catch(() => {})
    })
  }, [id]) // eslint-disable-line

  // Tool detail for finished turns (cards, the trace, undo chips).
  const runIds = (item?.messages || []).filter(m => m.role === 'assistant' && m.status !== 'running').map(m => m.runId).join(',')
  useEffect(() => {
    if (!runIds) return
    runIds.split(',').filter(r => !detail[r]).forEach(async runId => {
      try {
        const res = await fetch(`${API}/assistant/runs/${runId}/history`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const { events } = await res.json()
        const m = events.filter(e => e.type !== 'token' && e.type !== 'error').reduce(reduceMessage, { tools: [] })
        setDetail(d => ({ ...d, [runId]: m }))
      } catch { /* the text is still there */ }
    })
  }, [runIds]) // eslint-disable-line

  // A turn still running: watch it, then reload.
  const activeRun = item?.active_run?.id
  useEffect(() => {
    if (!activeRun || following.current === activeRun) return
    following.current = activeRun
    const ctrl = new AbortController()
    setLive({ runId: activeRun, content: '', tools: [] })
    let wrote = false
    followRun(token, activeRun, ev => {
      if (ev.type === 'tool_result' && ev.status !== 'error') wrote = true
      setLive(m => (m ? reduceMessage(m, ev) : m))
    }, ctrl.signal)
      .catch(() => {})
      .finally(async () => {
        following.current = null
        if (ctrl.signal.aborted) return
        const it = await load()
        setLive(null)
        // Finished while you were looking at it: it's been read.
        if (it && !it.read) await inboxFetch(token, `/${id}`, { method: 'PATCH', body: { read: true } }).catch(() => {})
        onChanged()
        if (wrote) refresh()
      })
    return () => ctrl.abort()
  }, [activeRun]) // eslint-disable-line

  const decide = async (pid, approve, args) => {
    await inboxFetch(token, `/proposals/${pid}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: approve && args ? { args } : {} })
    await load(); onChanged()
    if (approve) refresh()
  }
  const approveAll = async () => {
    try { await inboxFetch(token, `/${id}/approve-all`, { method: 'POST', body: {} }) } catch (e) { setErr(e.message) }
    await load(); onChanged(); refresh()
  }
  const send = () => sendText(reply)
  const sendText = async raw => {
    const text = (raw || '').trim()
    if (!text) return
    setSending(true); setErr(null)
    try {
      await inboxFetch(token, `/${id}/reply`, { method: 'POST', body: { message: text } })
      setReply('')
      await load()
    } catch (e) { setErr(e.message) } finally { setSending(false) }
  }
  const flag = async patch => {
    await inboxFetch(token, `/${id}`, { method: 'PATCH', body: patch })
    onChanged()
    if (patch.archived) onBack(); else load()
  }

  if (!item) return <div style={{ padding: 24, fontSize: 13, color: 'var(--muted)' }}>{err || 'Loading…'}</div>

  const [first, ...rest] = item.messages
  const byRun = run => item.proposals.filter(p => p.run_id === run)
  const loose = item.proposals.filter(p => !item.messages.some(m => m.runId === p.run_id))
  const busy = !!item.active_run

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 8, padding: isMobile ? '14px 16px 10px' : '4px 4px 14px', borderBottom: '1px solid var(--bd-sm)' }}>
        {isMobile && (
          <IconButton aria-label="Back to inbox" onClick={onBack} style={{ marginLeft: -6 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </IconButton>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...eyebrow }}>{[item.test ? 'Test run — nothing changes unless you approve it' : item.routine_name ? 'Routine' : null, when(item.created_at)].filter(Boolean).join(' · ')}</div>
          <h2 style={{ margin: '4px 0 0', fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: isMobile ? 22 : 26, color: 'var(--ink)' }}>{item.title}</h2>
        </div>
        {/* On a phone the actions go on their own row under the title. */}
        <div style={{ display: 'flex', gap: 6, flex: 'none', paddingTop: 2, ...(isMobile && { width: '100%', paddingLeft: 38 }) }}>
          {item.routine_id && <Button size="sm" variant="ghost" onClick={() => onRunAgain(item.routine_id)} disabled={busy}>Run again</Button>}
          <Button size="sm" variant="ghost" onClick={() => flag({ read: false })}>Mark unread</Button>
          <Button size="sm" variant="ghost" onClick={() => flag({ archived: !item.archived })}>{item.archived ? 'Unarchive' : 'Archive'}</Button>
          <BinButton size={30} aria-label="Delete this thread" title="Delete this thread" disabled={busy} onClick={() => onDelete(item)} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '14px 16px' : '18px 4px' }}>
        {first && (
          <button onClick={() => setShowPrompt(s => !s)}
            style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 16, padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px dashed var(--bd-xl)', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--muted)' }}>
            <span style={{ fontWeight: 600 }}>{item.routine_id ? 'Instruction' : 'You asked'}: </span>
            <span style={showPrompt ? { whiteSpace: 'pre-wrap' } : { display: 'inline' }}>{showPrompt || first.content.length < 90 ? first.content : first.content.slice(0, 90) + '…'}</span>
          </button>
        )}
        {rest.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', margin: '6px 0 16px' }}>
                <div style={{ maxWidth: '80%', padding: '9px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd)', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{m.content}</div>
              </div>
            )
          }
          const isLive = live && live.runId === m.runId
          const d = isLive ? live : detail[m.runId] || {}
          const content = isLive ? live.content : m.content
          return (
            <div key={i} style={{ marginBottom: 16 }}>
              <ToolTrace tools={d.tools || []} />
              <ToolCards tools={d.tools || []} onChoose={busy ? null : sendText} />
              {/* Replying here is like a chat: Atlas can stop to ask, or to get an OK for an "ask first" tool. */}
              <QuestionPanel question={d.question} runId={m.runId} onAnswer={answer} />
              {content
                ? <div className="md-prose" style={{ fontSize: 14.5, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
                : m.error ? <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{m.error}</div>
                : isLive || m.status === 'running' ? <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>Working on it…</div> : null}
              <div style={{ marginTop: 12 }}><Proposals list={byRun(m.runId)} onDecide={decide} onApproveAll={approveAll} /></div>
            </div>
          )
        })}
        <Proposals list={loose} onDecide={decide} onApproveAll={approveAll} />
        {err && <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{err}</div>}
      </div>

      {/* Room on the right for the corner mic, which sits over this corner. */}
      <div style={{ flex: 'none', display: 'flex', gap: 8, alignItems: 'flex-end', padding: isMobile ? '10px 72px max(10px, env(safe-area-inset-bottom)) 16px' : '12px 64px 4px 4px', borderTop: '1px solid var(--bd-sm)' }}>
        <Textarea value={reply} onChange={e => setReply(e.target.value)} rows={1} placeholder={busy ? 'Atlas is working…' : 'Reply to carry on…'}
          aria-label="Reply" disabled={busy}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          style={{ flex: 1, resize: 'none', fontSize: 14, maxHeight: 140, minHeight: 38 }} />
        <Button variant="primary" onClick={send} disabled={!reply.trim() || sending || busy} style={{ height: 38 }}>Send</Button>
      </div>
    </div>
  )
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { token } = useAuth()
  const { counts, setCounts, reload: reloadCounts } = useInbox()
  const isMobile = useIsMobile()
  const [view, setView] = useState('all')
  const [items, setItems] = useState(null)
  const [selected, setSelected] = useState(null)
  const [routinesOpen, setRoutinesOpen] = useState(false)
  const [routineCount, setRoutineCount] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(async (v = view) => {
    try {
      const out = await inboxFetch(token, `?view=${v}`)
      setItems(out.items)
      setCounts(out.counts)
      setErr(null)
    } catch (e) { setErr(e.message) }
  }, [token, view, setCounts])
  useEffect(() => { load(view) }, [view]) // eslint-disable-line
  // Keep "working on it" items moving.
  useEffect(() => {
    if (!items?.some(i => i.status === 'running')) return
    const t = setInterval(() => load(), 4000)
    return () => clearInterval(t)
  }, [items, load])
  useEffect(() => {
    inboxFetch(token, '/routines').then(r => setRoutineCount(r.routines.length)).catch(() => {})
  }, [token, routinesOpen])
  // Desktop opens the newest item; a phone shows the list first.
  useEffect(() => {
    if (!isMobile && !selected && items?.length) setSelected(items[0].id)
  }, [items, isMobile]) // eslint-disable-line

  const [openRoutine, setOpenRoutine] = useState(null)
  useFocusRequest(['inbox', 'routine'], t => {
    if (t.kind === 'routine') { setOpenRoutine(t.id); setRoutinesOpen(true); return }
    setView('all'); setSelected(t.id); load('all')
  })

  const changed = () => { load(); reloadCounts() }
  // Delete a thread for good (approved changes stay).
  const remove = async it => {
    if (!window.confirm(`Delete “${it.title}”? This removes the thread and any suggestions still waiting. It can't be undone.`)) return
    try {
      await inboxFetch(token, `/${it.id}`, { method: 'DELETE' })
      if (selected === it.id) setSelected(null)
      changed()
    } catch (e) { setErr(e.message) }
  }
  const runAgain = async routineId => {
    try {
      const out = await inboxFetch(token, `/routines/${routineId}/run`, { method: 'POST', body: {} })
      await load()
      setSelected(out.id)
    } catch (e) { setErr(e.message) }
  }

  const list = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--bd)', marginBottom: 10, flex: 'none' }} role="tablist">
        {VIEWS.map(([v, label]) => {
          const n = v === 'unread' ? counts.unread : v === 'action' ? counts.action : 0
          return (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
                       fontWeight: view === v ? 600 : 500, background: view === v ? 'var(--surface)' : 'transparent', color: view === v ? 'var(--ink)' : 'var(--mid)',
                       boxShadow: view === v ? '0 1px 3px var(--bd)' : 'none' }}>
              {label}{n ? <span style={{ marginLeft: 5, color: 'var(--accent)' }}>{n}</span> : null}
            </button>
          )
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items === null && !err && <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
        {err && <div style={{ padding: 14, fontSize: 13, color: 'var(--accent)' }}>{err}</div>}
        {items?.length === 0 && (
          <div style={{ padding: '28px 14px', textAlign: 'center', fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
            {view === 'all'
              ? routineCount ? 'Nothing yet. Your routines will leave their results here.' : 'Nothing here yet. Set up a routine and Atlas will work on it in the background, leaving the result here.'
              : view === 'unread' ? 'All read.' : 'Nothing waiting for you.'}
            {view === 'all' && !routineCount && <div style={{ marginTop: 12 }}><Button variant="primary" size="sm" onClick={() => setRoutinesOpen(true)}>Set up a routine</Button></div>}
          </div>
        )}
        {items?.map(it => <ItemRow key={it.id} item={it} selected={!isMobile && it.id === selected} onClick={() => setSelected(it.id)} onDelete={() => remove(it)} />)}
      </div>
    </div>
  )

  const routinesButton = (
    <Button variant="ghost" size="sm" onClick={() => setRoutinesOpen(true)}>
      Routines{routineCount ? ` · ${routineCount}` : ''}
    </Button>
  )

  if (isMobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {selected
          ? <Detail id={selected} isMobile onBack={() => setSelected(null)} onChanged={changed} onRunAgain={runAgain} onDelete={remove} />
          : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 16px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>{routinesButton}</div>
              {list}
            </div>
          )}
        {routinesOpen && <RoutinesSheet openId={openRoutine} onClose={() => { setRoutinesOpen(false); setOpenRoutine(null) }} onRan={id => { setSelected(id); load() }} />}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Inbox" subtitle="What Atlas did while you were away.">{routinesButton}</PageHeader>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 28 }}>
        {list}
        <div style={{ minWidth: 0, minHeight: 0, borderLeft: '1px solid var(--bd-sm)', paddingLeft: 24 }}>
          {selected
            ? <Detail key={selected} id={selected} onBack={() => setSelected(null)} onChanged={changed} onRunAgain={runAgain} onDelete={remove} />
            : <div style={{ padding: 24, fontSize: 13, color: 'var(--faint)' }}>—</div>}
        </div>
      </div>
      {routinesOpen && <RoutinesSheet openId={openRoutine} onClose={() => { setRoutinesOpen(false); setOpenRoutine(null) }} onRan={id => { setSelected(id); load() }} />}
    </div>
  )
}
