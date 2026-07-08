import { useEffect, useState, useRef } from 'react'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useLocalCalendar } from '../context/LocalCalendarContext.jsx'
import { getWeekRange, localDateStr } from '../integrations/googleCalendar.js'

const HOUR_H = 48
const DAY_START = 0
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const PALETTE = ['#5f7591','#6f8168','#c15f3c','#b08a3e','#9a6d84','#9a9488']

function hexTint(hex, a = 0.15) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}
function fmtH(h) {
  const hrs = Math.floor(h), mins = Math.round((h - hrs) * 60)
  const ampm = hrs >= 12 ? 'PM' : 'AM', h12 = hrs % 12 || 12
  return mins === 0 ? `${h12} ${ampm}` : `${h12}:${String(mins).padStart(2,'0')} ${ampm}`
}
function toTimeStr(h) {
  return `${String(Math.floor(h)).padStart(2,'0')}:${String(Math.round((h % 1) * 60)).padStart(2,'0')}`
}
function snapTo(h, step) { return Math.round(h / step) * step }

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 9, fontSize: 13.5,
  border: '1px solid var(--bd)', background: 'var(--surface-2)', color: 'var(--ink)',
  fontFamily: 'inherit', outline: 'none',
}
const labelStyle = { display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 5, letterSpacing: '.03em' }

