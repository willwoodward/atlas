import { useState, useRef, useCallback } from 'react'
import CheckMark from '../components/CheckMark.jsx'
import { useTodos } from '../context/TodosContext.jsx'
import { useGoals } from '../context/GoalsContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'

const BUCKETS = [
  { key: 'today',   label: 'Today',     color: '#c15f3c' },
  { key: 'week',    label: 'This week', color: '#5f7591' },
  { key: 'someday', label: 'Someday',   color: '#b08a3e' },
]

function GoalDot({ goalId, goals }) {
  const g = goalId && goals.find(g => g.id === goalId)
  if (!g) return null
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: g.color, flexShrink: 0, marginTop: 2 }} />
}

function AddTodoRow({ bucket, onAdd, onCancel }) {
  const [text, setText] = useState('')

  const submit = () => {
    if (text.trim()) onAdd(text.trim(), bucket, null)
    onCancel()
  }

  return (
    <div style={{ paddingTop: 10, borderTop: '1px solid var(--bd-xs)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 18, height: 18, flex: 'none', borderRadius: 6, border: '1.6px solid #c9c2b3' }} />
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
          placeholder="New task…"
          style={{ flex: 1, border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13.5, color: 'var(--ink)', background: 'transparent' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingLeft: 27 }}>
        <button onClick={submit}
          style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: 'none', background: '#2b2820', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
          Add
        </button>
        <button onClick={onCancel}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--bd-xl)', background: 'transparent', color: 'var(--mid)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ display: 'block' }}>
      <circle cx="4" cy="3" r="1.1"/><circle cx="8" cy="3" r="1.1"/>
      <circle cx="4" cy="6" r="1.1"/><circle cx="8" cy="6" r="1.1"/>
      <circle cx="4" cy="9" r="1.1"/><circle cx="8" cy="9" r="1.1"/>
    </svg>
  )
}

function SubTodoRow({ sub, onToggle, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', paddingLeft: 28 }}>
      <button onClick={() => onToggle(sub.id)}
        style={{ width: 15, height: 15, flex: 'none', borderRadius: 4,
          border: `1.4px solid ${sub.done ? '#9a9488' : '#c9c2b3'}`,
          background: sub.done ? '#9a9488' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 0, transition: 'all .12s' }}>
        {sub.done && <CheckMark size={8} />}
      </button>
      <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, color: sub.done ? 'var(--faint)' : 'var(--mid)', textDecoration: sub.done ? 'line-through' : 'none' }}>
        {sub.text}
      </span>
      <button onClick={() => onRemove(sub.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: '1px 3px', borderRadius: 4, fontSize: 11, flexShrink: 0 }}>
        ✕
      </button>
    </div>
  )
}

function AddSubTodoInput({ parentId, onAdd, onCancel }) {
  const [text, setText] = useState('')
  const submit = () => { if (text.trim()) onAdd(parentId, text.trim()); onCancel() }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', paddingLeft: 28 }}>
      <span style={{ width: 15, height: 15, flex: 'none', borderRadius: 4, border: '1.4px solid #c9c2b3' }} />
      <input
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        onBlur={submit}
        placeholder="Sub-task…"
        style={{ flex: 1, border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--ink)', background: 'transparent' }}
      />
    </div>
  )
}

