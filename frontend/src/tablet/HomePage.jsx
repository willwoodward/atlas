import CheckMark from '../components/CheckMark.jsx'
import { stats, schedule, goals, todos, user } from '../data.js'

function Tag({ color, tint, children }) {
  return <div style={{ marginTop: 3, display: 'inline-flex', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: tint, color }}>{children}</div>
}

export default function TabletHomePage() {
  const name = user.name !== '—' ? `, ${user.name}` : ''
  return (
    <div style={{ padding: '14px 44px 30px' }}>
      <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 32, fontWeight: 500 }}>Good morning{name}.</h1>
      <p style={{ margin: '7px 0 20px', fontSize: 15, color: '#6b665a' }}>Your day is ready when you are.</p>

      {/* Stats 4-col */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 26 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: '#fffdf9', border: '1px solid rgba(43,40,32,.09)', borderRadius: 16, padding: '15px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#b2ab9d' }}>{s.label}</div>
            <div style={{ marginTop: 5, fontFamily: "'Newsreader', serif", fontSize: 25, fontWeight: 500 }}>{s.value}</div>
            <div style={{ marginTop: 2, fontSize: 12, color: s.tone }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* 2-col body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 44, alignItems: 'start' }}>
        {/* Schedule */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(43,40,32,.14)' }}>
            <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 20, fontWeight: 600 }}>Today's schedule</h2>
            <span style={{ fontSize: 12.5, color: '#9a9488' }}>{schedule.length > 0 ? `${schedule.length} blocks` : '—'}</span>
          </div>
          {schedule.length === 0 && <div style={{ padding: '20px 0', fontSize: 13, color: '#b2ab9d', textAlign: 'center' }}>No blocks</div>}
          {schedule.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 15, padding: '11px 0', borderTop: '1px solid rgba(43,40,32,.07)' }}>
              <div style={{ width: 52, flex: 'none', textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{b.time}</div>
                <div style={{ fontSize: 11, color: '#b2ab9d' }}>{b.dur}</div>
              </div>
              <div style={{ width: 3, flex: 'none', borderRadius: 99, background: b.color }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500 }}>{b.title}</div>
                <Tag color={b.color} tint={b.tint}>{b.tag}</Tag>
              </div>
            </div>
          ))}
        </div>

        {/* Goals + Todos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
          <div>
            <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(43,40,32,.14)' }}>
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 20, fontWeight: 600 }}>Goals</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {goals.length === 0 && <div style={{ fontSize: 13, color: '#b2ab9d' }}>No goals yet</div>}
              {goals.map((g, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{g.title}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: g.color }}>{g.pct > 0 ? `${g.pct}%` : '—'}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 99, background: '#ece7dc', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: g.color, width: `${g.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ marginBottom: 8, paddingBottom: 10, borderBottom: '1px solid rgba(43,40,32,.14)' }}>
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 20, fontWeight: 600 }}>To-do</h2>
            </div>
            {todos.length === 0 && <div style={{ fontSize: 13, color: '#b2ab9d' }}>No todos yet</div>}
            {todos.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid rgba(43,40,32,.07)' }}>
                <span style={{ width: 20, height: 20, flex: 'none', borderRadius: 6, border: `1.7px solid ${t.done ? '#6f8168' : '#c9c2b3'}`, background: t.done ? '#6f8168' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {t.done && <CheckMark size={12} />}
                </span>
                <span style={{ flex: 1, fontSize: 14, color: t.done ? '#b2ab9d' : '#2b2820', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: '#f2ede4', color: '#9a9488' }}>{t.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
