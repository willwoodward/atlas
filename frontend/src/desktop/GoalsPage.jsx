import { useState, useRef, useEffect } from 'react'
import { useGoals, GOAL_PALETTE } from '../context/GoalsContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { useQuickAdd } from '../context/QuickAddContext.jsx'

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
const QUARTER_LABELS = { Q1: 'Jan – Mar', Q2: 'Apr – Jun', Q3: 'Jul – Sep', Q4: 'Oct – Dec' }

function getQuarterFromDate(dateStr) {
  const m = new Date(dateStr).getMonth()
  if (m < 3) return 'Q1'
  if (m < 6) return 'Q2'
  if (m < 9) return 'Q3'
  return 'Q4'
}
const CURRENT_Q = getQuarterFromDate(new Date().toISOString())
const CURRENT_YEAR = new Date().getFullYear()
const QUARTER_ORDER = { Q1: 0, Q2: 1, Q3: 2, Q4: 3 }

function QuarterFocusInput({ value, onChange, color }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = ref.current.scrollHeight + 'px' } }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="What does progress look like this quarter?"
      rows={1}
      style={{ width: '100%', resize: 'none', overflow: 'hidden', border: 'none', outline: 'none',
        background: 'transparent', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6,
        color: 'var(--ink)', padding: 0 }}
    />
  )
}

function GoalCard({ goal, onRemove, onUpdate, onQuarterFocus }) {
  const createdQ = goal.createdAt ? getQuarterFromDate(goal.createdAt) : 'Q1'
  const [activeQ, setActiveQ] = useState(CURRENT_Q)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(goal.title)

  const commitTitle = () => {
    setEditingTitle(false)
    if (titleDraft.trim()) onUpdate(goal.id, { title: titleDraft.trim() })
    else setTitleDraft(goal.title)
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 18, overflow: 'hidden' }}>
      {/* Card header */}
      <div style={{ borderLeft: `4px solid ${goal.color}`, padding: '20px 22px 16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitleDraft(goal.title); setEditingTitle(false) } }}
              style={{ flex: 1, fontFamily: "'Newsreader', serif", fontSize: 20, fontWeight: 600, border: 'none', outline: `2px solid ${goal.color}`, borderRadius: 6, padding: '2px 6px', background: 'var(--surface)', color: 'var(--ink)' }}
            />
          ) : (
            <h3
              onClick={() => setEditingTitle(true)}
              style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 20, fontWeight: 600, cursor: 'text', flex: 1, lineHeight: 1.3 }}
            >
              {goal.title}
            </h3>
          )}
          <button
            onClick={() => window.confirm(`Remove "${goal.title}"?`) && onRemove(goal.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: '2px 4px', fontSize: 12, flexShrink: 0, marginTop: 2 }}
          >
            ✕
          </button>
        </div>

        {/* Quarter tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {QUARTERS.map(q => {
            const beforeCreation = QUARTER_ORDER[q] < QUARTER_ORDER[createdQ]
            const isPast         = QUARTER_ORDER[q] < QUARTER_ORDER[CURRENT_Q]
            const isCurrent      = q === CURRENT_Q
            const isActive       = q === activeQ
            const hasFocus       = !!goal.quarters[q]
            return (
              <button key={q} onClick={() => !beforeCreation && setActiveQ(q)}
                style={{
                  flex: 1, padding: '6px 4px', borderRadius: 9, border: 'none',
                  cursor: beforeCreation ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                  background: isActive ? (isCurrent ? goal.color : 'var(--surface-3)') : 'transparent',
                  color: beforeCreation
                    ? 'var(--bd-xl)'
                    : isActive
                      ? isCurrent ? '#fff' : 'var(--mid)'
                      : isPast ? 'var(--muted)' : isCurrent ? goal.color : 'var(--faint)',
                  transition: 'all .12s',
                  position: 'relative',
                }}
              >
                {q}
                {hasFocus && !isActive && !beforeCreation && (
                  <span style={{ position: 'absolute', top: 4, right: 6, width: 4, height: 4, borderRadius: '50%', background: goal.color }} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Quarter focus area */}
      <div style={{ padding: '14px 22px 20px 20px', borderTop: '1px solid var(--bd-xs)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
          {activeQ} · {QUARTER_LABELS[activeQ]}
          {activeQ === CURRENT_Q && (
            <span style={{ marginLeft: 8, color: goal.color, letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>current</span>
          )}
        </div>
        <QuarterFocusInput
          value={goal.quarters[activeQ]}
          onChange={text => onQuarterFocus(goal.id, activeQ, text)}
          color={goal.color}
        />
      </div>
    </div>
  )
}

const REVIEW_PROMPTS = [
  'What actually moved forward this quarter?',
  "What didn't happen, and why?",
  'What am I proudest of?',
  'Where did my time really go?',
  'What would I do differently?',
  'What should change for next quarter?',
]

// Debounced so typing a long reflection is not one PUT per keystroke. Pending
// text is flushed when the quarter changes or the drawer closes.
function ReflectionEditor({ period, initial, onSave }) {
  const [text, setText] = useState(initial)
  const timer = useRef(null)
  const latest = useRef({ text: initial, dirty: false })

  useEffect(() => () => {
    clearTimeout(timer.current)
    if (latest.current.dirty) onSave(period, latest.current.text)
  }, [period, onSave])

  const change = (value) => {
    setText(value)
    latest.current = { text: value, dirty: true }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      latest.current.dirty = false
      onSave(period, value)
    }, 600)
  }

  // Appends the prompt as a line to write under, then puts the cursor after it.
  const textareaRef = useRef(null)
  const addPrompt = (prompt) => {
    const sep = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
    const next = `${text}${sep}${prompt}\n`
    change(next)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.length, next.length)
      el.scrollTop = el.scrollHeight
    })
  }

  return (
    <>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {REVIEW_PROMPTS.map(p => {
        const used = text.includes(p)
        return (
          <button key={p} onClick={() => !used && addPrompt(p)} disabled={used}
            style={{ padding: '5px 11px', borderRadius: 99, border: '1px solid var(--bd-xl)',
              background: 'transparent', fontFamily: 'inherit', fontSize: 12.5,
              color: used ? 'var(--faint)' : 'var(--mid)', cursor: used ? 'default' : 'pointer',
              textDecoration: used ? 'line-through' : 'none' }}
          >
            {p}
          </button>
        )
      })}
    </div>
    <textarea
      ref={textareaRef}
      autoFocus
      value={text}
      onChange={e => change(e.target.value)}
      placeholder="How did the quarter go? What moved, what didn't, what you'd change next time…"
      style={{ width: '100%', minHeight: 260, flex: 1, resize: 'vertical', boxSizing: 'border-box',
        padding: '14px 16px', borderRadius: 12, border: '1.5px solid var(--bd-xl)', outline: 'none',
        background: 'var(--surface-2)', fontFamily: 'inherit', fontSize: 14.5, lineHeight: 1.65,
        color: 'var(--ink)' }}
    />
    </>
  )
}

