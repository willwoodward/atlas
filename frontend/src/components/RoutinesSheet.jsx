import { useEffect, useState } from 'react'
import Sheet from './Sheet.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { inboxFetch } from '../context/InboxContext.jsx'
import { pushSupported, needsInstall, pushStatus, enablePush, disablePush, testPush } from '../lib/push.js'
import { Button, Input, Textarea, Switch, eyebrow } from './ui.jsx'

// Routines: Atlas working on a schedule, leaving the result in the inbox.
// Listed here with pause / run now / edit, plus notifications for this device.

const DAYS = [['mon', 'M'], ['tue', 'T'], ['wed', 'W'], ['thu', 'T'], ['fri', 'F'], ['sat', 'S'], ['sun', 'S']]
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

// Starting points. Instructions only — what Atlas looks at is your own data.
const STARTERS = [
  { name: 'Morning plan', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30',
    prompt: 'Look at today: my calendar, to-dos for today and this week, and habits. Give me a short plan for the day — what matters most, where the free time is, and anything I should prepare. Suggest moving or adding to-dos where it would help.' },
  { name: 'Weekly money check', days: ['sun'], time: '18:00',
    prompt: 'Review my spending for the last 7 days against the week before and my budgets. Point out anything unusual or over budget, and tidy up uncategorised transactions.' },
  { name: 'Week ahead', days: ['sun'], time: '19:00',
    prompt: 'Look at next week: calendar, to-dos and this week’s outcomes. Tell me what the week looks like, flag clashes or overloaded days, and suggest outcomes for the week if I haven’t set them.' },
]

const EMPTY = { name: '', prompt: '', days: DAYS.map(d => d[0]), time: '08:00', approval: 'ask', notify: true, enabled: true }

function nextLabel(iso) {
  if (!iso) return 'Paused'
  const d = new Date(iso)
  const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000)
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `Next: ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long' })} ${hm}`
}

function Notifications() {
  const { token } = useAuth()
  const [state, setState] = useState(null)   // on | off | blocked | unsupported
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { pushStatus(token).then(setState) }, [token])
  const change = async on => {
    setBusy(true); setMsg(null)
    try { on ? await enablePush(token) : await disablePush(token); setState(on ? 'on' : 'off') } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  const test = async () => {
    try { const { sent } = await testPush(token); setMsg(sent ? 'Sent — it should appear in a moment.' : 'No device took it.') } catch (e) { setMsg(e.message) }
  }
  const detail = state === 'unsupported' ? (needsInstall() ? 'On iPhone, add Atlas to your Home Screen first (Share → Add to Home Screen), then turn this on there.' : 'This browser can’t show notifications.')
    : state === 'blocked' ? 'Notifications are blocked for Atlas. Allow them in your browser or phone settings.'
    : 'Get a notification on this device when a routine finishes.'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--bd)', marginBottom: 18 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Notifications on this device</div>
        <div style={{ fontSize: 12, color: msg ? 'var(--accent)' : 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>{msg || detail}</div>
      </div>
      {state === 'on' && <Button size="sm" variant="ghost" onClick={test}>Test</Button>}
      <Switch checked={state === 'on'} onChange={change} label="Notifications on this device"
        disabled={busy || state === null || state === 'unsupported' || state === 'blocked' || !pushSupported()} />
    </div>
  )
}

