import { useEffect, useRef, useState } from 'react'
import { useGoals } from '../../context/GoalsContext.jsx'
import { useTodos } from '../../context/TodosContext.jsx'
import { fmtHours } from '../../lib/weeklyReview.js'
import { Input, Textarea, eyebrow } from '../ui.jsx'
import { AtlasNote, StepHeading, KIND_COLOR } from './shared.jsx'

// Goals come first because everything else follows from them: what you did
// with your time, which to-dos matter, which habits are worth protecting. For
// each goal: what moved this week, what this quarter is meant to be about, and
// a place to add the next step as a to-do for next week.

// The quarter focus saves as you type, a moment after you stop.
function FocusField({ goal, quarter }) {
  const { setQuarterFocus } = useGoals()
  const saved = goal.quarters[quarter] || ''
  const [text, setText] = useState(saved)
  const timer = useRef(null)
  const latest = useRef({ text: saved, dirty: false })
  useEffect(() => () => {
    clearTimeout(timer.current)
    if (latest.current.dirty) setQuarterFocus(goal.id, quarter, latest.current.text)
  }, [goal.id, quarter, setQuarterFocus])
  const change = (v) => {
    setText(v)
    latest.current = { text: v, dirty: true }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { latest.current.dirty = false; setQuarterFocus(goal.id, quarter, v) }, 600)
  }
  return (
    <Textarea value={text} onChange={e => change(e.target.value)} rows={2} aria-label={`${goal.title} focus for ${quarter}`}
      placeholder={`What is ${quarter} about for this goal?`} style={{ width: '100%', resize: 'none', fontSize: 13.5 }} />
  )
}

function GoalCard({ goal, row, hours, hasTags, quarter, insight, delay }) {
  const { addTodo } = useTodos()
  const [text, setText] = useState('')
  const [added, setAdded] = useState([])
  const add = () => {
    const t = text.trim()
    if (!t) return
    addTodo(t, 'week', goal.id)
    setAdded(a => [...a, t])
    setText('')
  }
  const finished = row?.finished || []
  return (
    <article className="wr-rise" style={{ '--d': `${delay}s`, marginBottom: 16, padding: '18px 20px 18px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: `4px solid ${goal.color}` }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600, color: 'var(--ink)' }}>{goal.title}</h2>
        {hasTags && hours > 0 && (
          <span title="Calendar time matched to this goal's tags" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>
            {fmtHours(hours)} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>on the calendar</span>
          </span>
        )}
      </header>

      {insight && (
        <p style={{ margin: '9px 0 0', display: 'flex', gap: 9, fontSize: 14, lineHeight: 1.5, color: 'var(--mid)' }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: KIND_COLOR[insight.kind], flex: 'none', marginTop: 7 }} />
          {insight.text}
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ ...eyebrow, marginBottom: 6 }}>Done this week</div>
        {finished.length === 0
          ? <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>No linked to-dos finished.</div>
          : finished.map((t, i) => <div key={i} style={{ fontSize: 14, color: 'var(--ink)', padding: '2px 0' }}><span style={{ color: 'var(--sage)', marginRight: 8 }}>✓</span>{t}</div>)}
        {row?.open_this_week > 0 && (
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--muted)' }}>{row.open_this_week} more waiting on your list.</div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ ...eyebrow, marginBottom: 6 }}>{quarter} focus</div>
        <FocusField goal={goal} quarter={quarter} />
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ ...eyebrow, marginBottom: 6 }}>Next step, as a to-do for next week</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="e.g. Book the first lesson" aria-label={`Add a to-do for ${goal.title}`} style={{ flex: 1, minWidth: 0 }} />
          <button type="button" onClick={add} disabled={!text.trim()}
            style={{ padding: '0 14px', borderRadius: 9, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: text.trim() ? 'pointer' : 'default', opacity: text.trim() ? 1 : .5 }}>Add</button>
        </div>
        {added.map((t, i) => <div key={i} style={{ marginTop: 7, fontSize: 13.5, color: 'var(--sage)' }}>＋ {t}</div>)}
      </div>
    </article>
  )
}

export default function GoalsStep({ recap, narrative, goalHours }) {
  const { goals } = useGoals()
  const quarter = recap.goals.quarter
  const hoursOf = Object.fromEntries(goalHours.map(g => [g.id, g.hours]))
  const hasTags = goals.some(g => (g.tags || '').trim())
  const rows = Object.fromEntries(recap.goals.goals.map(r => [r.id, r]))
  const insightFor = (id) => recap.goals.insights.find(i => i.ref?.id === id)

  return (
    <div>
      <StepHeading kicker="Goals" title="What did you move forward?">
        Start with what you're aiming at. The to-dos and habits that follow are only worth it if they serve something here.
      </StepHeading>
      <AtlasNote loading={narrative === null} text={narrative && narrative.goals} />
      {goals.length === 0 && (
        <p style={{ fontSize: 14.5, color: 'var(--mid)', lineHeight: 1.6 }}>
          You haven't set any goals yet. Add some on the Goals page and they'll show up here each week.
        </p>
      )}
      {goals.map((g, i) => (
        <GoalCard key={g.id} goal={g} row={rows[g.id]} hours={hoursOf[g.id] || 0} hasTags={hasTags}
          quarter={quarter} insight={insightFor(g.id)} delay={0.08 * i} />
      ))}
    </div>
  )
}
