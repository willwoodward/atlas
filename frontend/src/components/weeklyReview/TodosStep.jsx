import { useEffect, useMemo, useState } from 'react'
import { useGoals } from '../../context/GoalsContext.jsx'
import { useTodos } from '../../context/TodosContext.jsx'
import { useIsMobile } from '../../hooks/useIsMobile.js'
import { localDateStr, parseLocalDate } from '../../lib/week.js'
import { ageLabel } from '../../lib/weeklyReview.js'
import { Button } from '../ui.jsx'
import { AtlasNote, Block, Observations, StepHeading } from './shared.jsx'

// What's still open, one decision each: done, keep for next week, someday, or
// let go. The list is taken once when you arrive and kept, so a to-do you've
// dealt with stays put (with an undo) instead of jumping out from under you.

// Stored stamps are a bare date (written by the assistant), an ISO instant, or
// SQLite's "2026-11-04 22:46:58" (UTC, no zone). All are read as the local day.
const toDay = (stamp) => {
  if (!stamp) return null
  const d = stamp.length <= 10 ? parseLocalDate(stamp) : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp.replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return null
  const [y, m, day] = localDateStr(d).split('-').map(Number)
  return new Date(y, m - 1, day)
}
const daysBetween = (from, to = new Date()) => Math.max(0, Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()) - from) / 86400000))

// How long since anything happened to a to-do or its sub-tasks, so one whose
// sub-tasks are being ticked off isn't called old.
export const openTodos = (todos) => {
  const kids = (id) => todos.filter(c => c.parentId === id)
  return todos.filter(t => !t.parentId && !t.done && (t.bucket === 'today' || t.bucket === 'week'))
    .map(t => {
      const subs = kids(t.id)
      const days = [t.createdAt, ...subs.flatMap(c => [c.createdAt, c.completedAt])].map(toDay).filter(Boolean)
      const touched = days.length ? new Date(Math.max(...days)) : null
      return { id: t.id, text: t.text, bucket: t.bucket, goalId: t.goalId, age: touched ? daysBetween(touched) : null,
               subs: { total: subs.length, done: subs.filter(c => c.done).length } }
    })
    .sort((a, b) => (b.age ?? -1) - (a.age ?? -1))
}

const VERB = { done: 'Marked done', keep: 'Kept for next week', someday: 'Moved to someday', drop: 'Dropped' }

