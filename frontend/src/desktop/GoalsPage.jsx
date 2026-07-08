import { useState, useRef, useEffect } from 'react'
import { useGoals, GOAL_PALETTE } from '../context/GoalsContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'

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
        {!adding && (
          <button onClick={() => setAdding(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 11, border: 'none', background: '#2b2820', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add goal
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {goals.length === 0 && !adding && (
          <div style={{ padding: '60px 0', textAlign: 'center', fontSize: 14, color: 'var(--faint)' }}>
            No goals yet — click <strong style={{ color: 'var(--mid)' }}>Add goal</strong> to start.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: (isMobile || goals.length === 1) ? '1fr' : 'repeat(2, 1fr)', gap: 14 }}>
          {goals.map(g => (
            <GoalCard key={g.id} goal={g} onRemove={removeGoal} onUpdate={updateGoal} onQuarterFocus={setQuarterFocus} />
          ))}
        </div>

        {adding && <AddGoalForm onAdd={handleAdd} onCancel={() => setAdding(false)} />}
      </div>
    </div>
  )
}
