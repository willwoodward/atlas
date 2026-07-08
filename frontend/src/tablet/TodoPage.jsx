import CheckMark from '../components/CheckMark.jsx'
import { todoGroups } from '../data.js'

export default function TabletTodoPage() {
  return (
    <div style={{ padding: '14px 44px 30px' }}>
      <h1 style={{ margin: '0 0 20px', fontFamily: "'Newsreader', serif", fontSize: 32, fontWeight: 500 }}>To-do</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 40, alignItems: 'start' }}>
        {todoGroups.map((grp) => (
          <div key={grp.title}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, paddingBottom: 10, borderBottom: '1px solid rgba(43,40,32,.14)' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: grp.color }} />
              <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }}>{grp.title}</h2>
              <span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#9a9488' }}>{grp.count}</span>
            </div>
            {grp.items.length === 0 && <div style={{ padding: '16px 0', fontSize: 13, color: '#b2ab9d', textAlign: 'center' }}>Nothing here</div>}
            {grp.items.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderTop: '1px solid rgba(43,40,32,.06)' }}>
                <span style={{ width: 20, height: 20, flex: 'none', marginTop: 1, borderRadius: 6, border: `1.7px solid ${t.done ? '#6f8168' : '#c9c2b3'}`, background: t.done ? '#6f8168' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {t.done && <CheckMark size={12} />}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: t.done ? '#b2ab9d' : '#2b2820', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</div>
                  <div style={{ marginTop: 3, display: 'inline-flex', fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: '#f2ede4', color: '#9a9488' }}>{t.tag}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
