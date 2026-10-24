import { PageHeader, Button, card, eyebrow } from '../components/ui.jsx'
import { useFocusRequest } from '../lib/focus.js'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useLocalCalendar } from '../context/LocalCalendarContext.jsx'
import { getWeekRange, localDateStr } from '../integrations/googleCalendar.js'
import { ATLAS_COLORS, atlasHex } from '../lib/calendarColors.js'
import { layoutOverlaps, eventBox, floorToSlot, SLOT } from '../lib/calendarLayout.js'
import EventLabel from '../components/EventLabel.jsx'
import { mondayOf, parseLocalDate, addDays } from '../lib/week.js'
import { useCalendarEvents, fmtH } from '../hooks/useCalendarEvents.js'
import DaySchedule from '../components/DaySchedule.jsx'
import Sheet from '../components/Sheet.jsx'
import { useGoals } from '../context/GoalsContext.jsx'
import { shineWave } from '../lib/goalTime.js'
import { useShineSync } from '../hooks/useShineSync.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { useQuickAdd } from '../context/QuickAddContext.jsx'

// 64px an hour gives a 15-minute block 16px — one readable line.
const HOUR_H = 64
const DAY_START = 0
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

function toTimeStr(h) {
  return `${String(Math.floor(h)).padStart(2,'0')}:${String(Math.round((h % 1) * 60)).padStart(2,'0')}`
}
function snapTo(h, step) { return Math.round(h / step) * step }
const edgeHandle = { position: 'absolute', left: 0, right: 0, height: 6, cursor: 'ns-resize' }

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 9, fontSize: 13.5,
  border: '1px solid var(--bd)', background: 'var(--surface-2)', color: 'var(--ink)',
  fontFamily: 'inherit', outline: 'none',
}
const labelStyle = { display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 5, letterSpacing: '.03em' }

// ─── Event detail modal ───────────────────────────────────────────────────
export function EventDetailModal({ event, onClose, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const canDelete = !event.isSleepWakeUp

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    setError(null)
    try {
      await onDelete(event)
      onClose()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  return (
    <Sheet title={event.title} onClose={onClose} accent={event.color} width={400}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--mid)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/></svg>
              {event.date}
            </div>
            {!event.isAllDay && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--mid)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>
                {event.time} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({event.durDisplay})</span>
              </div>
            )}
            {event.isAllDay && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--mid)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>
                All day
              </div>
            )}
            {event.location && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--mid)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                {event.location}
              </div>
            )}
          </div>
          {event.description && <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--mid)', lineHeight: 1.55, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>{event.description}</p>}
          {event.notes && <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--mid)', lineHeight: 1.55, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>{event.notes}</p>}
          {canDelete && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={handleDelete} disabled={deleting} style={{ fontSize: 13, color: confirming ? '#fff' : 'var(--accent)', background: confirming ? 'var(--accent)' : 'rgba(193,95,60,.09)', border: 'none', borderRadius: 9, padding: '8px 14px', cursor: deleting ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 500, opacity: deleting ? .6 : 1 }}>
                {deleting ? 'Deleting…' : confirming ? 'Confirm delete' : 'Delete event'}
              </button>
              {confirming && !deleting && (
                <button onClick={() => setConfirming(false)} style={{ fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              )}
              {!event.isLocal && !confirming && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Removes it from Google Calendar</span>}
              {error && <span style={{ fontSize: 12, color: 'var(--accent)' }}>⚠ {error}</span>}
            </div>
          )}
    </Sheet>
  )
}

