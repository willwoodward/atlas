import { eyebrow } from '../ui.jsx'

// Pieces the review's screens share.

export const KIND_COLOR = { warn: 'var(--accent)', good: 'var(--sage)', note: 'var(--muted)' }

/** Heading block at the top of a step. */
export function StepHeading({ kicker, title, children }) {
  return (
    <div className="wr-rise" style={{ marginBottom: 26 }}>
      <div style={{ ...eyebrow, color: 'var(--accent)', marginBottom: 8 }}>{kicker}</div>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 'clamp(28px, 4.2vw, 40px)', fontWeight: 500, letterSpacing: '-.01em', lineHeight: 1.15, color: 'var(--ink)' }}>{title}</h1>
      {children && <p style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.55, color: 'var(--mid)', maxWidth: 560 }}>{children}</p>}
    </div>
  )
}

/** What Atlas makes of a section, in a sentence or two. Shows a quiet shimmer while it's being written. */
export function AtlasNote({ text, loading }) {
  if (!loading && !text) return null
  return (
    <div className="wr-rise" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', margin: '0 0 22px', padding: '14px 16px', borderRadius: 14, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
      <span aria-hidden style={{ width: 22, height: 22, borderRadius: '50%', flex: 'none', marginTop: 1, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--surface)' }} />
      </span>
      {loading
        ? <div style={{ flex: 1, paddingTop: 4 }}><div className="wr-shimmer" style={{ height: 11, width: '78%', borderRadius: 6 }} /><div className="wr-shimmer" style={{ height: 11, width: '52%', borderRadius: 6, marginTop: 8 }} /></div>
        : <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--ink)' }}>{text}</p>}
    </div>
  )
}

/** The plain observations worked out from the data. */
export function Observations({ items, skip = () => false }) {
  const shown = items.filter(i => !skip(i))
  if (shown.length === 0) return null
  return (
    <ul style={{ listStyle: 'none', margin: '0 0 22px', padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
      {shown.map((i, n) => (
        <li key={n} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.5, color: 'var(--mid)' }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: KIND_COLOR[i.kind], flex: 'none', marginTop: 7 }} />
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** A titled block within a step. */
export function Block({ title, aside, children, style }) {
  return (
    <section className="wr-rise" style={{ marginBottom: 26, ...style }}>
      {(title || aside) && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingBottom: 9, marginBottom: 4, borderBottom: '1px solid var(--bd-xl)' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>{title}</h2>
          {aside && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{aside}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

/** A thin horizontal meter. `mark` draws a tick (for "usual"). */
export function Meter({ value, max, color = 'var(--accent)', mark }) {
  const pct = (v) => `${Math.min(Math.max(max ? v / max : 0, 0), 1) * 100}%`
  return (
    <div style={{ position: 'relative', height: 7, borderRadius: 99, background: 'var(--surface-3)' }}>
      <div style={{ position: 'absolute', inset: '0 auto 0 0', width: pct(value), borderRadius: 99, background: color, transition: 'width .5s cubic-bezier(.2,.8,.2,1)' }} />
      {mark != null && <div title="Usual" style={{ position: 'absolute', top: -3, bottom: -3, left: pct(mark), width: 2, borderRadius: 2, background: 'var(--ink)', opacity: .45 }} />}
    </div>
  )
}

/** A small round tick box. */
export function Tick({ checked, color, onClick, label, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked} aria-label={label}
      style={{ width: 22, height: 22, flex: 'none', borderRadius: 7, padding: 0, cursor: disabled ? 'default' : 'pointer',
               border: `1.6px solid ${checked ? color : 'var(--bd-xl)'}`, background: checked ? color : 'transparent',
               display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? .4 : 1, transition: 'all .12s' }}>
      {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4 10-11" /></svg>}
    </button>
  )
}

/** Animations for the review, kept in one place. */
export const REVIEW_CSS = `
@keyframes wr-rise { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
@keyframes wr-shimmer { 0% { background-position: 100% 0 } 100% { background-position: -100% 0 } }
@keyframes wr-pop { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: none } }
.wr-rise { animation: wr-rise .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0s) }
.wr-pop { animation: wr-pop .55s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0s) }
.wr-shimmer { background: linear-gradient(90deg, var(--surface-3) 25%, var(--surface-2) 50%, var(--surface-3) 75%); background-size: 200% 100%; animation: wr-shimmer 1.4s linear infinite }
@media (prefers-reduced-motion: reduce) { .wr-rise, .wr-pop { animation: none } .wr-shimmer { animation: none } }
`
