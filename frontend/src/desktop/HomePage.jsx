import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import CheckMark from '../components/CheckMark.jsx'
import DaySchedule from '../components/DaySchedule.jsx'
import { EventDetailModal } from './CalendarPage.jsx'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useLocalCalendar } from '../context/LocalCalendarContext.jsx'
import { useHabits, HABIT_PERIODS } from '../context/HabitsContext.jsx'
import { useGoals } from '../context/GoalsContext.jsx'
import { useTodos } from '../context/TodosContext.jsx'
import { useFinances } from '../context/FinancesContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { getWeekRange } from '../integrations/googleCalendar.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { useCalendarEvents } from '../hooks/useCalendarEvents.js'
import { currentWeekTodos, staysInBucket } from '../lib/week.js'
import { goalTime, goalWeeks, fmtHours } from '../lib/goalTime.js'


function getCurrentPeriod() {
  const h = new Date().getHours()
  if (h < 12) return HABIT_PERIODS[0]
  if (h < 18) return HABIT_PERIODS[1]
  return HABIT_PERIODS[2]
}

function getCurrentQ() {
  return `Q${Math.ceil((new Date().getMonth() + 1) / 3)}`
}

function HabitsWidget() {
  const { habits, today, toggleCompletion } = useHabits()
  const period = getCurrentPeriod()
  const periodHabits = habits.filter(h => h.color === period.color)
  const doneCount = periodHabits.filter(h => h.todayDone).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 11, borderBottom: '1px solid var(--bd-xl)' }}>
        <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: period.color, display: 'inline-block', flexShrink: 0 }} />
          {period.label} Habits
        </h2>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {periodHabits.length === 0 ? '—' : `${doneCount} / ${periodHabits.length}`}
        </span>
      </div>
      {periodHabits.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--faint)' }}>No {period.label.toLowerCase()} habits yet.</div>
      )}
      {periodHabits.map(h => (
        <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: '1px solid var(--bd-sm)' }}>
          <button
            onClick={() => toggleCompletion(h.id, today)}
            style={{ width: 18, height: 18, flex: 'none', borderRadius: 6,
              border: `1.6px solid ${h.todayDone ? period.color : '#c9c2b3'}`,
              background: h.todayDone ? period.color : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', padding: 0, transition: 'all .12s' }}
          >
            {h.todayDone && <CheckMark size={10} />}
          </button>
          <span style={{ fontSize: 13.5, color: h.todayDone ? 'var(--faint)' : 'var(--ink)', textDecoration: h.todayDone ? 'line-through' : 'none', transition: 'color .12s' }}>
            {h.name}
          </span>
        </div>
      ))}
    </div>
  )
}