function Row({ item, goal, decision, apply, undo, wide }) {
  const [sure, setSure] = useState(false)
  const old = (item.age ?? 0) >= 14
  if (decision) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--bd-xs)', fontSize: 14 }}>
        <span style={{ flex: 1, minWidth: 0, color: 'var(--faint)', textDecoration: decision === 'done' || decision === 'drop' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
        <span style={{ fontSize: 12.5, color: decision === 'done' ? 'var(--sage)' : 'var(--muted)', flex: 'none' }}>{VERB[decision]}</span>
        {decision !== 'drop' && <button type="button" onClick={undo} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', flex: 'none' }}>Undo</button>}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: wide ? 'center' : 'flex-start', flexDirection: wide ? 'row' : 'column', gap: wide ? 14 : 9, padding: '13px 0', borderBottom: '1px solid var(--bd-xs)' }}>
      <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
        <div style={{ fontSize: 15, lineHeight: 1.4, color: 'var(--ink)' }}>{item.text}</div>
        <div style={{ marginTop: 4, display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
          {item.age != null && <span style={{ color: old ? 'var(--accent)' : 'var(--muted)', fontWeight: old ? 600 : 400 }}>{item.age < 1 ? 'touched today' : `untouched ${ageLabel(item.age)}`}</span>}
          <span>{item.bucket === 'today' ? 'Today' : 'This week'}</span>
          {item.subs.total > 0 && <span>{item.subs.done}/{item.subs.total} sub-task{item.subs.total === 1 ? '' : 's'}</span>}
          {goal && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: goal.color }} />{goal.title}</span>}
        </div>
        {old && <div style={{ marginTop: 5, fontSize: 13, color: 'var(--accent)' }}>{item.age >= 56 ? 'This has sat for months. Put a time on it, or let it go.' : 'Been here a while. Do it this week, break it down, or let it go.'}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" onClick={() => apply('done')} style={{ color: 'var(--sage)', fontWeight: 600 }}>Done</Button>
        <Button size="sm" variant="secondary" onClick={() => apply('keep')}>Next week</Button>
        <Button size="sm" variant="ghost" onClick={() => apply('someday')}>Someday</Button>
        {sure
          ? <Button size="sm" variant="danger" onClick={() => apply('drop')} onBlur={() => setSure(false)} autoFocus>Sure?</Button>
          : <Button size="sm" variant="ghost" onClick={() => setSure(true)} aria-label={`Drop ${item.text}`}>Drop</Button>}
      </div>
    </div>
  )
}

export default function TodosStep({ recap, narrative, memo, setMemo }) {
  const { todos, toggleTodo, moveTodo, removeTodo } = useTodos()
  const { goals } = useGoals()
  const isMobile = useIsMobile()
  const snapshot = useMemo(() => openTodos(todos), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!memo.items) setMemo(m => ({ ...m, items: snapshot })) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const items = memo.items ?? snapshot
  const decisions = memo.decisions
  const goalOf = (id) => goals.find(g => g.id === id)
  const [showAllDone, setShowAllDone] = useState(false)

  const decide = (item, choice) => {
    if (choice === 'done') toggleTodo(item.id)
    else if (choice === 'keep') { if (item.bucket === 'today') moveTodo(item.id, 'week') }
    else if (choice === 'someday') moveTodo(item.id, 'someday')
    else if (choice === 'drop') removeTodo(item.id)
    setMemo(m => ({ ...m, decisions: { ...m.decisions, [item.id]: choice } }))
  }
  const undo = (item) => {
    const choice = decisions[item.id]
    if (choice === 'done') toggleTodo(item.id)
    else if (choice === 'keep') { if (item.bucket === 'today') moveTodo(item.id, 'today') }
    else if (choice === 'someday') moveTodo(item.id, item.bucket)
    setMemo(m => { const d = { ...m.decisions }; delete d[item.id]; return { ...m, decisions: d } })
  }
  const undecided = items.filter(i => !decisions[i.id])
  const keepRest = () => undecided.forEach(i => decide(i, 'keep'))

  const finished = recap.todos.finished
  const shownFinished = showAllDone ? finished : finished.slice(0, 5)

  return (
    <div>
      <StepHeading kicker="To-dos" title="What carries over?">
        Decide each open to-do: finish it, keep it for next week, park it for someday, or let it go. Anything left unanswered stays where it is.
      </StepHeading>
      <AtlasNote loading={narrative === null} text={narrative && narrative.todos} />
      <Observations items={recap.todos.insights} skip={i => i.ref?.type === 'todo'} />

      <Block title="Still open" aside={items.length ? `${undecided.length} to decide` : undefined}>
        {items.length === 0 && <p style={{ margin: '14px 0 0', fontSize: 14.5, color: 'var(--mid)' }}>Nothing open in today or this week. A clear list.</p>}
        {items.map(item => (
          <Row key={item.id} item={item} goal={goalOf(item.goalId)} wide={!isMobile} decision={decisions[item.id]}
            apply={(c) => decide(item, c)} undo={() => undo(item)} />
        ))}
        {undecided.length >= 3 && (
          <div style={{ marginTop: 14 }}>
            <Button variant="ghost" size="sm" onClick={keepRest}>Keep the other {undecided.length} for next week</Button>
          </div>
        )}
      </Block>

      {finished.length > 0 && (
        <Block title="Finished this week" aside={`${finished.length}`}>
          {shownFinished.map(t => (
            <div key={t.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--bd-xs)', fontSize: 14, color: 'var(--mid)' }}>
              <span style={{ color: 'var(--sage)', marginRight: 9 }}>✓</span>{t.text}{t.parent && <span style={{ color: 'var(--faint)' }}> · {t.parent}</span>}
            </div>
          ))}
          {finished.length > 5 && (
            <button type="button" onClick={() => setShowAllDone(s => !s)} style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}>
              {showAllDone ? 'Show fewer' : `Show all ${finished.length}`}
            </button>
          )}
        </Block>
      )}
    </div>
  )
}
