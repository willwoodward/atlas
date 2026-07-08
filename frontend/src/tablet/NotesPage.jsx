import { notes } from '../data.js'

export default function TabletNotesPage() {
  return (
    <div style={{ padding: '14px 44px 30px' }}>
      <h1 style={{ margin: '0 0 20px', fontFamily: "'Newsreader', serif", fontSize: 32, fontWeight: 500 }}>Notes &amp; memories</h1>

      {notes.length === 0 ? (
        <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 14, color: '#b2ab9d' }}>No notes yet</div>
      ) : (
        <div style={{ columns: 3, columnGap: 16 }}>
          {notes.map((n, i) => (
            <div key={i} style={{ breakInside: 'avoid', marginBottom: 16, background: '#fffdf9', border: '1px solid rgba(43,40,32,.09)', borderRadius: 16, padding: '18px 20px', borderTop: `3px solid ${n.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: n.color }}>{n.tag}</span>
                <span style={{ fontSize: 11, color: '#b2ab9d' }}>{n.date}</span>
              </div>
              <h3 style={{ margin: '0 0 6px', fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600 }}>{n.title}</h3>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#6b665a' }}>{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
