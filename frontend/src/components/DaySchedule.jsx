import { useEffect, useRef, useState } from 'react'
import { layoutOverlaps, isTimed } from '../lib/calendarLayout.js'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const LABEL_W = 46
const MIN_PX = 22

const nowHours = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 }
const hourLabel = h => h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`

/**
 * One day as a time column, so an event's length is visible at a glance.
 * Scrolls to an hour before now on today (everything earlier is faded),
 * otherwise to just before the first event.
 */
export default function DaySchedule({ dateStr, events, isToday, isPast, onEventClick, onSlotClick, hourHeight = 52, style }) {
  const scrollRef = useRef(null)
  const [now, setNow] = useState(nowHours)

  useEffect(() => {
    if (!isToday) return
    const id = setInterval(() => setNow(nowHours()), 60_000)
    return () => clearInterval(id)
  }, [isToday])

  const allDay = events.filter(ev => ev.isAllDay)
  const timed = events.filter(isTimed)
  const layout = layoutOverlaps(timed, MIN_PX / hourHeight)

  // Initial position per day shown — not on every minute tick.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const first = timed.length ? Math.min(...timed.map(e => e.start)) : 8
    const target = isToday ? nowHours() - 1 : Math.min(first, 8) - 0.5
    el.scrollTop = Math.max(0, target) * hourHeight
  }, [dateStr]) // eslint-disable-line

  const fadeTo = isPast ? 24 : isToday ? now : 0

  const handleColClick = (e) => {
    if (!onSlotClick || e.target.closest('[data-event]')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const h = Math.floor(((e.clientY - rect.top) / hourHeight) * 2) / 2
    onSlotClick(Math.min(Math.max(h, 0), 23))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      {allDay.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: `0 0 8px ${LABEL_W}px`, flex: 'none' }}>
          {allDay.map(ev => (
            <div key={ev.id} onClick={() => onEventClick?.(ev)}
              style={{ padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: ev.tint, color: ev.color, cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ev.title}
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', position: 'relative', paddingTop: 8 }}>
          {/* Hour labels */}
          <div style={{ width: LABEL_W, flex: 'none' }}>
            {HOURS.map(h => (
              <div key={h} style={{ height: hourHeight, position: 'relative', opacity: h + 1 <= fadeTo ? 0.45 : 1 }}>
                <span style={{ position: 'absolute', top: -7, right: 8, fontSize: 10.5, color: 'var(--faint)' }}>{h === 0 ? '' : hourLabel(h)}</span>
              </div>
            ))}
          </div>

          {/* Event column */}
          <div onClick={handleColClick} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--bd-xs)', cursor: onSlotClick ? 'pointer' : 'default' }}>
            {HOURS.map(h => <div key={h} style={{ height: hourHeight, borderTop: '1px solid var(--bd-2xs)' }} />)}

            {timed.map((ev, i) => {
              const top = ev.start * hourHeight
              const height = Math.max(ev.dur * hourHeight - 3, MIN_PX)
              const { left, width } = layout.get(ev)
              const isSleep = ev.isBedtime
              return (
                <div key={`${ev.id || i}`} data-event="true"
                  onClick={() => onEventClick?.(ev)}
                  style={{
                    position: 'absolute', top, height,
                    left: `calc(${left * 100}% + 4px)`,
                    width: `calc(${width * 100}% - ${left + width >= 1 ? 8 : 6}px)`,
                    background: ev.tint, borderLeft: `3px solid ${ev.color}`,
                    borderRadius: 8, padding: '4px 8px', overflow: 'hidden', cursor: 'pointer',
                    boxShadow: left > 0 ? '0 0 0 1px var(--surface)' : 'none',
                    opacity: isSleep ? 0.75 : 1, zIndex: 1,
                  }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, color: ev.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: height < 40 ? 'nowrap' : 'normal', display: height < 40 ? 'block' : '-webkit-box', WebkitLineClamp: Math.max(1, Math.floor((height - 18) / 16)), WebkitBoxOrient: 'vertical' }}>
                    {isSleep ? '🌙 ' : ''}{ev.title}
                  </div>
                  {height >= 40 && <div style={{ fontSize: 11, color: ev.color, opacity: .8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.time || ev.timeDisplay}</div>}
                </div>
              )
            })}

            {/* Faded past */}
            {fadeTo > 0 && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: fadeTo * hourHeight, background: 'var(--surface)', opacity: 0.55, pointerEvents: 'none', zIndex: 2 }} />
            )}

            {/* Now line */}
            {isToday && (
              <div style={{ position: 'absolute', left: -4, right: 0, top: now * hourHeight - 1, height: 2, background: '#c15f3c', zIndex: 3, pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', left: 0, top: -3, width: 8, height: 8, borderRadius: '50%', background: '#c15f3c' }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
