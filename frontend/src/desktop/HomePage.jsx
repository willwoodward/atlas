import { useEffect, useState } from 'react'
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
import { goalTime, fmtHours } from '../lib/goalTime.js'


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

export default function HomePage() {
  const isMobile = useIsMobile()
  const { user } = useAuth()
  const { gcal, refetchEvents, connectGoogle, removeGcalEvent } = useIntegrations()
  const { removeEvent } = useLocalCalendar()
  const { habits, last30 } = useHabits()
  const { goals } = useGoals()
  const { todos, toggleTodo } = useTodos()
  const { netWorth, accounts, fmt: fmtMoney } = useFinances()
  const allEvents = useCalendarEvents()
  const [openStat, setOpenStat] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const { weekStart, weekEnd, todayStr } = getWeekRange()

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

          {isMobile && (gcal.connected || todayEvents.length > 0) && (
            <DaySchedule
              dateStr={todayStr}
              events={allEvents.filter(ev => ev.date === todayStr)}
              isToday
              onEventClick={setSelectedEvent}
              hourHeight={56}
              style={{ height: 380 }}
            />
          )}

          {!isMobile && gcal.connected && !gcal.loading && todayEvents.length === 0 && (
            <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--faint)' }}>No events today.</div>
          )}

          {!isMobile && todayEvents.map((ev, i) => {
            const isSleep = ev.isBedtime || ev.isSleepWakeUp
            return (
              <div key={ev.id || i} style={{ display: 'flex', gap: 16, padding: '12px 0', borderTop: '1px solid var(--bd-sm)', opacity: isSleep ? 0.75 : 1 }}>
                <div style={{ width: 56, flex: 'none', textAlign: 'right', paddingTop: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{ev.timeDisplay}</div>
                  {!isSleep && (
                    <div style={{ fontSize: 11, color: 'var(--faint)' }}>{ev.endTimeDisplay}</div>
                  )}
                </div>
                <div style={{ width: 3, flex: 'none', borderRadius: 99, background: isSleep ? '#9a9488' : ev.color }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 500, color: isSleep ? 'var(--mid)' : 'var(--ink)' }}>
                    {ev.isSleepWakeUp ? '🌅 Wake up' : ev.isBedtime ? '🌙 ' + ev.title : ev.title}
                  </div>
                </div>
              </div>
            )
          })}
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