function GoalsWidget({ goals }) {
  const currentQ = getCurrentQ()
  if (goals.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--faint)' }}>No goals yet.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {goals.map(g => {
        const note = g.quarters[currentQ]
        return (
          <div key={g.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: note ? 4 : 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{g.title}</span>
            </div>
            {note && (
              <div style={{ paddingLeft: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>{note}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TodosWidget({ todos, onToggle }) {
  const todayTodos = todos.filter(t => t.bucket === 'today' && !t.parentId && staysInBucket(t))
  const weekTodos  = todos.filter(t => t.bucket === 'week'  && !t.parentId && staysInBucket(t))

  if (todayTodos.length === 0 && weekTodos.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--faint)' }}>Nothing scheduled.</div>
  }

  const renderTodo = (t, color) => (
    <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 0', borderTop: '1px solid var(--bd-sm)' }}>
      <button onClick={() => onToggle(t.id)}
        style={{ width: 17, height: 17, flex: 'none', marginTop: 1, borderRadius: 5,
          border: `1.6px solid ${t.done ? color : '#c9c2b3'}`,
          background: t.done ? color : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 0, transition: 'all .12s' }}>
        {t.done && <CheckMark size={9} />}
      </button>
      <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.4, color: t.done ? 'var(--faint)' : 'var(--ink)', textDecoration: t.done ? 'line-through' : 'none', transition: 'color .12s' }}>{t.text}</span>
    </div>
  )

  return (
    <div>
      {todayTodos.length > 0 && (
        <div style={{ marginBottom: weekTodos.length > 0 ? 12 : 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>Today</div>
          {todayTodos.map(t => renderTodo(t, 'var(--muted)'))}
        </div>
      )}
      {weekTodos.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>This week</div>
          {weekTodos.map(t => renderTodo(t, 'var(--muted)'))}
        </div>
      )}
    </div>
  )
}

// Completions per day over the last 7 days, out of the habits that existed then.
function HabitsHistory({ habits, last30 }) {
  const days = last30.slice(-7).map((date, i) => {
    const idx = 23 + i
    const existing = habits.filter(h => (h.createdAt || '').slice(0, 10) <= date)
    const done = existing.filter(h => h.history[idx]).length
    return { date, done, total: existing.length }
  })
  const max = Math.max(1, ...days.map(d => d.total))
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 12 }}>Habits · last 7 days</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 110 }}>
        {days.map((d, i) => {
          const full = d.total > 0 && d.done === d.total
          const isToday = i === days.length - 1
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{d.total ? `${d.done}/${d.total}` : '—'}</span>
              <div style={{ width: '100%', maxWidth: 36, height: `${(d.total / max) * 70}%`, minHeight: 4, background: 'var(--surface-3)', borderRadius: 6, display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
                <div style={{ width: '100%', height: d.total ? `${(d.done / d.total) * 100}%` : 0, background: full ? '#6f8168' : '#9a9488', opacity: isToday && !full ? 0.7 : 1, transition: 'height .3s' }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--ink)' : 'var(--faint)' }}>
                {new Date(d.date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GoalTimeBreakdown({ data }) {
  if (!data.hasTags) {
    return (
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
        Add <strong>calendar tags</strong> to your goals on the Goals page (e.g. <em>gym, swim</em>). Calendar events
        whose titles contain a tag count as time towards that goal.
      </div>
    )
  }
  const rows = data.perGoal.filter(r => r.planned > 0 || r.goal.tags)
  const max = Math.max(1, ...rows.map(r => r.planned))
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 12 }}>Goal time · this week</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {rows.map(({ goal, spent, planned }) => (
          <div key={goal.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: goal.color }} />{goal.title}
              </span>
              <span style={{ color: 'var(--muted)' }}>{fmtHours(spent)}{planned > spent ? ` of ${fmtHours(planned)}` : ''}</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${(planned / max) * 100}%`, background: goal.color, opacity: 0.25 }} />
              <div style={{ position: 'absolute', inset: 0, width: `${(spent / max) * 100}%`, background: goal.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const shortDate = key => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Goal time per week as stacked bars, one colour per goal. This week shows
// what's done solid and what's still planned faint, like the bars above.
function GoalTimeHistory({ weeks, loading, isMobile }) {
  const [hover, setHover] = useState(null)
  // Goals in a fixed order (their order on the Goals page), so a goal keeps its
  // place in the stack from week to week.
  const goalsSeen = weeks[0]?.perGoal.map(p => p.goal)
    .filter(g => weeks.some(w => w.perGoal.some(p => p.goal.id === g.id && p.planned > 0))) || []
  const past = weeks.filter(w => !w.current)
  const avg = past.length ? past.reduce((s, w) => s + w.spent, 0) / past.length : 0
  const top = Math.max(1, ...weeks.map(w => w.planned))
  // Round the scale up to a tidy number of hours for the gridlines.
  const step = top <= 4 ? 1 : top <= 10 ? 2 : top <= 25 ? 5 : 10
  const max = Math.ceil(top / step) * step
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step)
  const H = 130
  const every = isMobile ? 3 : 2
  const tip = hover != null ? weeks[hover] : null

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>
          Last {weeks.length} weeks
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {loading ? 'Loading past weeks…' : `${fmtHours(avg)} a week on average`}
        </div>
      </div>

      <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
        {/* Hour scale */}
        <div style={{ position: 'relative', width: 22, height: H, flex: 'none' }}>
          {ticks.map(t => (
            <span key={t} style={{ position: 'absolute', right: 0, bottom: (t / max) * H - 6, fontSize: 10, color: 'var(--faint)' }}>{t}h</span>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <div onMouseLeave={() => setHover(null)} style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: isMobile ? 4 : 8, height: H }}>
            {ticks.map(t => (
              <div key={t} style={{ position: 'absolute', left: 0, right: 0, bottom: (t / max) * H, borderTop: `1px ${t === 0 ? 'solid' : 'dashed'} var(--bd-${t === 0 ? 'xl' : 'md'})`, pointerEvents: 'none' }} />
            ))}
            {weeks.map((w, i) => {
              const segs = goalsSeen.map(g => w.perGoal.find(p => p.goal.id === g.id)).filter(p => p && p.planned > 0)
              const active = hover === i
              return (
                <div key={w.week} role="button" tabIndex={0} aria-label={`Week of ${shortDate(w.week)}: ${fmtHours(w.spent)}`}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(h => h === i ? null : i)}
                  style={{ position: 'relative', flex: 1, height: '100%', display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', cursor: 'pointer', outline: 'none' }}>
                  <div style={{ width: '100%', maxWidth: 30, display: 'flex', flexDirection: 'column-reverse', gap: 2, opacity: hover == null || active ? 1 : 0.45, transition: 'opacity .12s' }}>
                    {segs.map((p, k) => {
                      const last = k === segs.length - 1
                      const r = last ? '4px 4px 0 0' : 0
                      return (
                        <div key={p.goal.id} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 0 }}>
                          {p.spent > 0 && <div style={{ height: (p.spent / max) * H, background: p.goal.color, borderRadius: p.planned > p.spent ? 0 : r }} />}
                          {p.planned > p.spent && <div style={{ height: ((p.planned - p.spent) / max) * H, background: p.goal.color, opacity: 0.28, borderRadius: r }} />}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          {/* Week labels */}
          <div style={{ display: 'flex', gap: isMobile ? 4 : 8, marginTop: 6 }}>
            {weeks.map((w, i) => (
              <span key={w.week} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'visible',
                color: w.current ? 'var(--ink)' : 'var(--faint)', fontWeight: w.current ? 700 : 500 }}>
                {w.current ? 'Now' : (weeks.length - 1 - i) % every === 0 ? shortDate(w.week) : ''}
              </span>
            ))}
          </div>

          {tip && (
            <div style={{ position: 'absolute', bottom: H + 8, left: `${((hover + 0.5) / weeks.length) * 100}%`,
              transform: `translateX(${hover < weeks.length / 3 ? '-15%' : hover > (weeks.length * 2) / 3 ? '-85%' : '-50%'})`,
              background: 'var(--surface)', border: '1px solid var(--bd-lg)', borderRadius: 10, boxShadow: '0 6px 20px var(--bd-md)',
              padding: '9px 11px', minWidth: 150, zIndex: 2, pointerEvents: 'none' }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 }}>
                {tip.current ? 'This week' : `Week of ${shortDate(tip.week)}`}
              </div>
              <div style={{ fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}>
                {fmtHours(tip.spent)}{tip.planned > tip.spent ? <span style={{ fontSize: 12.5, color: 'var(--muted)', fontFamily: 'inherit' }}> of {fmtHours(tip.planned)} planned</span> : null}
              </div>
              {tip.perGoal.filter(p => p.planned > 0).map(p => (
                <div key={p.goal.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mid)', lineHeight: 1.6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.goal.color, flex: 'none' }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.goal.title}</span>
                  <span style={{ color: 'var(--ink)' }}>{fmtHours(tip.current ? p.spent : p.planned)}</span>
                </div>
              ))}
              {tip.planned === 0 && <div style={{ fontSize: 12, color: 'var(--faint)' }}>No goal time</div>}
            </div>
          )}
        </div>
      </div>

      {goalsSeen.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 12, paddingLeft: 30 }}>
          {goalsSeen.map(g => (
            <span key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mid)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} />{g.title}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  const isMobile = useIsMobile()
  const { user } = useAuth()
  const { gcal, refetchEvents, loadWeeks, connectGoogle, removeGcalEvent } = useIntegrations()
  const { removeEvent } = useLocalCalendar()
  const { habits, last30 } = useHabits()
  const { goals } = useGoals()
  const { todos, toggleTodo } = useTodos()
  const { netWorth, accounts, fmt: fmtMoney } = useFinances()
  const allEvents = useCalendarEvents()
  const [openStat, setOpenStat] = useState(null)
  const { weekStart, weekEnd, todayStr } = getWeekRange()
  const showSchedule = gcal.connected || allEvents.some(ev => ev.date === todayStr && !ev.isAllDay)
  // Desktop: the day column runs from where it starts to just above the
  // bottom of the window (400–760px), re-measured on resize.
  const scheduleRef = useRef(null)
  const [scheduleH, setScheduleH] = useState(520)
  useLayoutEffect(() => {
    if (isMobile) return
    const measure = () => {
      const el = scheduleRef.current
      if (!el) return
      // Position within the page, not the viewport, so a scrolled page doesn't shrink it.
      let sc = el.parentElement
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      const top = el.getBoundingClientRect().top + (sc?.scrollTop || 0)
      setScheduleH(Math.round(Math.min(760, Math.max(400, window.innerHeight - top - 24))))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [isMobile, showSchedule, openStat])
  const [selectedEvent, setSelectedEvent] = useState(null)

  useEffect(() => {
    if (gcal.connected) refetchEvents(weekStart, weekEnd)
  }, [gcal.connected]) // eslint-disable-line

  // Today's timed events sorted
  const todayEvents = allEvents
    .filter(ev => ev.date === todayStr && !ev.isAllDay && !(ev.isBedtime && ev.start < 12))
    .sort((a, b) => a.start - b.start)

  const doneToday   = habits.filter(h => h.todayDone).length
  const totalHabits = habits.length
  const allDone     = totalHabits > 0 && doneToday === totalHabits

  const weekTodos  = currentWeekTodos(todos)
  const todosTotal = weekTodos.length
  const todosDone  = weekTodos.filter(t => t.done).length
  const todosLeft  = todosTotal - todosDone

  const gt = goalTime(allEvents, goals)

  // Past weeks for the goal-time history, fetched when the panel first opens.
  const HISTORY_WEEKS = 12
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyAsked = useRef(false)
  useEffect(() => {
    if (openStat !== 'goal' || historyAsked.current || !gcal.connected || !gt.hasTags) return
    historyAsked.current = true
    setHistoryLoading(true)
    loadWeeks(Array.from({ length: HISTORY_WEEKS - 1 }, (_, i) => getWeekRange(-(i + 1))))
      .finally(() => setHistoryLoading(false))
  }, [openStat, gcal.connected, gt.hasTags]) // eslint-disable-line
  const history = openStat === 'goal' && gt.hasTags ? goalWeeks(allEvents, goals, HISTORY_WEEKS) : null

  const liveStats = [
    {
      key: 'goal', label: 'Goal time', expandable: true,
      value: gt.hasTags ? fmtHours(gt.spent) : '—',
      sub: !gt.hasTags ? 'tap to set up' : gt.planned > gt.spent ? `of ${fmtHours(gt.planned)}${isMobile ? '' : ' this week'}` : 'this week',
      tone: '#9a9488',
    },
    {
      key: 'habits', label: 'Habits', expandable: true,
      value: totalHabits === 0 ? '—' : `${doneToday} / ${totalHabits}`,
      sub: totalHabits === 0 ? '' : allDone ? 'all done today' : 'done today',
      tone: allDone ? '#6f8168' : '#9a9488',
    },
    {
      key: 'todos', label: 'To-dos',
      value: todosTotal === 0 ? '—' : `${todosDone} / ${todosTotal}`,
      sub: todosTotal === 0 ? '' : todosLeft === 0 ? 'week cleared' : isMobile ? 'this week' : 'done this week',
      tone: todosTotal > 0 && todosLeft === 0 ? '#6f8168' : '#9a9488',
    },
    {
      key: 'net', label: 'Net worth',
      value: accounts.length === 0 ? '—' : fmtMoney(netWorth, 0),
      sub: accounts.length === 0 ? '' : `${accounts.length} account${accounts.length !== 1 ? 's' : ''}`,
      tone: '#9a9488',
    },
  ]

  const name = user?.name ? `, ${user.name.split(' ')[0]}` : ''

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      <div style={{ marginBottom: 26 }}>
        <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 28 : 38, fontWeight: 500, letterSpacing: '-.01em' }}>{greeting}{name}.</h1>
        <p style={{ margin: '8px 0 0', fontSize: isMobile ? 13.5 : 15, color: 'var(--mid)' }}>Your day is ready when you are.</p>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'flex', marginBottom: openStat ? 0 : 38, borderTop: '1px solid var(--bd-md)', borderBottom: '1px solid var(--bd-md)' }}>
        {liveStats.map((s, i) => (
          <div key={s.key}
            onClick={s.expandable ? () => setOpenStat(o => o === s.key ? null : s.key) : undefined}
            style={{ flex: 1, minWidth: 0, padding: isMobile ? '10px 8px 12px' : '14px 22px 16px', borderLeft: i > 0 ? '1px solid var(--bd-md)' : 'none',
              cursor: s.expandable ? 'pointer' : 'default', background: openStat === s.key ? 'var(--surface)' : 'transparent', transition: 'background .12s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: isMobile ? 9.5 : 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', whiteSpace: 'nowrap' }}>
              {s.label}
              {s.expandable && (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                  style={{ flex: 'none', transform: openStat === s.key ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6"/></svg>
              )}
            </div>
            <div style={{ marginTop: 7, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 20 : 28, fontWeight: 500 }}>{s.value}</div>
            <div style={{ marginTop: 2, fontSize: isMobile ? 11 : 12, color: s.tone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {openStat && (
        <div style={{ marginBottom: 38, padding: isMobile ? '16px 4px' : '18px 22px', borderBottom: '1px solid var(--bd-md)' }}>
          {openStat === 'habits' && <HabitsHistory habits={habits} last30={last30} />}
          {openStat === 'goal' && <GoalTimeBreakdown data={gt} />}
          {history && <GoalTimeHistory weeks={history} loading={historyLoading} isMobile={isMobile} />}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.35fr 1fr', gap: isMobile ? 32 : 52, alignItems: 'start' }}>

        {/* Schedule from Google Calendar */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 11, borderBottom: '1px solid var(--bd-xl)' }}>
            <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 600 }}>Today's schedule</h2>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{todayEvents.length > 0 ? `${todayEvents.length} events` : gcal.connected ? 'No events' : '—'}</span>
          </div>

          {!gcal.connected && (
            <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>Connect Google Calendar to see your schedule here.</div>
              <button onClick={connectGoogle} style={{ fontSize: 13, fontWeight: 600, color: '#5f7591', background: 'rgba(95,117,145,.1)', border: '1px solid rgba(95,117,145,.25)', padding: '7px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
                Connect Google Calendar
              </button>
            </div>
          )}

          {gcal.loading && todayEvents.length === 0 && <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--faint)' }}>Loading events…</div>}

          {/* Today as a time column, the same view on desktop and mobile. On
              desktop it matches the Calendar page's scale and takes the
              viewport's height, so it sits level with the column beside it. */}
          {showSchedule && (
            <div ref={scheduleRef}>
            <DaySchedule
              dateStr={todayStr}
              events={allEvents.filter(ev => ev.date === todayStr)}
              isToday
              onEventClick={setSelectedEvent}
              hourHeight={isMobile ? 56 : 64}
              style={{ height: isMobile ? 380 : scheduleH }}
            />
            </div>
          )}
        </div>

        {/* Habits + Todos + Goals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
          <HabitsWidget />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 11, borderBottom: '1px solid var(--bd-xl)' }}>
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 600 }}>To-do</h2>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{todosLeft > 0 ? `${todosLeft} left` : '—'}</span>
            </div>
            <TodosWidget todos={todos} onToggle={toggleTodo} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 11, borderBottom: '1px solid var(--bd-xl)' }}>
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 600 }}>Goals</h2>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{goals.length > 0 ? `${goals.length} active` : '—'}</span>
            </div>
            <GoalsWidget goals={goals} />
          </div>
        </div>
      </div>
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)}
          onDelete={ev => ev.isLocal ? removeEvent(ev.id) : removeGcalEvent(ev.id)} />
      )}
    </div>
  )
}
