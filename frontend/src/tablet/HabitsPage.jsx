import CheckMark from '../components/CheckMark.jsx'
import { useHabits } from '../context/HabitsContext.jsx'

export default function TabletHabitsPage() {
  const { habits, weekDates, toggleCompletion } = useHabits()

  return (
    <div style={{ padding: '14px 44px 30px' }}>
      <h1 style={{ margin: '0 0 4px', fontFamily: "'Newsreader', serif", fontSize: 32, fontWeight: 500 }}>Habits</h1>
      <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--mid)' }}>This week · consistency builds the compound.</p>

      {habits.length === 0 && (
        <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 14, color: 'var(--faint)' }}>No habits yet — add them on desktop.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 44px' }}>
        {habits.map(h => (
          <div key={h.id} style={{ padding: '14px 0', borderTop: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: h.color }} />
              <span style={{ flex: 1, fontSize: 15.5, fontWeight: 500 }}>{h.name}</span>
              <span style={{ fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600, color: h.color }}>
                {h.streak}<span style={{ fontSize: 11, fontFamily: "'Hanken Grotesk'", color: 'var(--muted)', fontWeight: 500 }}> d</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {h.week.map((done, i) => (
                <span
                  key={i}
                  onClick={() => toggleCompletion(h.id, weekDates[i])}
                  style={{ flex: 1, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? h.color : 'var(--surface-3)', cursor: 'pointer', transition: 'background .12s' }}
                >
                  {done && <CheckMark size={13} />}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
