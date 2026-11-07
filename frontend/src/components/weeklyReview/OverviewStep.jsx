import { formatWeekRange } from '../../lib/week.js'
import { overviewTiles, headlines } from '../../lib/weeklyReview.js'
import { useFinances } from '../../context/FinancesContext.jsx'
import { useIsMobile } from '../../hooks/useIsMobile.js'
import { eyebrow } from '../ui.jsx'
import { KIND_COLOR } from './shared.jsx'

// The first screen: the week at a glance, a few big numbers that arrive one
// after another, then Atlas's read on it and the one good thing and one thing
// to watch. Everything after this goes section by section.
export default function OverviewStep({ week, recap, narrative, goalHours }) {
  const isMobile = useIsMobile()
  const { fmt } = useFinances()
  const money = (n) => fmt(n, 0)
  const tiles = overviewTiles(recap, goalHours, money)
  const { good, warn } = headlines(recap)
  const partial = recap.partial

  return (
    <div>
      <div className="wr-rise" style={{ marginBottom: 30 }}>
        <div style={{ ...eyebrow, color: 'var(--accent)', marginBottom: 10 }}>
          {partial ? 'The week so far' : 'Your week'} · {formatWeekRange(week)}
        </div>
        {narrative === null
          ? <div className="wr-shimmer" style={{ height: 40, width: '86%', borderRadius: 10 }} />
          : (
            <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 'clamp(30px, 5vw, 48px)', fontWeight: 500, letterSpacing: '-.015em', lineHeight: 1.12, color: 'var(--ink)' }}>
              {(narrative && narrative.headline) || 'Here’s how the week went.'}
            </h1>
          )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : `repeat(${Math.min(tiles.length, 4)}, 1fr)`, gap: 12, marginBottom: 28 }}>
        {tiles.map((t, i) => (
          <div key={t.key} className="wr-pop" style={{ '--d': `${0.25 + i * 0.18}s`, padding: isMobile ? '16px 16px 14px' : '20px 22px 18px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '1px solid var(--bd)', borderTop: `3px solid ${t.tone}` }}>
            <div style={{ ...eyebrow }}>{t.label}</div>
            <div style={{ marginTop: 10, fontFamily: 'var(--font-serif)', fontSize: isMobile ? 34 : 44, fontWeight: 500, lineHeight: 1, letterSpacing: '-.02em', color: 'var(--ink)' }}>{t.value}</div>
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--mid)' }}>{t.sub}</div>
            {t.delta && (
              <div style={{ marginTop: 10, fontSize: 12, color: t.better == null ? 'var(--muted)' : t.better ? 'var(--sage)' : 'var(--accent)' }}>
                {t.delta}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="wr-rise" style={{ '--d': `${0.3 + tiles.length * 0.18}s` }}>
        {[['The bright spot', good], ['Worth a look', warn]].map(([label, item]) => item && (
          <div key={label} style={{ display: 'flex', gap: 14, padding: '14px 0', borderTop: '1px solid var(--bd-xl)' }}>
            <span style={{ ...eyebrow, width: 104, flex: 'none', paddingTop: 3, color: KIND_COLOR[item.kind] }}>{label}</span>
            <span style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--ink)' }}>{item.text}</span>
          </div>
        ))}
      </div>

      <div style={{ height: 18 }} />
      <p className="wr-rise" style={{ '--d': `${0.5 + tiles.length * 0.18}s`, margin: '8px 0 0', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6 }}>
        Next: money, then goals, habits and to-dos, so what you see in each can
        shape the plan for next week.
      </p>
    </div>
  )
}
