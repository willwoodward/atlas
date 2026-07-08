export default function GoalRing({ pct = 0, color, size = 88 }) {
  const r = 38
  const circ = 2 * Math.PI * r
  const used = pct > 0 ? (circ * pct / 100).toFixed(1) : '0'
  const dash = `${used} ${circ.toFixed(1)}`
  const label = pct > 0 ? `${pct}%` : '—'
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg viewBox="0 0 88 88" style={{ transform: 'rotate(-90deg)', width: size, height: size }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="#ece7dc" strokeWidth="9" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={dash} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Newsreader', serif", fontSize: size > 84 ? 20 : 19, fontWeight: 600, color: '#2b2820' }}>
        {label}
      </div>
    </div>
  )
}
