import AtlasOrb from '../components/AtlasOrb.jsx'
import { assistantPrompts } from '../data.js'

export default function TabletAssistantPage() {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px 40px 30px' }}>
      <AtlasOrb orbSize={158} ring1={230} ring2={184} />

      <h1 style={{ margin: '6px 0 8px', fontFamily: "'Newsreader', serif", fontSize: 30, fontWeight: 500 }}>
        How can I help you plan today?
      </h1>
      <p style={{ margin: '0 0 22px', fontSize: 15, color: '#6b665a', maxWidth: 460, lineHeight: 1.5 }}>
        Ask me to schedule your week, review your spending, or reflect on a goal.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 640, marginBottom: 22 }}>
        {assistantPrompts.map((p) => (
          <span key={p} style={{ padding: '11px 17px', borderRadius: 99, background: '#fffdf9', border: '1px solid rgba(43,40,32,.1)', fontSize: 14, color: '#4a463c' }}>{p}</span>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 560, padding: '13px 18px', borderRadius: 16, background: '#fffdf9', border: '1px solid rgba(43,40,32,.12)', boxShadow: '0 4px 18px rgba(43,40,32,.06)' }}>
        <span style={{ fontSize: 15, color: '#9a9488', flex: 1, textAlign: 'left' }}>Message Atlas…</span>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: '#c15f3c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l16 8-16 8 3-8z" /></svg>
        </span>
      </div>
    </div>
  )
}
