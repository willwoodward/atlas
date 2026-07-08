import { useEffect } from 'react'
import CheckMark from '../components/CheckMark.jsx'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useHabits, HABIT_PERIODS } from '../context/HabitsContext.jsx'
import { getWeekRange } from '../integrations/googleCalendar.js'
import { stats, goals, todos, user } from '../data.js'

function getCurrentPeriod() {
  const h = new Date().getHours()
  if (h < 12) return HABIT_PERIODS[0]
  if (h < 18) return HABIT_PERIODS[1]
  return HABIT_PERIODS[2]
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
          {period.label}
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

function GoalBar({ g }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{g.title}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: g.color }}>{g.pct > 0 ? `${g.pct}%` : '—'}</span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 99, background: g.color, width: `${g.pct}%` }} />
      </div>
      {g.note && <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted)' }}>{g.note}</div>}
    </div>
  )
}

function TodoItem({ t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: '1px solid var(--bd-sm)' }}>
      <span style={{ width: 17, height: 17, flex: 'none', borderRadius: 6, border: `1.6px solid ${t.done ? '#6f8168' : '#c9c2b3'}`, background: t.done ? '#6f8168' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {t.done && <CheckMark size={11} />}
      </span>
      <span style={{ flex: 1, fontSize: 13.5, color: t.done ? 'var(--faint)' : 'var(--ink)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
      <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'var(--surface-3)', color: 'var(--muted)' }}>{t.tag}</span>
    </div>
  )
}

export default function HomePage() {
  const { gcal, refetchEvents, connectGoogle } = useIntegrations()
  const { habits } = useHabits()
  const { weekStart, weekEnd, todayStr } = getWeekRange()

  useEffect(() => {
    if (gcal.connected) refetchEvents(weekStart, weekEnd)
  }, [gcal.connected]) // eslint-disable-line

  const todayEvents = gcal.events
    .filter(ev => ev.date === todayStr)
    .sort((a, b) => a.start - b.start)

  const doneToday = habits.filter(h => h.todayDone).length
  const totalHabits = habits.length
  const allDone = totalHabits > 0 && doneToday === totalHabits
  const bestStreak = habits.reduce((best, h) => Math.max(best, h.streak), 0)

  const liveStats = stats.map(s => s.label !== 'Habits' ? s : {
    ...s,
    value: totalHabits === 0 ? '—' : `${doneToday} / ${totalHabits}`,
    sub:   totalHabits === 0 ? '' : allDone ? 'all done today' : bestStreak > 0 ? `${bestStreak}d streak` : 'done today',
    tone:  allDone ? '#6f8168' : '#9a9488',
  })

  const name = user.name !== '—' ? `, ${user.name}` : ''

  return (
    <div>
      <div style={{ marginBottom: 26 }}>
        <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 38, fontWeight: 500, letterSpacing: '-.01em' }}>Good morning{name}.</h1>
        <p style={{ margin: '8px 0 0', fontSize: 15, color: 'var(--mid)' }}>Your day is ready when you are.</p>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'flex', marginBottom: 38, borderTop: '1px solid var(--bd-md)', borderBottom: '1px solid var(--bd-md)' }}>
        {liveStats.map((s, i) => (
          <div key={s.label} style={{ flex: 1, padding: '14px 22px 16px', borderLeft: i > 0 ? '1px solid var(--bd-md)' : 'none' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>{s.label}</div>
            <div style={{ marginTop: 7, fontFamily: "'Newsreader', serif", fontSize: 28, fontWeight: 500 }}>{s.value}</div>
            <div style={{ marginTop: 2, fontSize: 12, color: s.tone }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 52, alignItems: 'start' }}>

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

          {gcal.loading && <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--faint)' }}>Loading events…</div>}

          {gcal.connected && !gcal.loading && todayEvents.length === 0 && (
            <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--faint)' }}>No events today.</div>
          )}

          {todayEvents.map((ev, i) => (
            <div key={ev.id || i} style={{ display: 'flex', gap: 16, padding: '12px 0', borderTop: '1px solid var(--bd-sm)' }}>
              <div style={{ width: 56, flex: 'none', textAlign: 'right', paddingTop: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{ev.timeDisplay}</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>{ev.durDisplay}</div>
              </div>
              <div style={{ width: 3, flex: 'none', borderRadius: 99, background: ev.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500 }}>{ev.title}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Habits + Goals + Todos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
          <HabitsWidget />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 11, borderBottom: '1px solid var(--bd-xl)' }}>
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 600 }}>Goals</h2>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{goals.length > 0 ? `${goals.length} active` : '—'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              {goals.length > 0 ? goals.map((g, i) => <GoalBar key={i} g={g} />) : <div style={{ fontSize: 13, color: 'var(--faint)' }}>No goals yet</div>}
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 11, borderBottom: '1px solid var(--bd-xl)' }}>
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 21, fontWeight: 600 }}>To-do</h2>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{todos.filter(t => !t.done).length > 0 ? `${todos.filter(t => !t.done).length} left` : '—'}</span>
            </div>
            {todos.length > 0 ? todos.map((t, i) => <TodoItem key={i} t={t} />) : <div style={{ fontSize: 13, color: 'var(--faint)' }}>No todos yet</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
