import { agendaDays } from '../data.js'

export default function TabletAgendaPage() {
  return (
    <div style={{ padding: '14px 44px 30px' }}>
      <h1 style={{ margin: '0 0 20px', fontFamily: "'Newsreader', serif", fontSize: 32, fontWeight: 500 }}>Agenda</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 44, alignItems: 'start' }}>
        {agendaDays.map((day) => (
          <div key={day.label}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6, paddingBottom: 10, borderBottom: '1px solid rgba(43,40,32,.14)' }}>
              <span style={{ fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600, color: day.accent }}>{day.label}</span>
              <span style={{ fontSize: 13, color: '#9a9488' }}>{day.date}</span>
            </div>
            {day.items.length === 0 && <div style={{ padding: '20px 0', fontSize: 13, color: '#b2ab9d', textAlign: 'center' }}>Nothing scheduled</div>}
            {day.items.map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 15, padding: '12px 0', borderTop: '1px solid rgba(43,40,32,.07)' }}>
                <div style={{ width: 82, flex: 'none', fontSize: 13, fontWeight: 600, color: '#6b665a' }}>{b.time}</div>
                <div style={{ width: 3, flex: 'none', borderRadius: 99, background: b.color }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 500 }}>{b.title}</div>
                  <div style={{ marginTop: 3, display: 'inline-flex', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: b.tint, color: b.color }}>{b.tag}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
