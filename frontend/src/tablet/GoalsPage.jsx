import GoalRing from '../components/GoalRing.jsx'
import { goalsFull } from '../data.js'

export default function TabletGoalsPage() {
  return (
    <div style={{ padding: '14px 44px 30px' }}>
      <h1 style={{ margin: '0 0 20px', fontFamily: "'Newsreader', serif", fontSize: 32, fontWeight: 500 }}>Goals</h1>

      {goalsFull.length === 0 ? (
        <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 14, color: '#b2ab9d' }}>No goals set yet</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {goalsFull.map((g, i) => (
            <div key={i} style={{ background: '#fffdf9', border: '1px solid rgba(43,40,32,.09)', borderRadius: 18, padding: 22, display: 'flex', gap: 20, alignItems: 'center' }}>
              <GoalRing pct={g.pct} color={g.color} size={84} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: g.color }}>{g.cat}</div>
                <h3 style={{ margin: '5px 0 6px', fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }}>{g.title}</h3>
                <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6b665a', lineHeight: 1.5 }}>{g.note}</p>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#9a9488' }}>
                  <span><strong style={{ color: '#2b2820', fontWeight: 600 }}>{g.metric}</strong> {g.metricLabel}</span>
                  <span>Due {g.due}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
