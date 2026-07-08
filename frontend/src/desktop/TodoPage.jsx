import { useState } from 'react'
import CheckMark from '../components/CheckMark.jsx'
import { useTodos } from '../context/TodosContext.jsx'
import { useGoals } from '../context/GoalsContext.jsx'

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

function AddTodoRow({ bucket, goals, onAdd, onCancel }) {
  const [text,   setText]   = useState('')
  const [goalId, setGoalId] = useState(null)

  const submit = () => {
    if (text.trim()) onAdd(text.trim(), bucket, goalId)
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
      {goals.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingLeft: 27 }}>
          <button onClick={() => setGoalId(null)}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: `1.5px solid ${!goalId ? 'var(--ink)' : 'transparent'}`, background: 'transparent', cursor: 'pointer', color: 'var(--mid)', fontFamily: 'inherit' }}>
            None
          </button>
          {goals.map(g => (
            <button key={g.id} onClick={() => setGoalId(g.id === goalId ? null : g.id)}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 5,
                border: `1.5px solid ${goalId === g.id ? g.color : 'transparent'}`,
                background: goalId === g.id ? `${g.color}14` : 'transparent',
                cursor: 'pointer', color: goalId === g.id ? g.color : 'var(--mid)', fontFamily: 'inherit' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: g.color }} />
              {g.title.split(' ').slice(0, 3).join(' ')}
            </button>
          ))}
        </div>
      )}
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

// Grip handle icon
function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ display: 'block' }}>
      <circle cx="4" cy="3" r="1.1"/><circle cx="8" cy="3" r="1.1"/>
      <circle cx="4" cy="6" r="1.1"/><circle cx="8" cy="6" r="1.1"/>
      <circle cx="4" cy="9" r="1.1"/><circle cx="8" cy="9" r="1.1"/>
    </svg>
  )
}

function BucketSection({ bucket, todos, goals, onToggle, onRemove, onAdd, dragState, onDragStart, onDragEnd, onDragOverTodo, onDropOnTodo, onDragOverBucket, onDropOnBucket }) {
  const [adding, setAdding] = useState(false)
  const items    = todos.filter(t => t.bucket === bucket.key)
  const openCount = items.filter(t => !t.done).length

  const { dragId, dropTarget } = dragState
  const isTarget = !!dragId && dropTarget?.bucketKey === bucket.key && dropTarget?.bucketKey !== todos.find(t => t.id === dragId)?.bucket

  return (
    <div
      onDragOver={e => { e.preventDefault(); onDragOverBucket(e, bucket.key) }}
      onDrop={e => onDropOnBucket(e, bucket.key)}
      style={{ background: 'var(--surface)', border: `1px solid ${isTarget ? bucket.color : 'var(--bd)'}`, borderRadius: 16, padding: '18px 20px', transition: 'border-color .1s' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, paddingBottom: 11, borderBottom: '1px solid var(--bd-sm)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: bucket.color, flexShrink: 0 }} />
        <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600, flex: 1 }}>{bucket.label}</h2>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{items.length === 0 ? '—' : `${openCount} left`}</span>
      </div>

      {items.length === 0 && !adding && (
        <div style={{ padding: '14px 0 6px', fontSize: 13, color: 'var(--faint)' }}>Nothing here yet.</div>
      )}

      {items.map((t, idx) => {
        const isDragging   = dragId === t.id
        const isDropAbove  = dropTarget?.todoId === t.id && dropTarget?.above
        const isDropBelow  = dropTarget?.todoId === t.id && !dropTarget?.above

        return (
          <div key={t.id}>
            {/* Drop indicator above */}
            {isDropAbove && (
              <div style={{ height: 2, borderRadius: 2, background: bucket.color, margin: '2px 0' }} />
            )}

            <div
              draggable
              onDragStart={e => onDragStart(e, t.id)}
              onDragEnd={onDragEnd}
              onDragOver={e => onDragOverTodo(e, t.id, bucket.key)}
              onDrop={e => onDropOnTodo(e, t.id, bucket.key)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 9,
                padding: '10px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--bd-xs)',
                opacity: isDragging ? 0.35 : 1,
                transition: 'opacity .1s',
              }}
            >
              {/* Drag handle */}
              <span
                style={{ color: 'var(--faint)', cursor: 'grab', flexShrink: 0, marginTop: 3, padding: '0 2px' }}
                onMouseDown={e => e.stopPropagation()}
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

              <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.45, color: t.done ? 'var(--faint)' : 'var(--ink)', textDecoration: t.done ? 'line-through' : 'none', transition: 'color .12s' }}>
                {t.text}
              </span>

              <button onClick={() => onRemove(t.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: '2px 4px', borderRadius: 5, fontSize: 12, flexShrink: 0 }}>
                ✕
              </button>
            </div>

            {/* Drop indicator below */}
            {isDropBelow && (
              <div style={{ height: 2, borderRadius: 2, background: bucket.color, margin: '2px 0' }} />
            )}
          </div>
        )
      })}

      {adding
        ? <AddTodoRow bucket={bucket.key} goals={goals} onAdd={onAdd} onCancel={() => setAdding(false)} />
        : (
          <button onClick={() => setAdding(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: items.length > 0 ? 8 : 0, color: 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '4px 0' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add task
          </button>
        )
      }
    </div>
  )
}

export default function TodoPage() {
  const { todos, outcomes, addTodo, toggleTodo, removeTodo, clearDone, setOutcomes, reorderTodo } = useTodos()
  const { goals } = useGoals()

  const [dragId,     setDragId]     = useState(null)
  const [dropTarget, setDropTarget] = useState(null) // { todoId, above, bucketKey } | { bucketKey }

  const handleDragStart = (e, id) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setDragId(null)
    setDropTarget(null)
  }

  const handleDragOverTodo = (e, todoId, bucketKey) => {
    e.preventDefault()
    e.stopPropagation() // prevent bucket's onDragOver from also firing
    const rect = e.currentTarget.getBoundingClientRect()
    const above = e.clientY < rect.top + rect.height / 2
    setDropTarget({ todoId, above, bucketKey })
  }

  const handleDropOnTodo = (e, todoId, bucketKey) => {
    e.preventDefault()
    e.stopPropagation() // prevent bucket's onDrop from also firing
    if (!dragId || dragId === todoId) { handleDragEnd(); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const above = e.clientY < rect.top + rect.height / 2
    reorderTodo(dragId, todoId, above, bucketKey)
    handleDragEnd()
  }

  // Only fires when cursor is over empty bucket space (todo rows stopPropagation)
  const handleDragOverBucket = (e, bucketKey) => {
    e.preventDefault()
    setDropTarget({ bucketKey })
  }

  const handleDropOnBucket = (e, bucketKey) => {
    e.preventDefault()
    if (!dragId) return
    reorderTodo(dragId, null, false, bucketKey)
    handleDragEnd()
  }

  const totalOpen = todos.filter(t => !t.done).length

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 34, fontWeight: 500 }}>To-do</h1>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, alignItems: 'start' }}>
        {BUCKETS.map(b => (
          <BucketSection
            key={b.key}
            bucket={b}
            todos={todos}
            goals={goals}
            onToggle={toggleTodo}
            onRemove={removeTodo}
            onAdd={addTodo}
            dragState={{ dragId, dropTarget }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOverTodo={handleDragOverTodo}
            onDropOnTodo={handleDropOnTodo}
            onDragOverBucket={handleDragOverBucket}
            onDropOnBucket={handleDropOnBucket}
          />
        ))}
      </div>
    </div>
  )
}
