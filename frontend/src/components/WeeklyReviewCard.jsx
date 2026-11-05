import { useWeeklyReview } from '../context/WeeklyReviewContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { formatWeekRange } from '../lib/week.js'
import { reviewTarget } from '../lib/weeklyReview.js'
import { Button, eyebrow } from './ui.jsx'

// The way into the weekly review from Home. Loud on Sunday (and on Monday to
// Wednesday if last week's was skipped), a quiet line the rest of the week,
// and a tick once the week's review is done.
export default function WeeklyReviewCard() {
  const review = useWeeklyReview()
  const isMobile = useIsMobile()
  if (!review || review.completed === null) return null
  const { week, phase } = reviewTarget()
  const finished = review.completed.has(week)

  if (finished) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '-8px 0 24px', fontSize: 13.5, color: 'var(--muted)' }}>
        <span style={{ color: 'var(--sage)', fontWeight: 700 }}>✓</span>
        Weekly review done for {formatWeekRange(week)}.
        <button type="button" onClick={() => review.open(week)} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}>Open it again</button>
      </div>
    )
  }

  if (phase === 'early') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '-8px 0 24px', fontSize: 13.5, color: 'var(--muted)' }}>
        Weekly review is due on Sunday.
        <button type="button" onClick={() => review.open(week)} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}>Start early</button>
      </div>
    )
  }

  const due = phase === 'due'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', margin: '0 0 28px', padding: isMobile ? '16px 18px' : '20px 24px', borderRadius: 'var(--radius-lg)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
      <div style={{ flex: '1 1 280px', minWidth: 0 }}>
        <div style={{ ...eyebrow, color: 'var(--accent)' }}>{due ? 'Sunday' : 'Missed'} · {formatWeekRange(week)}</div>
        <div style={{ marginTop: 6, fontFamily: 'var(--font-serif)', fontSize: isMobile ? 21 : 25, fontWeight: 500, color: 'var(--ink)' }}>
          {due ? 'Time for your weekly review' : 'Last week’s review is still waiting'}
        </div>
        <div style={{ marginTop: 5, fontSize: 14, lineHeight: 1.5, color: 'var(--mid)' }}>
          About half an hour: goals, money, habits and to-dos, then a plan for the week ahead.
        </div>
      </div>
      <Button variant="primary" size="lg" raised onClick={() => review.open(week)}>Start review</Button>
    </div>
  )
}