function QuarterlyReviewDrawer({ onClose }) {
  const { goals, reflections, setReflection } = useGoals()
  const [year, setYear] = useState(CURRENT_YEAR)
  const [quarter, setQuarter] = useState(CURRENT_Q)
  const period = `${year}-${quarter}`

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isFuture = (y, q) => y > CURRENT_YEAR || (y === CURRENT_YEAR && QUARTER_ORDER[q] > QUARTER_ORDER[CURRENT_Q])
  const changeYear = (y) => {
    setYear(y)
    if (isFuture(y, quarter)) setQuarter(CURRENT_Q)
  }

  // Per-goal quarter focus is not stored by year, so it only describes the
  // current year — showing it against an older review would be misleading.
  const focuses = year === CURRENT_YEAR
    ? goals.filter(g => g.quarters[quarter]?.trim())
    : []

  const arrow = (disabled) => ({
    background: 'none', border: 'none', padding: '2px 8px', fontSize: 16, fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer', color: disabled ? 'var(--bd-xl)' : 'var(--mid)',
  })

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.4)' }} />
      <div role="dialog" aria-label="Quarterly review" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 201, margin: '0 auto',
        width: '100%', maxWidth: 760, boxSizing: 'border-box',
        background: 'var(--surface)', borderRadius: '18px 18px 0 0',
        boxShadow: '0 -8px 40px rgba(0,0,0,.18)',
        height: '82vh', display: 'flex', flexDirection: 'column',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 20px 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--bd-xl)' }} />
        </div>

        <div style={{ padding: '14px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 24, fontWeight: 500 }}>Quarterly review</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => changeYear(year - 1)} style={arrow(false)} aria-label="Previous year">‹</button>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', minWidth: 40, textAlign: 'center' }}>{year}</span>
            <button onClick={() => year < CURRENT_YEAR && changeYear(year + 1)} style={arrow(year >= CURRENT_YEAR)} aria-label="Next year">›</button>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px 4px 2px 12px', fontSize: 16, lineHeight: 1 }}>✕</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '16px 24px 0' }}>
          {QUARTERS.map(q => {
            const future = isFuture(year, q)
            const active = q === quarter
            const written = !!reflections[`${year}-${q}`]?.trim()
            return (
              <button key={q} disabled={future} onClick={() => setQuarter(q)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 10, border: 'none', position: 'relative',
                  cursor: future ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
                  background: active ? 'var(--ink)' : 'var(--surface-2)',
                  color: future ? 'var(--bd-xl)' : active ? 'var(--surface)' : 'var(--mid)',
                  transition: 'all .12s',
                }}
              >
                {q}
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, marginTop: 1, opacity: .75 }}>{QUARTER_LABELS[q]}</span>
                {written && !active && (
                  <span style={{ position: 'absolute', top: 6, right: 8, width: 5, height: 5, borderRadius: '50%', background: '#c15f3c' }} />
                )}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {focuses.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
                What you set out to do
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {focuses.map(g => (
                  <div key={g.id} style={{ borderLeft: `3px solid ${g.color}`, padding: '2px 0 2px 10px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{g.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{g.quarters[quarter]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <ReflectionEditor key={period} period={period} initial={reflections[period] ?? ''} onSave={setReflection} />
        </div>
      </div>
    </>
  )
}

function AddGoalForm({ onAdd, onCancel }) {
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(GOAL_PALETTE[0])
  return (
    <form
      onSubmit={e => { e.preventDefault(); if (title.trim()) { onAdd(title.trim(), color); } }}
      style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 18, padding: '20px 22px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}
    >
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Goal — e.g. Get genuinely good at AI"
        style={{ flex: 1, padding: '9px 13px', borderRadius: 9, border: '1.5px solid var(--bd-xl)', background: 'var(--surface-2)', fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {GOAL_PALETTE.map(c => (
          <button key={c} type="button" onClick={() => setColor(c)}
            style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: color === c ? '2.5px solid #2b2820' : '2.5px solid transparent', cursor: 'pointer', padding: 0, transition: 'border-color .12s' }}
          />
        ))}
      </div>
      <button type="submit" style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#2b2820', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Add goal</button>
      <button type="button" onClick={onCancel} style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
    </form>
  )
}

export default function GoalsPage() {
  const isMobile = useIsMobile()
  const { goals, addGoal, removeGoal, updateGoal, setQuarterFocus } = useGoals()
  const [adding, setAdding] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  useQuickAdd('Add goal', () => setAdding(true))

  const handleAdd = (title, color) => {
    addGoal(title, color)
    setAdding(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 26 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 26 : 34, fontWeight: 500 }}>Goals</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>The bigger arcs — where the days are pointing.</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {goals.length === 0 && !adding && (
          <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 14, color: 'var(--faint)' }}>
            No goals yet — use <strong style={{ color: 'var(--mid)' }}>+ Add goal</strong> at the top to start.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: (isMobile || goals.length === 1) ? '1fr' : 'repeat(2, 1fr)', gap: 14 }}>
          {goals.map(g => (
            <GoalCard key={g.id} goal={g} onRemove={removeGoal} onUpdate={updateGoal} onQuarterFocus={setQuarterFocus} />
          ))}
        </div>

        {adding && <AddGoalForm onAdd={handleAdd} onCancel={() => setAdding(false)} />}

        <button onClick={() => setReviewing(true)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%',
            padding: '16px 22px', borderRadius: 18, border: '1px dashed var(--bd-xl)', background: 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--ink)' }}
        >
          <span>
            <span style={{ display: 'block', fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 500 }}>Quarterly review</span>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--mid)', marginTop: 2 }}>
              Reflect on {CURRENT_Q} {CURRENT_YEAR}, or look back at earlier quarters.
            </span>
          </span>
          <span style={{ fontSize: 18, color: 'var(--muted)' }}>↑</span>
        </button>
      </div>

      {reviewing && <QuarterlyReviewDrawer onClose={() => setReviewing(false)} />}
    </div>
  )
}
