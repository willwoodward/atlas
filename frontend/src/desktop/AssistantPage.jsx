import AtlasOrb from '../components/AtlasOrb.jsx'
import { assistantPrompts } from '../data.js'
import { useIsMobile } from '../hooks/useIsMobile.js'

export default function AssistantPage() {
  const isMobile = useIsMobile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: isMobile ? '60vh' : 'calc(100vh - 73px)', textAlign: 'center', padding: isMobile ? '24px 20px' : 0 }}>
      <AtlasOrb orbSize={isMobile ? 130 : 200} ring1={isMobile ? 200 : 300} ring2={isMobile ? 160 : 240} />

      <h1 style={{ margin: '14px 0 6px', fontFamily: "'Newsreader', serif", fontSize: 30, fontWeight: 500, color: 'var(--ink)' }}>
        How can I help you plan today?
      </h1>
      <p style={{ margin: '0 0 26px', fontSize: 14.5, color: 'var(--mid)', maxWidth: 440, lineHeight: 1.55 }}>
        Ask me to schedule your week, review your spending, or reflect on a goal. I have the full picture.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 560, marginBottom: 26 }}>
        {assistantPrompts.map((p) => (
          <span key={p} style={{ padding: '9px 15px', borderRadius: 99, background: 'var(--surface)', border: '1px solid var(--bd)', fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>{p}</span>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 520, padding: '12px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd-lg)', boxShadow: '0 4px 18px var(--bd-xs)' }}>
        <span style={{ fontSize: 14, color: 'var(--muted)', flex: 1, textAlign: 'left' }}>Message Atlas…</span>
        <button style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: '#c15f3c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l16 8-16 8 3-8z" /></svg>
        </button>
      </div>
    </div>
  )
}
