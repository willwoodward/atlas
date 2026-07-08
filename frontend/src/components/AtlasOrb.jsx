export default function AtlasOrb({ orbSize = 200, ring1 = 300, ring2 = 240 }) {
  const eqBottom = Math.round(ring1 * 0.127)
  const eqHeight = Math.round(ring1 * 0.073)
  return (
    <div style={{ position: 'relative', width: ring1, height: ring1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', width: ring1, height: ring1, borderRadius: '50%', border: '1px solid rgba(193,95,60,.35)', animation: 'pulsering 3.4s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', width: ring2, height: ring2, borderRadius: '50%', border: '1px solid rgba(193,95,60,.5)', animation: 'pulsering 3.4s ease-in-out .4s infinite' }} />
      <div style={{
        position: 'relative', width: orbSize, height: orbSize, borderRadius: '50%', overflow: 'hidden',
        animation: 'floaty 6s ease-in-out infinite',
        boxShadow: '0 24px 70px rgba(193,95,60,.4),inset 0 0 40px rgba(255,255,255,.25)',
        background: 'radial-gradient(circle at 35% 30%,#e6a077,#c15f3c 55%,#9a3f22)',
      }}>
        <div style={{ position: 'absolute', width: '75%', height: '75%', top: '5%', left: '-5%',   borderRadius: '50%', background: 'radial-gradient(circle,#f0b98f,transparent 65%)', filter: 'blur(14px)', animation: 'blobA 5s ease-in-out infinite',   mixBlendMode: 'screen' }} />
        <div style={{ position: 'absolute', width: '70%', height: '70%', bottom: '-5%', right: '-7%', borderRadius: '50%', background: 'radial-gradient(circle,#9a6d84,transparent 65%)', filter: 'blur(16px)', animation: 'blobB 6.5s ease-in-out infinite', mixBlendMode: 'screen' }} />
        <div style={{ position: 'absolute', width: '60%', height: '60%', top: '20%', left: '30%',  borderRadius: '50%', background: 'radial-gradient(circle,#f6d9b8,transparent 60%)', filter: 'blur(12px)', animation: 'blobC 5.8s ease-in-out infinite', mixBlendMode: 'screen' }} />
      </div>
      <div style={{ position: 'absolute', bottom: eqBottom, display: 'flex', gap: 4, alignItems: 'flex-end', height: eqHeight }}>
        {[0, 0.15, 0.3, 0.45].map((d, i) => (
          <span key={i} style={{ width: 3, height: '100%', borderRadius: 2, background: 'rgba(255,255,255,.85)', transformOrigin: 'bottom', animation: `eq 1s ease-in-out ${d}s infinite` }} />
        ))}
      </div>
    </div>
  )
}
