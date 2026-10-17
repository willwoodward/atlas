import { useEffect, useState } from 'react'
import Sheet from './Sheet.jsx'
import { useAssistant } from '../context/AssistantContext.jsx'
import { IconButton, BinButton, Input } from './ui.jsx'

// Chats are temporary: one is deleted once it's over (30 minutes idle, or
// "New chat") unless you keep it. Kept chats are listed here, to search,
// rename, reopen and carry on, or delete. See backend/conversations.py.

const BookmarkIcon = ({ filled }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
)
const ClockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)

const chip = active => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--bd)',
  background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--muted)',
  fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
})

/** Keep the current chat. Shown once there is one. */
export function KeepButton({ style }) {
  const { sessionId, kept, keep, messages } = useAssistant()
  if (!sessionId || !messages.length) return null
  return (
    <button onClick={() => keep(!kept)} aria-pressed={kept} style={{ ...chip(kept), ...style }}
      title={kept ? 'Kept: it stays in past chats until you delete it. Click to stop keeping it.' : 'Chats are deleted 30 minutes after they end. Keep this one?'}>
      <BookmarkIcon filled={kept} />{kept ? 'Kept' : 'Keep'}
    </button>
  )
}

function when(iso) {
  const d = new Date(iso)
  const days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000)
  if (days === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

function Row({ s, current, onOpen, onRenamed, onDeleted }) {
  const { assistantApi } = useAssistant()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(s.title)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setEditing(false)
    if (!title.trim() || title === s.title) { setTitle(s.title); return }
    try { await assistantApi(`/sessions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ title }) }); onRenamed() } catch { setTitle(s.title) }
  }
  const remove = async () => {
    if (!window.confirm(`Delete “${s.title || 'this chat'}”? This can't be undone.`)) return
    setBusy(true)
    try { await assistantApi(`/sessions/${s.id}`, { method: 'DELETE' }); onDeleted() } catch (e) { window.alert(e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 4px', borderBottom: '1px solid var(--bd-sm)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing
          ? <Input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setTitle(s.title); setEditing(false) } }}
              aria-label="Chat name" style={{ width: '100%', fontSize: 14 }} maxLength={120} />
          : (
            <button onClick={() => onOpen(s)} disabled={current}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', cursor: current ? 'default' : 'pointer' }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Untitled chat'}</span>
                <span style={{ flex: 'none', fontSize: 11.5, color: 'var(--faint)' }}>{current ? 'Open now' : when(s.updated_at)}</span>
              </span>
              <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: 3, fontSize: 12.5, lineHeight: 1.45, color: 'var(--muted)' }}>
                {s.preview || '—'}
              </span>
            </button>
          )}
      </div>
      <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
        <IconButton size={28} aria-label="Rename" title="Rename" onClick={() => setEditing(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
        </IconButton>
        <BinButton size={28} aria-label={`Delete “${title || 'this chat'}”`} onClick={remove} disabled={busy || current} />
      </div>
    </div>
  )
}

function PastChatsSheet({ onClose }) {
  const { assistantApi, resume, sessionId, kept, messages } = useAssistant()
  const [q, setQ] = useState('')
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const load = (query = q) => assistantApi(`/sessions?q=${encodeURIComponent(query)}`).then(r => { setList(r.sessions); setErr(null) }).catch(e => setErr(e.message))
  useEffect(() => { const t = setTimeout(() => load(q), q ? 250 : 0); return () => clearTimeout(t) }, [q]) // eslint-disable-line
  const open = async s => {
    if (sessionId && !kept && messages.length && !window.confirm("Your current chat isn't kept, so it will be deleted. Open this one anyway?")) return
    try { await resume(s.id); onClose() } catch (e) { setErr(e.message) }
  }
  return (
    <Sheet title="Past chats" onClose={onClose} width={560} height="76vh" ariaLabel="Past chats">
      <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--mid)', lineHeight: 1.5 }}>
          Chats are deleted 30 minutes after they end, unless you keep them. These are the ones you kept: open one to carry on where you left off.
        </p>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search kept chats…" aria-label="Search kept chats" style={{ width: '100%', marginBottom: 6 }} />
        {err && <div style={{ fontSize: 12.5, color: 'var(--accent)', margin: '6px 0' }}>{err}</div>}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {list === null && !err && <div style={{ padding: 12, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
          {list?.length === 0 && (
            <div style={{ padding: '28px 8px', textAlign: 'center', fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
              {q ? 'No kept chats match that.' : 'No kept chats yet. Press “Keep” in a chat to save it here.'}
            </div>
          )}
          {list?.map(s => <Row key={s.id} s={s} current={s.id === sessionId} onOpen={open} onRenamed={() => load()} onDeleted={() => load()} />)}
        </div>
      </div>
    </Sheet>
  )
}

export function PastChatsButton({ style }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} style={{ ...chip(false), ...style }} title="Chats you kept">
        <ClockIcon />Past chats
      </button>
      {open && <PastChatsSheet onClose={() => setOpen(false)} />}
    </>
  )
}

export const KeepNote = () => (
  <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--faint)' }}>Chats are deleted 30 minutes after they end, unless you keep them.</p>
)