// ─── Event detail modal ───────────────────────────────────────────────────
function EventDetailModal({ event, onClose, onDelete }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 380, zIndex: 51, background: 'var(--surface)', borderRadius: 18, boxShadow: '0 16px 48px rgba(0,0,0,.22)', overflow: 'hidden' }}>
        <div style={{ height: 5, background: event.color }} />
        <div style={{ padding: '20px 22px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 600, color: 'var(--ink)', flex: 1, paddingRight: 12 }}>{event.title}</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: 2 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--mid)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/></svg>
              {event.date}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--mid)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>
              {event.time} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({event.durDisplay})</span>
            </div>
            {event.location && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--mid)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                {event.location}
              </div>
            )}
          </div>
          {event.description && <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--mid)', lineHeight: 1.55, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>{event.description}</p>}
          {event.notes && <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--mid)', lineHeight: 1.55, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>{event.notes}</p>}
          {event.isLocal && (
            <button onClick={() => { onDelete(event.id); onClose() }} style={{ fontSize: 13, color: '#c15f3c', background: 'rgba(193,95,60,.09)', border: 'none', borderRadius: 9, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              Delete event
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Add event modal ──────────────────────────────────────────────────────
function AddEventModal({ onClose, onAdd, defaultDate, defaultStartTime = '09:00', defaultEndTime = '10:00' }) {
  const [form, setForm] = useState({
    title: '', date: defaultDate, startTime: defaultStartTime, endTime: defaultEndTime,
    color: PALETTE[0], notes: '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleAdd = () => {
    if (!form.title.trim()) return
    const [sh, sm] = form.startTime.split(':').map(Number)
    const [eh, em] = form.endTime.split(':').map(Number)
    onAdd({ title: form.title.trim(), date: form.date, startH: sh + sm/60, endH: eh + em/60, color: form.color, notes: form.notes })
    onClose()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 420, zIndex: 51, background: 'var(--surface)', borderRadius: 18, boxShadow: '0 16px 48px rgba(0,0,0,.22)' }}>
        <div style={{ padding: '22px 24px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 600, color: 'var(--ink)' }}>Add event</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} value={form.title} autoFocus onChange={e => set('title', e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} placeholder="Event title" />
            </div>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" style={inputStyle} value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Start</label>
                <input type="time" style={inputStyle} value={form.startTime} onChange={e => set('startTime', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>End</label>
                <input type="time" style={inputStyle} value={form.endTime} onChange={e => set('endTime', e.target.value)} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Colour</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {PALETTE.map(c => (
                  <div key={c} onClick={() => set('color', c)} style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', outline: form.color === c ? `3px solid ${c}` : 'none', outlineOffset: 2 }} />
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Add any notes…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--mid)', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={handleAdd} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#c15f3c', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(193,95,60,.32)' }}>Add event</button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Calendar page ────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { gcal, connectGoogle, refetchEvents, createGcalEvent } = useIntegrations()
  const { events: localEvents, addEvent, removeEvent } = useLocalCalendar()
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addDraft, setAddDraft] = useState(null)      // { date, startH, endH } pre-fill from click/drag
  const [ghost, setGhost] = useState(null)             // { date, startH, endH } visual preview
  const [syncStatus, setSyncStatus] = useState(null)
  const dragRef = useRef(null)

  const { weekStart, weekEnd, todayStr } = getWeekRange(weekOffset)

  // Refetch when week changes, when GCal connects, or after a mutation (event created)
  useEffect(() => {
    if (gcal.connected) refetchEvents(weekStart, weekEnd)
  }, [gcal.connected, weekOffset, gcal.mutatedAt]) // eslint-disable-line

  const handleAddEvent = async (eventData) => {
    if (gcal.connected) {
      setSyncStatus('syncing')
      try {
        await createGcalEvent(eventData)
        setSyncStatus('synced')
      } catch {
        addEvent(eventData)
        setSyncStatus('local')
      }
      setTimeout(() => setSyncStatus(null), 3000)
    } else {
      addEvent(eventData)
    }
  }

  // ─── Drag-to-create helpers ─────────────────────────────────────────────
  const hourFromEl = (el, clientY) => {
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(24, (clientY - rect.top) / HOUR_H))
  }

  const handleColDown = (e, dateStr) => {
    if (e.target.closest('[data-event]')) return   // clicking an existing event
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { date: dateStr, startH: hourFromEl(e.currentTarget, e.clientY), startY: e.clientY, el: e.currentTarget }
  }

  const handleColMove = (e) => {
    const d = dragRef.current
    if (!d || Math.abs(e.clientY - d.startY) < 8) return
    const curH = hourFromEl(d.el, e.clientY)
    const lo = snapTo(Math.min(d.startH, curH), 0.25)
    const hi = snapTo(Math.max(d.startH, curH), 0.25)
    setGhost({ date: d.date, startH: lo, endH: Math.max(hi, lo + 0.25) })
  }

  const handleColUp = (e) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    const moved = Math.abs(e.clientY - d.startY)

    if (moved < 8) {
      // Click → 1-hour event snapped to nearest 30 min
      const snapped = snapTo(hourFromEl(d.el, e.clientY), 0.5)
      setAddDraft({ date: d.date, startH: snapped, endH: snapped + 1 })
    } else if (ghost) {
      setAddDraft({ date: ghost.date, startH: ghost.startH, endH: ghost.endH })
    }
    setGhost(null)
    setShowAddModal(true)
  }

  // Format local events to match gcal event shape
  const localFormatted = localEvents.map(e => ({
    id: e.id, title: e.title, start: e.startH,
    dur: Math.max(e.endH - e.startH, 0.25),
    time: `${fmtH(e.startH)}–${fmtH(e.endH)}`,
    timeDisplay: fmtH(e.startH),
    durDisplay: `${Math.round(Math.max(e.endH - e.startH, 0.25) * 60)}m`,
    color: e.color, tint: hexTint(e.color),
    date: e.date, isLocal: true, notes: e.notes,
    description: '', location: '',
  }))

  const allEvents = [...gcal.events, ...localFormatted]

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const dateStr = localDateStr(d)
    return { dow: DOW[i], num: d.getDate(), today: dateStr === todayStr, dateStr, events: allEvents.filter(ev => ev.date === dateStr) }
  })

  const weekLabel = `${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – ${weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
  const defaultAddDate = weekDays.find(d => d.today)?.dateStr ?? localDateStr(weekStart)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, flex: 'none' }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 34, fontWeight: 500, color: 'var(--ink)' }}>Calendar</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>{weekLabel}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!gcal.connected && (
            <button onClick={connectGoogle} style={{ fontSize: 13, color: '#5f7591', background: 'rgba(95,117,145,.1)', border: '1px solid rgba(95,117,145,.25)', padding: '7px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              Connect Google Calendar
            </button>
          )}
          {gcal.loading && <span style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</span>}
          {gcal.error && <span style={{ fontSize: 13, color: '#c15f3c' }}>⚠ {gcal.error}</span>}

          {/* Week navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setWeekOffset(o => o - 1)} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            {weekOffset !== 0 && (
              <button onClick={() => setWeekOffset(0)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Today</button>
            )}
            <button onClick={() => setWeekOffset(o => o + 1)} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          <button onClick={() => { setAddDraft(null); setShowAddModal(true) }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 9, border: 'none', background: '#c15f3c', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(193,95,60,.28)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add event
          </button>

          <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--surface-2)', border: '1px solid var(--bd)', borderRadius: 11 }}>
            {['Day','Week','Agenda'].map((v, i) => (
              <span key={v} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: i === 1 ? 'var(--ink)' : 'var(--muted)', background: i === 1 ? 'var(--surface)' : 'transparent', boxShadow: i === 1 ? '0 1px 3px var(--bd)' : 'none' }}>{v}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar card */}
      <div style={{ flex: 1, minHeight: 0, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          {/* Day headers — sticky */}
          <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7,1fr)', borderBottom: '1px solid var(--bd)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
            <div />
            {weekDays.map(d => (
              <div key={d.dow} style={{ padding: '13px 8px', textAlign: 'center', borderLeft: '1px solid var(--bd-xs)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>{d.dow}</div>
                <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', fontFamily: "'Newsreader', serif", fontSize: 16, fontWeight: 600, color: d.today ? '#fff' : 'var(--ink)', background: d.today ? '#c15f3c' : 'transparent' }}>{d.num}</div>
              </div>
            ))}
          </div>

          {/* Hour grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7,1fr)' }}>
            {/* Time labels */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {HOURS.map(h => (
                <div key={h} style={{ height: HOUR_H, position: 'relative' }}>
                  <span style={{ position: 'absolute', top: -7, right: 8, fontSize: 10.5, color: 'var(--faint)' }}>
                    {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`}
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {weekDays.map(d => (
              <div
                key={d.dow}
                style={{ position: 'relative', borderLeft: '1px solid var(--bd-xs)', background: d.today ? 'rgba(193,95,60,.025)' : 'transparent', userSelect: 'none', cursor: 'crosshair' }}
                onPointerDown={e => handleColDown(e, d.dateStr)}
                onPointerMove={handleColMove}
                onPointerUp={handleColUp}
              >
                {HOURS.map(h => <div key={h} style={{ height: HOUR_H, borderTop: '1px solid var(--bd-2xs)' }} />)}

                {/* Existing events */}
                {d.events
                  .filter(ev => ev.start >= DAY_START && ev.start < 24)
                  .map((ev, i) => {
                    const top = (ev.start - DAY_START) * HOUR_H
                    const height = Math.max(ev.dur * HOUR_H - 4, 20)
                    return (
                      <div
                        key={ev.id || i}
                        data-event="true"
                        onClick={e => { e.stopPropagation(); setSelectedEvent(ev) }}
                        style={{ position: 'absolute', left: 4, right: 4, top, height, background: ev.tint, borderLeft: `3px solid ${ev.color}`, borderRadius: 8, padding: '5px 8px', overflow: 'hidden', cursor: 'pointer', transition: 'filter .1s' }}
                        onMouseEnter={e => e.currentTarget.style.filter = 'brightness(.94)'}
                        onMouseLeave={e => e.currentTarget.style.filter = ''}
                      >
                        <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.2, color: ev.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
                        {height > 28 && <div style={{ fontSize: 10, color: ev.color, opacity: .8 }}>{ev.timeDisplay}</div>}
                      </div>
                    )
                  })}

                {/* Drag ghost */}
                {ghost && ghost.date === d.dateStr && (
                  <div style={{ position: 'absolute', left: 4, right: 4, top: ghost.startH * HOUR_H, height: Math.max((ghost.endH - ghost.startH) * HOUR_H, 12), background: 'rgba(95,117,145,.18)', borderLeft: '3px solid #5f7591', borderRadius: 8, padding: '4px 8px', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: '#5f7591' }}>{fmtH(ghost.startH)} – {fmtH(ghost.endH)}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modals */}
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} onDelete={removeEvent} />
      )}
      {showAddModal && (
        <AddEventModal
          onClose={() => { setShowAddModal(false); setAddDraft(null) }}
          onAdd={handleAddEvent}
          defaultDate={addDraft?.date ?? defaultAddDate}
          defaultStartTime={addDraft ? toTimeStr(addDraft.startH) : '09:00'}
          defaultEndTime={addDraft ? toTimeStr(addDraft.endH) : '10:00'}
        />
      )}
      {syncStatus && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 60, padding: '10px 18px', borderRadius: 10, background: 'var(--ink)', color: 'var(--surface)', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,.2)', whiteSpace: 'nowrap' }}>
          {syncStatus === 'syncing' && '⏳ Adding to Google Calendar…'}
          {syncStatus === 'synced'  && '✓ Added to Google Calendar'}
          {syncStatus === 'local'   && '⚠ Saved locally — reconnect Google Calendar for write access'}
        </div>
      )}
    </div>
  )
}
