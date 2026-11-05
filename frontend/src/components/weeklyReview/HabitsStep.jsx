import { useEffect, useRef, useState } from 'react'
import { useHabits } from '../../context/HabitsContext.jsx'
import { useIsMobile } from '../../hooks/useIsMobile.js'
import { addDays, localDateStr, parseLocalDate } from '../../lib/week.js'
import { AtlasNote, Observations, StepHeading } from './shared.jsx'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// Habits are checked day by day, so a day you forgot to tick can be put right
// here, and the observations update to match. Each habit is shown against its
// own usual, so a slip is a slip for *that* habit.
export default function HabitsStep({ week, recap, narrative, reload }) {
  const { toggleCompletion } = useHabits()
  const isMobile = useIsMobile()
  const dates = DAYS.map((_, i) => localDateStr(addDays(parseLocalDate(week), i)))
  const today = localDateStr(new Date())
  // Ticks made here show at once; the recap catches up a moment later.
  const [edits, setEdits] = useState({})
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const flagsOf = (h) => h.days.map((on, i) => edits[`${h.id}|${dates[i]}`] ?? on)
  const toggle = (h, i) => {
    const key = `${h.id}|${dates[i]}`
    const now = flagsOf(h)[i]
    setEdits(e => ({ ...e, [key]: !now }))
    toggleCompletion(h.id, dates[i])
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { reload().then(() => setEdits({})) }, 700)
  }

  const slipped = new Set(recap.habits.insights.filter(i => i.kind === 'warn' && i.ref?.type === 'habit').map(i => i.ref.id))
  const rows = [...recap.habits.habits].sort((a, b) => (slipped.has(b.id) - slipped.has(a.id)) || a.name.localeCompare(b.name))

  return (
    <div>
      <StepHeading kicker="Habits" title="Who showed up?">
        Tap a day to fix anything you forgot to tick. Each habit is judged against its own usual, not a perfect week.
      </StepHeading>
      <AtlasNote loading={narrative === null} text={narrative && narrative.habits} />
      <Observations items={recap.habits.insights} />

      {rows.length === 0 && <p style={{ fontSize: 14.5, color: 'var(--mid)' }}>No habits were being tracked this week.</p>}

      <div className="wr-rise" style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 'var(--radius-lg)', padding: isMobile ? '4px 14px' : '6px 22px' }}>
        {rows.map((h, n) => {
          const flags = flagsOf(h)
          const done = flags.filter((on, i) => on && dates[i] <= today).length
          const off = slipped.has(h.id)
          return (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 18, flexWrap: isMobile ? 'wrap' : 'nowrap', padding: '14px 0', borderTop: n ? '1px solid var(--bd-xs)' : 'none' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: h.color, flex: 'none' }} />
                  <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{h.name}</span>
                </div>
                <div style={{ marginTop: 3, paddingLeft: 18, fontSize: 12, color: off ? 'var(--accent)' : 'var(--muted)' }}>
                  {h.usual_days != null ? `usually ${Math.round(h.usual_days)} a week` : 'new'}{h.streak >= 3 ? ` · ${h.streak}-day streak` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                {dates.map((d, i) => {
                  const future = d > today
                  const on = flags[i]
                  return (
                    <button key={d} type="button" disabled={future} onClick={() => toggle(h, i)} aria-pressed={on}
                      aria-label={`${h.name}, ${parseLocalDate(d).toLocaleDateString('en-GB', { weekday: 'long' })}`}
                      style={{ width: isMobile ? 32 : 38, height: isMobile ? 32 : 38, borderRadius: 10, padding: 0, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
                               cursor: future ? 'default' : 'pointer', opacity: future ? .35 : 1, transition: 'all .12s',
                               border: `1.5px solid ${on ? h.color : 'var(--bd-xl)'}`, background: on ? h.color : 'transparent', color: on ? '#fff' : 'var(--faint)' }}>
                      {DAYS[i]}
                    </button>
                  )
                })}
              </div>
              <div style={{ width: 46, flex: 'none', textAlign: 'right', fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 500, color: off ? 'var(--accent)' : 'var(--ink)' }}>
                {done}<span style={{ fontSize: 13, color: 'var(--faint)' }}>/{h.possible}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