function BucketSection({ bucket, todos, goals, onToggle, onRemove, onAdd, onAddSub, dragState, onGripDown, todayStr, weekMonStr }) {
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState({})   // { [todoId]: true }
  const [addingSubFor, setAddingSubFor] = useState(null)

  // Done todos stay in bucket until day (today) or week (week) ends
  const staysHere = (t) => {
    if (!t.done || !t.completedAt) return true
    const d = t.completedAt.substring(0, 10)
    if (bucket.key === 'today') return d === todayStr
    if (bucket.key === 'week') return d >= weekMonStr
    return true  // someday: always stays
  }

  const activeTodos = todos.filter(t => t.bucket === bucket.key && !t.parentId && staysHere(t))
  const openCount   = activeTodos.filter(t => !t.done).length

  const { dragId, dropTarget } = dragState
  const isTarget = !!dragId && dropTarget?.bucketKey === bucket.key && dropTarget?.bucketKey !== todos.find(t => t.id === dragId)?.bucket

  const renderTodo = (t, idx) => {
    const isDragging  = dragId === t.id
    const isDropAbove = dropTarget?.todoId === t.id && dropTarget?.above
    const isDropBelow = dropTarget?.todoId === t.id && !dropTarget?.above
    const subTodos    = todos.filter(s => s.parentId === t.id)
    const hasChildren = subTodos.length > 0
    const isExpanded  = !!expanded[t.id]

    return (
      <div key={t.id}>
        {isDropAbove && <div style={{ height: 2, borderRadius: 2, background: bucket.color, margin: '2px 0' }} />}

        <div
          data-todo-id={t.id}
          data-bucket-key={bucket.key}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 9,
            padding: '10px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--bd-xs)',
            opacity: isDragging ? 0.35 : 1, transition: 'opacity .1s',
            pointerEvents: isDragging ? 'none' : 'auto',
          }}
        >
          {/* Grip — touch-action: none to prevent scroll on mobile */}
          <span
            style={{ color: 'var(--faint)', cursor: 'grab', flexShrink: 0, marginTop: 3, padding: '0 2px', touchAction: 'none' }}
            onPointerDown={e => onGripDown(e, t.id)}
          >
            <GripIcon />
          </span>

          {/* Checkbox */}
          <button onClick={() => onToggle(t.id)}
            style={{ width: 18, height: 18, flex: 'none', marginTop: 1, borderRadius: 6,
              border: `1.6px solid ${t.done ? bucket.color : '#c9c2b3'}`,
              background: t.done ? bucket.color : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', padding: 0, transition: 'all .12s' }}>
            {t.done && <CheckMark size={10} />}
          </button>

          <GoalDot goalId={t.goalId} goals={goals} />

          {/* Text area — tap to expand/collapse (if has children) or open creation (if none) */}
          <div
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', minWidth: 0 }}
            onClick={() => {
              if (hasChildren) setExpanded(p => ({ ...p, [t.id]: !p[t.id] }))
              else { setAddingSubFor(t.id); setExpanded(p => ({ ...p, [t.id]: true })) }
            }}
          >
            <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.45, color: t.done ? 'var(--faint)' : 'var(--ink)', textDecoration: t.done ? 'line-through' : 'none', transition: 'color .12s' }}>
              {t.text}
            </span>
            {/* Expand chevron — only when has sub-todos, handles expand/collapse */}
            {hasChildren && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                onClick={e => { e.stopPropagation(); setExpanded(p => ({ ...p, [t.id]: !p[t.id] })) }}
                style={{ flexShrink: 0, color: 'var(--faint)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s', cursor: 'pointer' }}>
                <path d="M9 6l6 6-6 6"/>
              </svg>
            )}
          </div>

          <button onClick={() => onRemove(t.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: '2px 4px', borderRadius: 5, fontSize: 12, flexShrink: 0 }}>
            ✕
          </button>
        </div>

        {/* Sub-todos — only when expanded */}
        {isExpanded && subTodos.map(s => (
          <SubTodoRow key={s.id} sub={s} onToggle={onToggle} onRemove={onRemove} />
        ))}

        {/* Add sub-todo input */}
        {addingSubFor === t.id && (
          <AddSubTodoInput parentId={t.id} onAdd={onAddSub} onCancel={() => setAddingSubFor(null)} />
        )}

        {/* Add sub-task link — shown at bottom when expanded and not already adding */}
        {isExpanded && addingSubFor !== t.id && (
          <button
            onClick={() => setAddingSubFor(t.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 28, paddingBottom: 4, color: 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add sub-task
          </button>
        )}

        {isDropBelow && <div style={{ height: 2, borderRadius: 2, background: bucket.color, margin: '2px 0' }} />}
      </div>
    )
  }

  return (
    <div
      data-bucket-key={bucket.key}
      style={{ background: 'var(--surface)', border: `1px solid ${isTarget ? bucket.color : 'var(--bd)'}`, borderRadius: 16, padding: '18px 20px', transition: 'border-color .1s' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, paddingBottom: 11, borderBottom: '1px solid var(--bd-sm)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: bucket.color, flexShrink: 0 }} />
        <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600, flex: 1 }}>{bucket.label}</h2>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{activeTodos.length === 0 ? '—' : openCount > 0 ? `${openCount} left` : 'all done'}</span>
      </div>

      {activeTodos.length === 0 && !adding && (
        <div style={{ padding: '14px 0 6px', fontSize: 13, color: 'var(--faint)' }}>Nothing here yet.</div>
      )}

      {activeTodos.map((t, idx) => renderTodo(t, idx))}

      {adding
        ? <AddTodoRow bucket={bucket.key} onAdd={onAdd} onCancel={() => setAdding(false)} />
        : (
          <button onClick={() => setAdding(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: activeTodos.length > 0 ? 8 : 0, color: 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '4px 0' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add task
          </button>
        )
      }
    </div>
  )
}

export default function TodoPage() {
  const isMobile = useIsMobile()
  const { todos, outcomes, addTodo, addSubTodo, toggleTodo, removeTodo, setOutcomes, reorderTodo } = useTodos()
  const { goals } = useGoals()

  const [showAllCompleted, setShowAllCompleted] = useState(false)
  const [dragId,     setDragId]     = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const dragDataRef = useRef({ id: null, active: false, startY: 0, startX: 0, dropTarget: null })

  const handleGripDown = useCallback((e, id) => {
    e.preventDefault()
    dragDataRef.current = { id, active: false, startY: e.clientY, startX: e.clientX, dropTarget: null }

    const onMove = (e) => {
      const d = dragDataRef.current
      if (!d.id) return
      const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      if (!d.active && moved > 8) {
        d.active = true
        setDragId(d.id)
      }
      if (!d.active) return

      // Hit-test: find what's under the pointer (dragging element has pointerEvents:none)
      const els = document.elementsFromPoint(e.clientX, e.clientY)
      let newTarget = null
      for (const el of els) {
        if (el.dataset.todoId && el.dataset.todoId !== d.id) {
          const rect = el.getBoundingClientRect()
          newTarget = { todoId: el.dataset.todoId, above: e.clientY < rect.top + rect.height / 2, bucketKey: el.dataset.bucketKey }
          break
        }
        if (el.dataset.bucketKey) {
          newTarget = { bucketKey: el.dataset.bucketKey }
          break
        }
      }
      d.dropTarget = newTarget
      setDropTarget(newTarget)
    }

    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      const d = dragDataRef.current
      if (d.active && d.dropTarget) {
        const dt = d.dropTarget
        if (dt.todoId) reorderTodo(d.id, dt.todoId, dt.above, dt.bucketKey)
        else if (dt.bucketKey) reorderTodo(d.id, null, false, dt.bucketKey)
      }
      dragDataRef.current = { id: null, active: false, startY: 0, startX: 0, dropTarget: null }
      setDragId(null)
      setDropTarget(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [reorderTodo])

  const _today = new Date()
  const todayStr = `${_today.getFullYear()}-${String(_today.getMonth()+1).padStart(2,'0')}-${String(_today.getDate()).padStart(2,'0')}`
  const _day = _today.getDay(), _mon = new Date(_today)
  _mon.setDate(_today.getDate() - (_day === 0 ? 6 : _day - 1))
  const weekMonStr = `${_mon.getFullYear()}-${String(_mon.getMonth()+1).padStart(2,'0')}-${String(_mon.getDate()).padStart(2,'0')}`

  const staysInBucket = (t) => {
    if (!t.done || !t.completedAt) return true
    const d = t.completedAt.substring(0, 10)
    if (t.bucket === 'today') return d === todayStr
    if (t.bucket === 'week') return d >= weekMonStr
    return true
  }

  const totalOpen = todos.filter(t => !t.done && !t.parentId).length

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 26 : 34, fontWeight: 500 }}>To-do</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>
          {totalOpen > 0 ? `${totalOpen} open` : 'All clear.'}
        </p>
      </div>

      {/* Weekly outcomes */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
          This week's outcomes
        </div>
        <textarea
          value={outcomes}
          onChange={e => setOutcomes(e.target.value)}
          placeholder="What would make this week a win? Write 1–3 outcomes…"
          rows={2}
          style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.65, color: 'var(--ink)', background: 'transparent' }}
        />
      </div>

      {/* Three buckets */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14, alignItems: 'start' }}>
        {BUCKETS.map(b => (
          <BucketSection
            key={b.key}
            bucket={b}
            todos={todos}
            goals={goals}
            onToggle={toggleTodo}
            onRemove={removeTodo}
            onAdd={addTodo}
            onAddSub={addSubTodo}
            dragState={{ dragId, dropTarget }}
            onGripDown={handleGripDown}
            todayStr={todayStr}
            weekMonStr={weekMonStr}
          />
        ))}
      </div>

      {/* Overall completed */}
      {(() => {
        const allDone = todos.filter(t => !t.parentId && t.done && !staysInBucket(t))
        if (allDone.length === 0) return null
        return (
          <div style={{ marginTop: 20 }}>
            <button onClick={() => setShowAllCompleted(p => !p)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                style={{ transform: showAllCompleted ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
                <path d="M9 6l6 6-6 6"/>
              </svg>
              Completed ({allDone.length})
            </button>
            {showAllCompleted && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '12px 20px' }}>
                {allDone.map((t, idx) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--bd-xs)' }}>
                    <button onClick={() => toggleTodo(t.id)}
                      style={{ width: 18, height: 18, flex: 'none', borderRadius: 6, border: '1.6px solid var(--faint)', background: 'var(--faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                      <CheckMark size={10} />
                    </button>
                    <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.4, color: 'var(--faint)', textDecoration: 'line-through' }}>{t.text}</span>
                    <span style={{ fontSize: 11, color: 'var(--faint)', flexShrink: 0 }}>
                      {t.bucket === 'today' ? 'today' : t.bucket === 'week' ? 'this week' : 'someday'}
                    </span>
                    <button onClick={() => removeTodo(t.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: '2px 4px', borderRadius: 5, fontSize: 12, flexShrink: 0 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