function Editor({ initial, onSave, onCancel, onDelete }) {
  const [f, setF] = useState(initial)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = patch => setF(x => ({ ...x, ...patch }))
  const toggleDay = d => set({ days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d] })
  const save = async () => {
    setBusy(true); setErr(null)
    try { await onSave(f) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const label = { fontSize: 12.5, fontWeight: 600, color: 'var(--mid)', marginBottom: 6, display: 'block' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!initial.id && (
        <div>
          <span style={label}>Start from</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STARTERS.map(s => <Button key={s.name} size="sm" variant="ghost" onClick={() => set(s)}>{s.name}</Button>)}
          </div>
        </div>
      )}
      <label><span style={label}>Name</span>
        <Input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Morning plan" style={{ width: '100%' }} maxLength={80} />
      </label>
      <label><span style={label}>What Atlas should do</span>
        <Textarea value={f.prompt} onChange={e => set({ prompt: e.target.value })} rows={5} style={{ width: '100%', fontSize: 13.5 }}
          placeholder="Written as an instruction. Atlas starts fresh each time, so include everything it needs." />
      </label>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <span style={label}>Days</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {DAYS.map(([d, l]) => {
              const on = f.days.includes(d)
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)} aria-pressed={on} aria-label={DAY_NAMES[d]} title={DAY_NAMES[d]}
                  style={{ width: 32, height: 32, borderRadius: '50%', border: on ? 'none' : '1px solid var(--bd)', background: on ? 'var(--accent)' : 'transparent',
                           color: on ? '#fff' : 'var(--mid)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{l}</button>
              )
            })}
          </div>
        </div>
        <label><span style={label}>Time</span>
          <Input type="time" value={f.time} onChange={e => set({ time: e.target.value })} style={{ width: 120 }} />
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}>Ask before changing anything</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Changes wait in the inbox for you to approve, edit or reject. Off: Atlas makes them itself (you can still undo).</div>
          </div>
          <Switch checked={f.approval === 'ask'} onChange={v => set({ approval: v ? 'ask' : 'auto' })} label="Ask before changing anything" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}>Notify me when it’s done</div>
          <Switch checked={f.notify} onChange={v => set({ notify: v })} label="Notify me when it’s done" />
        </div>
      </div>
      {err && <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {onDelete && <Button variant="danger" size="sm" onClick={onDelete}>Delete</Button>}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy || !f.name.trim() || !f.prompt.trim() || !f.days.length}>{initial.id ? 'Save' : 'Create routine'}</Button>
      </div>
    </div>
  )
}

export default function RoutinesSheet({ onClose, onRan }) {
  const { token } = useAuth()
  const [routines, setRoutines] = useState(null)
  const [editing, setEditing] = useState(null)   // a routine, or EMPTY for a new one
  const [err, setErr] = useState(null)

  const load = () => inboxFetch(token, '/routines').then(r => { setRoutines(r.routines); setErr(null) }).catch(e => setErr(e.message))
  useEffect(() => { load() }, []) // eslint-disable-line

  const save = async f => {
    const body = { name: f.name, prompt: f.prompt, days: f.days, time: f.time, approval: f.approval, notify: f.notify }
    if (f.id) await inboxFetch(token, `/routines/${f.id}`, { method: 'PUT', body })
    else await inboxFetch(token, '/routines', { method: 'POST', body })
    setEditing(null); load()
  }
  const remove = async r => {
    if (!window.confirm(`Delete “${r.name}”? Its past results stay in the inbox.`)) return
    await inboxFetch(token, `/routines/${r.id}`, { method: 'DELETE' }); setEditing(null); load()
  }
  const toggle = async (r, enabled) => {
    setRoutines(list => list.map(x => (x.id === r.id ? { ...x, enabled } : x)))
    try { await inboxFetch(token, `/routines/${r.id}`, { method: 'PUT', body: { enabled } }); load() } catch (e) { setErr(e.message); load() }
  }
  const runNow = async r => {
    try {
      const out = await inboxFetch(token, `/routines/${r.id}/run`, { method: 'POST', body: {} })
      onRan?.(out.id); onClose()
    } catch (e) { setErr(e.message) }
  }

  return (
    <Sheet title={editing ? (editing.id ? 'Edit routine' : 'New routine') : 'Routines'} onClose={onClose} width={560} ariaLabel="Routines">
      {editing
        ? <Editor initial={editing} onSave={save} onCancel={() => setEditing(null)} onDelete={editing.id ? () => remove(editing) : null} />
        : (
          <div style={{ textAlign: 'left' }}>
            <Notifications />
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--mid)', lineHeight: 1.5 }}>
              Atlas runs these on schedule, in the background, and leaves the result in your inbox. You can also ask Atlas in chat to set one up.
            </p>
            {routines === null && !err && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
            {err && <div style={{ fontSize: 12.5, color: 'var(--accent)', marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {routines?.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--bd)', background: 'var(--surface)', opacity: r.enabled ? 1 : 0.65 }}>
                  <button onClick={() => setEditing({ ...r })} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {r.schedule} · {r.approval === 'ask' ? 'asks first' : 'acts itself'} · {r.enabled ? nextLabel(r.next_run_at) : 'Paused'}
                    </div>
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => runNow(r)}>Run now</Button>
                  <Switch checked={r.enabled} onChange={v => toggle(r, v)} label={`${r.name} on`} />
                </div>
              ))}
              {routines?.length === 0 && <div style={{ ...eyebrow, padding: '6px 0' }}>No routines yet</div>}
            </div>
            <div style={{ marginTop: 16 }}>
              <Button variant="primary" onClick={() => setEditing({ ...EMPTY })}>New routine</Button>
            </div>
          </div>
        )}
    </Sheet>
  )
}
