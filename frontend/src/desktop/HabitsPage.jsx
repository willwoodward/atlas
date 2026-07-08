import { useState } from 'react'
import CheckMark from '../components/CheckMark.jsx'
import { useHabits, HABIT_PERIODS } from '../context/HabitsContext.jsx'

const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

function AddForm({ onAdd, onCancel }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(HABIT_PERIODS[0].color)
  return (
    <form
      onSubmit={e => { e.preventDefault(); if (name.trim()) { onAdd(name.trim(), color) } }}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 0', borderTop: '1px solid var(--bd-xs)' }}
    >
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Habit name…"
        style={{ flex: 1, padding: '8px 12px', borderRadius: 9, border: '1.5px solid var(--bd-xl)', background: 'var(--surface-2)', fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
        {HABIT_PERIODS.map(p => (
          <button key={p.color} type="button" onClick={() => setColor(p.color)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8,
              border: `1.5px solid ${color === p.color ? p.color : 'transparent'}`,
              background: color === p.color ? `${p.color}18` : 'var(--surface-3)',
              color: color === p.color ? p.color : 'var(--mid)',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', transition: 'all .12s' }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
            {p.label}
          </button>
        ))}
      </div>
      <button type="submit" style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#c15f3c', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Add</button>
      <button type="button" onClick={onCancel} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
    </form>
  )
}

function DayDot({ done, color, onClick }) {
  return (
    <span onClick={onClick} style={{ width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? color : 'var(--surface-3)', cursor: 'pointer', transition: 'background .12s', flexShrink: 0 }}>
      {done && <CheckMark size={11} />}
    </span>
  )
}

export default function HabitsPage() {
  const { habits, weekDates, today, addHabit, removeHabit, toggleCompletion } = useHabits()
  const [open, setOpen] = useState({})
  const [adding, setAdding] = useState(false)

  const todayIdx = weekDates.indexOf(today)
  const visibleCount = todayIdx === -1 ? 7 : todayIdx + 1

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 34, fontWeight: 500 }}>Habits</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>This week · consistency builds the compound.</p>
        </div>
        <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 11, border: 'none', background: '#c15f3c', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add habit
        </button>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '8px 24px' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr auto 90px 70px 26px', gap: 20, padding: '14px 0 12px', borderBottom: '1px solid var(--bd-sm)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>
          <div>Habit</div>
          <div style={{ display: 'flex', gap: 9 }}>
            {DOW.map((d, i) => (
              <span key={d} style={{ width: 22, textAlign: 'center', opacity: i < visibleCount ? 1 : 0.3 }}>{d[0]}</span>
            ))}
          </div>
          <div style={{ textAlign: 'right' }}>Streak</div>
          <div style={{ textAlign: 'right' }}>30d</div>
          <div />
        </div>

        {adding && (
          <AddForm
            onAdd={(name, color) => { addHabit(name, color); setAdding(false) }}
            onCancel={() => setAdding(false)}
          />
        )}

        {habits.length === 0 && !adding && (
          <div style={{ padding: '36px 0', textAlign: 'center', fontSize: 13, color: 'var(--faint)' }}>
            No habits yet — click <strong style={{ color: 'var(--mid)' }}>Add habit</strong> to start.
          </div>
        )}

        {[...habits].sort((a, b) => {
          const ai = HABIT_PERIODS.findIndex(p => p.color === a.color)
          const bi = HABIT_PERIODS.findIndex(p => p.color === b.color)
          return ai - bi
        }).map(h => (
          <div key={h.id} style={{ borderTop: '1px solid var(--bd-xs)' }}>
            <div
              onClick={() => setOpen(p => ({ ...p, [h.id]: !p[h.id] }))}
              style={{ display: 'grid', gridTemplateColumns: '1.4fr auto 90px 70px 26px', gap: 20, alignItems: 'center', padding: '16px 0', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: h.color, flexShrink: 0 }} />
                <span style={{ fontSize: 14.5, fontWeight: 500 }}>{h.name}</span>
              </div>
              <div style={{ display: 'flex', gap: 9 }} onClick={e => e.stopPropagation()}>
                {h.week.map((done, i) => i < visibleCount
                  ? <DayDot key={i} done={done} color={h.color} onClick={() => toggleCompletion(h.id, weekDates[i])} />
                  : <span key={i} style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--surface-3)', opacity: 0.35, flexShrink: 0 }} />
                )}
              </div>
              <div style={{ textAlign: 'right', fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600, color: h.color }}>
                {h.streak}<span style={{ fontSize: 11, fontFamily: "'Hanken Grotesk'", color: 'var(--muted)', fontWeight: 500 }}> d</span>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--mid)' }}>{h.pct}%</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--faint)', transition: 'transform .2s', transform: open[h.id] ? 'rotate(90deg)' : 'none' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
              </div>
            </div>

            {open[h.id] && (
              <div style={{ padding: '2px 0 22px 21px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>Last 30 days</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{h.history.filter(Boolean).length} of 30 days</span>
                  </div>
                  <button
                    onClick={() => window.confirm(`Remove "${h.name}"?`) && removeHabit(h.id)}
                    style={{ fontSize: 12, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}
                  >Remove</button>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 560 }}>
                  {h.history.map((done, i) => (
                    <span key={i} style={{ width: 15, height: 15, borderRadius: 4, background: done ? h.color : 'var(--surface-3)' }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
