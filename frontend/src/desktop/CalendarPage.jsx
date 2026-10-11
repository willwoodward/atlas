import { useEffect, useState, useRef } from 'react'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useLocalCalendar } from '../context/LocalCalendarContext.jsx'
import { getWeekRange, localDateStr } from '../integrations/googleCalendar.js'
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
const PALETTE = ['#5f7591','#6f8168','#c15f3c','#b08a3e','#9a6d84','#9a9488']

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
              <button onClick={handleDelete} disabled={deleting} style={{ fontSize: 13, color: confirming ? '#fff' : '#c15f3c', background: confirming ? '#c15f3c' : 'rgba(193,95,60,.09)', border: 'none', borderRadius: 9, padding: '8px 14px', cursor: deleting ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 500, opacity: deleting ? .6 : 1 }}>
                {deleting ? 'Deleting…' : confirming ? 'Confirm delete' : 'Delete event'}
              </button>
              {confirming && !deleting && (
                <button onClick={() => setConfirming(false)} style={{ fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              )}
              {!event.isLocal && !confirming && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Removes it from Google Calendar</span>}
              {error && <span style={{ fontSize: 12, color: '#c15f3c' }}>⚠ {error}</span>}
            </div>
          )}
    </Sheet>
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
    </Sheet>
  )
}

// ─── Calendar page ────────────────────────────────────────────────────────
export default function CalendarPage() {
  const isMobile = useIsMobile()
  const { gcal, connectGoogle, refetchEvents, createGcalEvent, removeGcalEvent } = useIntegrations()
  const { addEvent, removeEvent } = useLocalCalendar()
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
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, flex: 'none', padding: isMobile ? '20px 20px 0' : 0 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 26 : 34, fontWeight: 500, color: 'var(--ink)' }}>Calendar</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>{isMobile ? dayLabel : weekLabel}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!gcal.connected && !isMobile && (
            <button onClick={connectGoogle} style={{ fontSize: 13, color: '#5f7591', background: 'rgba(95,117,145,.1)', border: '1px solid rgba(95,117,145,.25)', padding: '7px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              Connect Google Calendar
            </button>
          )}
          {gcal.loading && !isMobile && <span style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</span>}
          {gcal.error && <span style={{ fontSize: 13, color: '#c15f3c' }}>⚠ {gcal.error}</span>}

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
      </div>

      {/* Mobile: one day as a time column — swipe for the previous / next day */}
      {isMobile && (
        <div onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0 12px 0 4px' }}>
          {!gcal.connected && (
            <button onClick={connectGoogle} style={{ alignSelf: 'flex-start', margin: '0 0 10px 12px', fontSize: 13, color: '#5f7591', background: 'rgba(95,117,145,.1)', border: '1px solid rgba(95,117,145,.25)', padding: '7px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
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
      {!isMobile && <div style={{ flex: 1, minHeight: 0, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div ref={weekScrollRef} className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          {/* Day headers — sticky */}
          <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7,1fr)', borderBottom: '1px solid var(--bd)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
            <div />
            {weekDays.map(d => {
              const allDayEvs = d.events.filter(ev => ev.isAllDay)
              return (
                <div key={d.dow} style={{ padding: allDayEvs.length > 0 ? '8px 6px 5px' : '13px 8px', textAlign: 'center', borderLeft: '1px solid var(--bd-xs)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>{d.dow}</div>
                  <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', fontFamily: "'Newsreader', serif", fontSize: 16, fontWeight: 600, color: d.today ? '#fff' : 'var(--ink)', background: d.today ? '#c15f3c' : 'transparent' }}>{d.num}</div>
                  {allDayEvs.map(ev => (
                    <div key={ev.id} onClick={() => setSelectedEvent(ev)}
                      style={{ marginTop: 3, padding: '2px 5px', borderRadius: 4, fontSize: 10.5, fontWeight: 500, background: ev.tint, color: ev.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', textAlign: 'left' }}>
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
              <div key={d.dow}
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
                    return (
                      <div key={ev.id || i} data-event="true" className={shine.className}
                        onClick={e => { e.stopPropagation(); setSelectedEvent(ev) }}
                        style={{
                          position: 'absolute', top, height, '--shine-delay': shine.shineDelay,
                          left: `calc(${left * 100}% + 4px)`,
                          width: `calc(${width * 100}% - ${left + width >= 1 ? 8 : 6}px)`,
                          zIndex: 1,
                          boxShadow: left > 0 ? '0 0 0 1px var(--surface)' : 'none',
                          background: ev.tint,
                          borderLeft: `3px solid ${ev.color}`,
                          borderRadius: compact ? 5 : 8, padding: compact ? '0 6px' : '5px 8px', overflow: 'hidden', cursor: 'pointer', transition: 'filter .1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.filter = 'brightness(.94)'}
                        onMouseLeave={e => e.currentTarget.style.filter = ''}
                      >
                        <EventLabel ev={ev} height={height} compact={compact} size={11.5} />
                      </div>
                    )
                  })
                })()}

                {/* Now line — today's column only, same as the day view */}
                {d.today && (
                  <div style={{ position: 'absolute', left: -4, right: 0, top: (nowH - DAY_START) * HOUR_H - 1, height: 2, background: '#c15f3c', zIndex: 3, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', left: 0, top: -3, width: 8, height: 8, borderRadius: '50%', background: '#c15f3c' }} />
                  </div>
                )}

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
