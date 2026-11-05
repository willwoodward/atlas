import { useEffect, useRef, useState } from 'react'
import { useTodos } from '../../context/TodosContext.jsx'
import { formatWeekRange, shiftWeek } from '../../lib/week.js'
import { reflectionPrompts } from '../../lib/weeklyReview.js'
import { Button, Input, Textarea, eyebrow } from '../ui.jsx'
import { AtlasNote, Block, StepHeading } from './shared.jsx'

// The last step turns what you saw into a plan: write down how the week went
// (with questions drawn from what actually happened), then what would make the
// next one a win. Both save as you type.
export default function PlanStep({ week, recap, narrative }) {
  const { reviews, outcomesByWeek, loadOutcomes, setOutcomes, addTodo } = useTodos()
  const next = shiftWeek(week, 1)
  const taRef = useRef(null)
  const [added, setAdded] = useState([])
  const [todo, setTodo] = useState('')

  useEffect(() => { if (!(week in reviews.byWeek)) reviews.load(week) }, [week]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { for (const w of [week, next]) if (!(w in outcomesByWeek)) loadOutcomes(w) }, [week, next]) // eslint-disable-line react-hooks/exhaustive-deps

  const journalLoaded = week in reviews.byWeek
  const journal = reviews.byWeek[week] ?? ''
  const aimed = (outcomesByWeek[week] || '').trim()
  const nextText = outcomesByWeek[next] ?? ''

  // A prompt is added as a line to write under, with the cursor after it.
  const addPrompt = (p) => {
    const sep = !journal ? '' : journal.endsWith('\n\n') ? '' : journal.endsWith('\n') ? '\n' : '\n\n'
    reviews.set(week, `${journal}${sep}${p}\n`)
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
  }
  const prompts = reflectionPrompts(recap).filter(p => !journal.includes(p))

  const addNext = () => {
    const t = todo.trim()
    if (!t) return
    addTodo(t, 'week')
    setAdded(a => [...a, t])
    setTodo('')
  }

  return (
    <div>
      <StepHeading kicker="Reflect & plan" title="What did this week teach you?">
        A few honest lines, then what would make next week a good one.
      </StepHeading>
      <AtlasNote loading={narrative === null} text={narrative && narrative.plan} />

      <Block title="How did the week go?" aside={formatWeekRange(week)}>
        {aimed && (
          <div style={{ margin: '14px 0 4px' }}>
            <div style={{ ...eyebrow, marginBottom: 6 }}>You were aiming for</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--mid)', whiteSpace: 'pre-wrap', borderLeft: '2px solid var(--bd)', paddingLeft: 12 }}>{aimed}</div>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, margin: '14px 0 10px' }}>
          {prompts.map(p => (
            <button key={p} type="button" onClick={() => addPrompt(p)}
              style={{ padding: '6px 11px', borderRadius: 99, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
              ＋ {p}
            </button>
          ))}
        </div>
        <Textarea ref={taRef} value={journal} disabled={!journalLoaded} rows={7} onChange={e => reviews.set(week, e.target.value)}
          placeholder={journalLoaded ? 'Write as much or as little as you like…' : 'Loading…'} aria-label="How did the week go?"
          style={{ width: '100%', fontSize: 15, lineHeight: 1.7, padding: '14px 16px', borderRadius: 12, minHeight: 170 }} />
      </Block>

      <Block title="What would make next week a win?" aside={formatWeekRange(next)}>
        <Textarea value={nextText} rows={3} onChange={e => setOutcomes(next, e.target.value)} aria-label="Next week's outcomes"
          placeholder="One to three outcomes. If only these happened, it was a good week."
          style={{ width: '100%', margin: '14px 0 0', fontSize: 15, lineHeight: 1.7, padding: '14px 16px', borderRadius: 12 }} />
        <div style={{ ...eyebrow, margin: '18px 0 7px' }}>Anything to put on the list now?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={todo} onChange={e => setTodo(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNext()}
            placeholder="A to-do for next week" aria-label="Add a to-do for next week" style={{ flex: 1, minWidth: 0 }} />
          <Button onClick={addNext} disabled={!todo.trim()}>Add</Button>
        </div>
        {added.map((t, i) => <div key={i} style={{ marginTop: 7, fontSize: 13.5, color: 'var(--sage)' }}>＋ {t}</div>)}
      </Block>
    </div>
  )
}