// ─── Add event modal ──────────────────────────────────────────────────────
function AddEventModal({ onClose, onAdd, defaultDate, defaultStartTime = '09:00', defaultEndTime = '10:00' }) {
  const [form, setForm] = useState({
    title: '', date: defaultDate, startTime: defaultStartTime, endTime: defaultEndTime,
    atlasColor: '', notes: '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleAdd = () => {
    if (!form.title.trim()) return
    const [sh, sm] = form.startTime.split(':').map(Number)
    const [eh, em] = form.endTime.split(':').map(Number)
    // atlasColor '' = Auto: drawn in the colour its Google colour maps to. A
    // local event (no Google) needs a colour of its own, so Auto is blue there.
    onAdd({ title: form.title.trim(), date: form.date, startH: sh + sm/60, endH: eh + em/60, atlasColor: form.atlasColor, color: atlasHex(form.atlasColor) ?? ATLAS_COLORS[0].hex, notes: form.notes })
    onClose()
  }

  return (
    <Sheet title="Add event" onClose={onClose} width={420}>
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {[{ name: '', hex: null }, ...ATLAS_COLORS].map(c => (
                  <button key={c.name} type="button" onClick={() => set('atlasColor', c.name)} title={c.name || 'Auto'} aria-label={c.name || 'Auto'} aria-pressed={form.atlasColor === c.name}
                    style={{ width: 22, height: 22, padding: 0, borderRadius: '50%', cursor: 'pointer',
                             background: c.hex || 'transparent', border: c.hex ? 'none' : '1.5px dashed var(--faint)',
                             outline: form.atlasColor === c.name ? `2px solid ${c.hex || 'var(--mid)'}` : 'none', outlineOffset: 2 }} />
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{form.atlasColor ? form.atlasColor[0].toUpperCase() + form.atlasColor.slice(1) : 'Auto — matches its Google Calendar colour'}</div>
            </div>
            <div>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Add any notes…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--mid)', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={handleAdd} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow-accent)' }}>Add event</button>
          </div>
    </Sheet>
  )
}

// ─── Calendar page ────────────────────────────────────────────────────────
export default function CalendarPage() {
  const isMobile = useIsMobile()
  const { gcal, connectGoogle, refetchEvents, createGcalEvent, removeGcalEvent, shiftGcalEvents } = useIntegrations()
  const { addEvent, removeEvent, moveEvent } = useLocalCalendar()
  const allEvents = useCalendarEvents()
  const { goals } = useGoals()
  useShineSync()
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addDraft, setAddDraft] = useState(null)
  useQuickAdd('Add event', () => { setAddDraft(null); setShowAddModal(true) })
  const [ghost, setGhost] = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
  const dragRef = useRef(null)
  const weekScrollRef = useRef(null)

  // Current time, for the "now" line in today's column.
  const nowHours = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 }
  const [nowH, setNowH] = useState(nowHours)
  useEffect(() => {
    const id = setInterval(() => setNowH(nowHours()), 60_000)
    return () => clearInterval(id)
  }, [])
  // Open the week scrolled to an hour before now, so the line is in view.
  useEffect(() => {
    if (weekScrollRef.current) weekScrollRef.current.scrollTop = Math.max(0, nowHours() - 1) * HOUR_H
  }, [isMobile]) // eslint-disable-line
  const swipeRef = useRef(null)

  // Mobile shows one day at a time; the week fetched is whichever contains it.
  const [selDay, setSelDay] = useState(() => localDateStr(new Date()))
  const dayWeekOffset = Math.round((mondayOf(parseLocalDate(selDay)) - mondayOf()) / (7 * 864e5))
  const activeOffset = isMobile ? dayWeekOffset : weekOffset
  const { weekStart, weekEnd, todayStr } = getWeekRange(activeOffset)
  const stepDay = (n) => setSelDay(d => localDateStr(addDays(parseLocalDate(d), n)))

  // From search: go to the event's day/week and open it.
  useFocusRequest(['calendar'], t => {
    const weeks = Math.round((mondayOf(parseLocalDate(t.date)) - mondayOf(new Date())) / (7 * 86_400_000))
    setWeekOffset(weeks)
    setSelDay(t.date)
  })
  useFocusRequest(['event'], t => {
    const weeks = Math.round((mondayOf(parseLocalDate(t.date)) - mondayOf(new Date())) / (7 * 86_400_000))
    setWeekOffset(weeks)
    setSelDay(t.date)
    const ev = allEvents.find(e => e.id === t.id && e.date === t.date)
    if (ev) setSelectedEvent(ev)
  })

  useEffect(() => {
    if (gcal.connected) refetchEvents(weekStart, weekEnd)
  }, [gcal.connected, activeOffset, gcal.mutatedAt]) // eslint-disable-line

  const onSwipeStart = (e) => { const t = e.touches[0]; swipeRef.current = { x: t.clientX, y: t.clientY } }
  const onSwipeEnd = (e) => {
    const s = swipeRef.current
    swipeRef.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepDay(dx < 0 ? 1 : -1)
  }

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

  const handleDeleteEvent = (ev) => ev.isLocal ? removeEvent(ev.id) : removeGcalEvent(ev.id)

  // ─── Multi-select (Ctrl/⌘-click), drag-to-move, bulk delete ─────────────
  const [selected, setSelected] = useState(() => new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [movePreview, setMovePreview] = useState(null) // { ids, mode, days, hours }
  const moveRef = useRef(null)
  const clearSelection = useCallback(() => { setSelected(new Set()); setConfirmingDelete(false) }, [])
  const toggleSelected = (ev) => {
    setConfirmingDelete(false)
    setSelected(prev => {
      const next = new Set(prev)
      next.has(ev.id) ? next.delete(ev.id) : next.add(ev.id)
      return next
    })
  }
  // One entry per event (an id can show on more than one day).
  const eventsByIds = (ids) => {
    const seen = new Set()
    return allEvents.filter(e => ids.has(e.id) && !e.isSleepWakeUp && !seen.has(e.id) && seen.add(e.id))
  }
  useEffect(() => { clearSelection() }, [activeOffset, clearSelection])

  const flashStatus = (status) => { setSyncStatus(status); setTimeout(() => setSyncStatus(null), 3000) }

  const deleteSelected = async () => {
    const evs = eventsByIds(selected)
    clearSelection()
    const results = await Promise.allSettled(evs.map(handleDeleteEvent))
    flashStatus(results.some(r => r.status === 'rejected') ? 'delete-failed' : `deleted:${evs.length}`)
  }

  // Where a dragged event lands. mode 'move' shifts it (kept within the day);
  // 'top'/'bottom' drag one edge, never shorter than 15 minutes.
  const landing = (ev, { mode, days, hours }) => {
    const end = ev.start + ev.dur
    if (mode === 'top') return { date: ev.date, startH: Math.max(0, Math.min(end - 0.25, ev.start + hours)), endH: end }
    if (mode === 'bottom') return { date: ev.date, startH: ev.start, endH: Math.min(24, Math.max(ev.start + 0.25, end + hours)) }
    const startH = Math.max(0, Math.min(24 - ev.dur, ev.start + hours))
    return { date: localDateStr(addDays(parseLocalDate(ev.date), days)), startH, endH: startH + ev.dur }
  }

  const applyDrag = async (evs, drag) => {
    // Every event shifts by the same amount, so the first one sets it.
    const to = landing(evs[0], drag)
    const shift = { days: drag.mode === 'move' ? drag.days : 0, startHours: to.startH - evs[0].start, endHours: to.endH - (evs[0].start + evs[0].dur) }
    if (drag.mode === 'move') shift.startHours = shift.endHours = drag.hours
    const gcalIds = evs.filter(e => !e.isLocal).map(e => e.id)
    const local = evs.filter(e => e.isLocal).map(e => moveEvent(e.id, landing(e, drag)))
    const results = await Promise.allSettled([...(gcalIds.length ? [shiftGcalEvents(gcalIds, shift)] : []), ...local])
    if (results.some(r => r.status === 'rejected')) flashStatus('move-failed')
  }

  // A press on an event is a click (open it, or Ctrl/⌘ to select it) unless it
  // moves, in which case it drags: the selection if the event is in it, else
  // just that event. Up/down shifts time in 15-minute steps; across shifts days.
  // Pressing on the top or bottom edge resizes that one event instead.
  const onEventPointerDown = (e, ev) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctrl = e.ctrlKey || e.metaKey
    const mode = e.target.dataset?.edge || 'move'
    const ids = mode !== 'move' ? new Set([ev.id])
      : selected.has(ev.id) ? selected : ctrl ? new Set([...selected, ev.id]) : new Set([ev.id])
    moveRef.current = { ev, ctrl, ids, mode, x: e.clientX, y: e.clientY, days: 0, hours: 0, moved: false }
  }
  const onEventPointerMove = (e) => {
    const m = moveRef.current
    if (!m) return
    if (!m.moved && Math.hypot(e.clientX - m.x, e.clientY - m.y) < 5) return
    m.moved = true
    m.hours = snapTo((e.clientY - m.y) / HOUR_H, 0.25)
    const col = m.mode === 'move' && document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-date]')
    if (col) m.days = Math.round((parseLocalDate(col.dataset.date) - parseLocalDate(m.ev.date)) / 864e5)
    setMovePreview({ ids: m.ids, mode: m.mode, days: m.days, hours: m.hours })
  }
  const onEventPointerUp = () => {
    const m = moveRef.current
    moveRef.current = null
    setMovePreview(null)
    if (!m) return
    if (!m.moved) {
      if (m.ctrl && m.mode === 'move') toggleSelected(m.ev)
      else { clearSelection(); setSelectedEvent(m.ev) }
      return
    }
    if (m.days || m.hours) applyDrag(eventsByIds(m.ids), m)
  }
  const onEventPointerCancel = () => { moveRef.current = null; setMovePreview(null) }

  // Escape clears the selection; Delete/Backspace asks, then deletes.
  useEffect(() => {
    if (!selected.size) return
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') clearSelection()
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); confirmingDelete ? deleteSelected() : setConfirmingDelete(true) }
      else if (e.key === 'Enter' && confirmingDelete) { e.preventDefault(); deleteSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // re-binds each render so deleteSelected sees the current selection

  // ─── Drag-to-create helpers ─────────────────────────────────────────────
  const hourFromEl = (el, clientY) => {
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(24, (clientY - rect.top) / HOUR_H))
  }

  const handleColDown = (e, dateStr) => {
    if (e.target.closest('[data-event]')) return
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
    if (moved < 8 && selected.size) { clearSelection(); return }
    if (moved < 8) {
      const snapped = floorToSlot(hourFromEl(d.el, e.clientY))
      setAddDraft({ date: d.date, startH: snapped, endH: snapped + 1 })
    } else if (ghost) {
      setAddDraft({ date: ghost.date, startH: ghost.startH, endH: ghost.endH })
    }
    setGhost(null)
    setShowAddModal(true)
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const dateStr = localDateStr(d)
    return { dow: DOW[i], num: d.getDate(), today: dateStr === todayStr, dateStr, events: allEvents.filter(ev => ev.date === dateStr), isPast: dateStr < todayStr }
  })

  const dayLabel = parseLocalDate(selDay).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  // One wave across the whole visible week, in date/time order.
  const wave = shineWave(weekDays.flatMap(d => d.events.filter(ev => !ev.isAllDay && ev.start >= DAY_START && ev.start < 24)), goals)
  const weekLabel = `${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – ${weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
  const defaultAddDate = isMobile ? selDay : weekDays.find(d => d.today)?.dateStr ?? localDateStr(weekStart)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* Page header */}
      <PageHeader title="Calendar" subtitle={isMobile ? dayLabel : weekLabel} isMobile={isMobile} style={{ flex: 'none', padding: isMobile ? '20px 20px 0' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!gcal.connected && !isMobile && (
            <button onClick={connectGoogle} style={{ fontSize: 13, color: 'var(--blue)', background: 'rgba(95,117,145,.1)', border: '1px solid rgba(95,117,145,.25)', padding: '7px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              Connect Google Calendar
            </button>
          )}
          {gcal.loading && !isMobile && <span style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</span>}
          {gcal.error && <span style={{ fontSize: 13, color: 'var(--accent)' }}>⚠ {gcal.error}</span>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => isMobile ? stepDay(-1) : setWeekOffset(o => o - 1)} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            {(isMobile ? selDay !== todayStr : weekOffset !== 0) && (
              <button onClick={() => isMobile ? setSelDay(localDateStr(new Date())) : setWeekOffset(0)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Today</button>
            )}
            <button onClick={() => isMobile ? stepDay(1) : setWeekOffset(o => o + 1)} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', cursor: 'pointer' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          {!isMobile && (
            <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--surface-2)', border: '1px solid var(--bd)', borderRadius: 11 }}>
              {['Day','Week','Agenda'].map((v, i) => (
                <span key={v} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: i === 1 ? 'var(--ink)' : 'var(--muted)', background: i === 1 ? 'var(--surface)' : 'transparent', boxShadow: i === 1 ? '0 1px 3px var(--bd)' : 'none' }}>{v}</span>
              ))}
            </div>
          )}
        </div>
      </PageHeader>

      {/* Mobile: one day as a time column — swipe for the previous / next day */}
      {isMobile && (
        <div onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0 12px 0 4px' }}>
          {!gcal.connected && (
            <button onClick={connectGoogle} style={{ alignSelf: 'flex-start', margin: '0 0 10px 12px', fontSize: 13, color: 'var(--blue)', background: 'rgba(95,117,145,.1)', border: '1px solid rgba(95,117,145,.25)', padding: '7px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              Connect Google Calendar
            </button>
          )}
          <DaySchedule
            dateStr={selDay}
            events={allEvents.filter(ev => ev.date === selDay)}
            isToday={selDay === todayStr}
            isPast={selDay < todayStr}
            onEventClick={setSelectedEvent}
            onSlotClick={h => { setAddDraft({ date: selDay, startH: h, endH: h + 1 }); setShowAddModal(true) }}
            style={{ flex: 1, paddingBottom: 'env(safe-area-inset-bottom)' }}
          />
        </div>
      )}

      {/* Desktop: Calendar card */}
      {!isMobile && <div style={{ flex: 1, minHeight: 0, ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div ref={weekScrollRef} className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          {/* Day headers — sticky */}
          <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7,1fr)', borderBottom: '1px solid var(--bd)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
            <div />
            {weekDays.map(d => {
              const allDayEvs = d.events.filter(ev => ev.isAllDay)
              return (
                <div key={d.dow} style={{ padding: allDayEvs.length > 0 ? '8px 6px 5px' : '13px 8px', textAlign: 'center', borderLeft: '1px solid var(--bd-xs)' }}>
                  <div style={{ ...eyebrow }}>{d.dow}</div>
                  <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600, color: d.today ? '#fff' : 'var(--ink)', background: d.today ? 'var(--accent)' : 'transparent' }}>{d.num}</div>
                  {allDayEvs.map(ev => (
                    <div key={ev.id} onClick={e => { if (e.ctrlKey || e.metaKey) toggleSelected(ev); else { clearSelection(); setSelectedEvent(ev) } }}
                      style={{ marginTop: 3, padding: '2px 5px', borderRadius: 4, fontSize: 10.5, fontWeight: 500, background: ev.tint, color: ev.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', textAlign: 'left',
                               outline: selected.has(ev.id) ? `2px solid ${ev.color}` : 'none', outlineOffset: 1 }}>
                      {ev.title}
                    </div>
                  ))}
                </div>
              )
            })}
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
              <div key={d.dow} data-date={d.dateStr}
                style={{ position: 'relative', borderLeft: '1px solid var(--bd-xs)', background: d.today ? 'rgba(193,95,60,.025)' : 'transparent', userSelect: 'none', cursor: 'crosshair' }}
                onPointerDown={e => handleColDown(e, d.dateStr)}
                onPointerMove={handleColMove}
                onPointerUp={handleColUp}
              >
                {HOURS.map(h => <div key={h} style={{ height: HOUR_H, borderTop: '1px solid var(--bd-2xs)' }} />)}

                {/* Timed events — overlapping ones sit side by side */}
                {(() => {
                  const timed = d.events.filter(ev => !ev.isAllDay && !ev.isSleepWakeUp && ev.start >= DAY_START && ev.start < 24)
                  const layout = layoutOverlaps(timed, SLOT)
                  return timed.map((ev, i) => {
                    const { top, height, compact } = eventBox({ ...ev, start: ev.start - DAY_START }, HOUR_H)
                    const { left, width } = layout.get(ev)
                    const shine = wave.get(ev) || {}
                    const isSel = selected.has(ev.id)
                    const isMoving = movePreview?.ids.has(ev.id)
                    return (
                      <div key={ev.id || i} data-event="true" className={shine.className}
                        onPointerDown={e => onEventPointerDown(e, ev)}
                        onPointerMove={onEventPointerMove}
                        onPointerUp={onEventPointerUp}
                        onPointerCancel={onEventPointerCancel}
                        style={{
                          opacity: isMoving ? 0.35 : 1,
                          outline: isSel ? `2px solid ${ev.color}` : 'none', outlineOffset: 1,
                          touchAction: 'none',
                          position: 'absolute', top, height, '--shine-delay': shine.shineDelay,
                          left: `calc(${left * 100}% + 4px)`,
                          width: `calc(${width * 100}% - ${left + width >= 1 ? 8 : 6}px)`,
                          zIndex: 1,
                          boxShadow: left > 0 ? '0 0 0 1px var(--surface)' : 'none',
                          background: ev.tint,
                          borderLeft: `3px solid ${ev.color}`,
                          borderRadius: compact ? 5 : 8, padding: compact ? '0 6px' : '5px 8px', overflow: 'hidden', cursor: movePreview ? 'grabbing' : 'pointer', transition: 'filter .1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.filter = 'brightness(.94)'}
                        onMouseLeave={e => e.currentTarget.style.filter = ''}
                      >
                        <EventLabel ev={ev} height={height} compact={compact} size={11.5} />
                        {/* Resize handles; short events keep the middle free for moving */}
                        {height >= 24 && <div data-edge="top" style={{ ...edgeHandle, top: 0 }} />}
                        <div data-edge="bottom" style={{ ...edgeHandle, bottom: 0, height: height >= 24 ? 6 : 4 }} />
                      </div>
                    )
                  })
                })()}

                {/* Now line — today's column only, same as the day view */}
                {d.today && (
                  <div style={{ position: 'absolute', left: -4, right: 0, top: (nowH - DAY_START) * HOUR_H - 1, height: 2, background: 'var(--accent)', zIndex: 3, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', left: 0, top: -3, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
                  </div>
                )}

                {/* Where the events being dragged will land */}
                {movePreview && eventsByIds(movePreview.ids)
                  .filter(ev => !ev.isAllDay)
                  .map(ev => ({ ev, to: landing(ev, movePreview) }))
                  .filter(({ to }) => to.date === d.dateStr)
                  .map(({ ev, to }) => (
                    <div key={`move-${ev.id}`} style={{ position: 'absolute', left: 4, right: 4, top: to.startH * HOUR_H, height: Math.max((to.endH - to.startH) * HOUR_H, 16), background: ev.tint, borderLeft: `3px solid ${ev.color}`, borderRadius: 8, padding: '3px 8px', pointerEvents: 'none', zIndex: 4, boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: ev.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtH(to.startH)} – {fmtH(to.endH)} · {ev.title}</div>
                    </div>
                  ))}

                {/* Drag ghost */}
                {ghost && ghost.date === d.dateStr && (
                  <div style={{ position: 'absolute', left: 4, right: 4, top: ghost.startH * HOUR_H, height: Math.max((ghost.endH - ghost.startH) * HOUR_H, 12), background: 'rgba(95,117,145,.18)', borderLeft: '3px solid var(--blue)', borderRadius: 8, padding: '4px 8px', pointerEvents: 'none' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--blue)' }}>{fmtH(ghost.startH)} – {fmtH(ghost.endH)}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>}

      {/* Modals */}
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} onDelete={handleDeleteEvent} />
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
      {!isMobile && selected.size > 0 && !movePreview && (
        <div role="toolbar" aria-label="Selected events"
          style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 55, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--bd)', boxShadow: 'var(--shadow-pop)', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{selected.size} selected</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Drag to move</span>
          {confirmingDelete ? (
            <>
              <Button size="sm" variant="danger" onClick={deleteSelected}>Delete {selected.size}?</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => setConfirmingDelete(true)}>Delete</Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            </>
          )}
        </div>
      )}
      {syncStatus && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 60, padding: '10px 18px', borderRadius: 10, background: 'var(--ink)', color: 'var(--surface)', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,.2)', whiteSpace: 'nowrap' }}>
          {syncStatus === 'syncing' && '⏳ Adding to Google Calendar…'}
          {syncStatus === 'synced'  && '✓ Added to Google Calendar'}
          {syncStatus === 'local'   && '⚠ Saved locally — reconnect Google Calendar for write access'}
          {syncStatus === 'move-failed'   && '⚠ Some events couldn\u2019t be moved'}
          {syncStatus === 'delete-failed' && '⚠ Some events couldn\u2019t be deleted'}
          {syncStatus?.startsWith('deleted:') && `✓ Deleted ${syncStatus.slice(8)} event${syncStatus.slice(8) === '1' ? '' : 's'}`}
        </div>
      )}
    </div>
  )
}
