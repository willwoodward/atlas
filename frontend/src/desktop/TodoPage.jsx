import { useState, useRef, useCallback, useEffect } from 'react'
import CheckMark from '../components/CheckMark.jsx'
import { useTodos } from '../context/TodosContext.jsx'
import { useGoals } from '../context/GoalsContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { useQuickAdd } from '../context/QuickAddContext.jsx'
import { weekKey, shiftWeek, formatWeekRange, relativeWeekLabel, staysInBucket as staysInBucketAt } from '../lib/week.js'

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

// Where a dragged to-do would land: the list parts to make room for it. The
// height animates, so the rows slide apart and back together.
function DropGap({ open, height, color }) {
  return (
    <div data-drop-gap={open ? 'open' : undefined}
      style={{ height: open ? height : 0, transition: 'height .16s ease', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: '4px 0', borderRadius: 10, border: `1.5px dashed ${color}`, background: 'var(--surface-2)', opacity: .9 }} />
    </div>
  )
}

function BucketSection({ bucket, todos, goals, onToggle, onRemove, onAdd, onAddSub, dragState, onGripDown, onTouchHold, openSignal = 0 }) {
  const [adding, setAdding] = useState(false)
  // Bumped by the header "+ Add to-do" (Today only). A counter rather than a
  // boolean so pressing it again re-opens the row after it was dismissed.
  useEffect(() => { if (openSignal) setAdding(true) }, [openSignal])
  const [expanded, setExpanded] = useState({})   // { [todoId]: true }
  const [addingSubFor, setAddingSubFor] = useState(null)

  // Done todos stay in bucket until day (today) or week (week) ends
  const staysHere = staysInBucketAt

  const activeTodos = todos.filter(t => t.bucket === bucket.key && !t.parentId && staysHere(t))
  const openCount   = activeTodos.filter(t => !t.done).length

  const { dragId, dropTarget, gapH } = dragState
  const gapHere = (beforeId) => !!dragId && dropTarget?.bucketKey === bucket.key && dropTarget.beforeId === beforeId
  const isTarget = !!dragId && dropTarget?.bucketKey === bucket.key && dropTarget?.bucketKey !== todos.find(t => t.id === dragId)?.bucket

  const renderTodo = (t, idx) => {
    const isDragging  = dragId === t.id
    const subTodos    = todos.filter(s => s.parentId === t.id)
    const hasChildren = subTodos.length > 0
    const isExpanded  = !!expanded[t.id]

    return (
      <div key={t.id}>
        <DropGap open={gapHere(t.id)} height={gapH} color={bucket.color} />

        {/* The dragged to-do folds away (kept in the DOM so touch events keep
            arriving) and the gap shows where it will go instead. */}
        <div style={isDragging ? { height: 0, overflow: 'hidden' } : undefined}>
        <div
          data-todo-id={t.id}
          data-bucket-key={bucket.key}
          onTouchStart={e => onTouchHold(e, t.id, false)}
          onContextMenu={e => { if (dragId || e.nativeEvent.pointerType === 'touch') e.preventDefault() }}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 9,
            padding: '10px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--bd-xs)',
            pointerEvents: isDragging ? 'none' : 'auto',
            // Long-press is "pick up", not "select text" / the iOS callout
            userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
          }}
        >
          {/* Grip — touch-action: none so dragging it never scrolls the page */}
          <span
            style={{ color: 'var(--faint)', cursor: 'grab', flexShrink: 0, marginTop: 3, padding: '0 2px', touchAction: 'none' }}
            onPointerDown={e => onGripDown(e, t.id)}
            onTouchStart={e => { e.stopPropagation(); onTouchHold(e, t.id, true) }}
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

        {/* Add sub-task link — only under a to-do that has sub-tasks; for one
            without, tapping the row opens the input, and dismissing it empty
            shouldn't leave this behind. */}
        {isExpanded && hasChildren && addingSubFor !== t.id && (
          <button
            onClick={() => setAddingSubFor(t.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 28, paddingBottom: 4, color: 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add sub-task
          </button>
        )}

        </div>
      </div>
    )
  }

  return (
    <div
      data-bucket-key={bucket.key}
      data-bucket-section={bucket.key}
      style={{ background: 'var(--surface)', border: `1px solid ${isTarget ? bucket.color : 'var(--bd)'}`, borderRadius: 16, padding: '18px 20px', transition: 'border-color .1s' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, paddingBottom: 11, borderBottom: '1px solid var(--bd-sm)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: bucket.color, flexShrink: 0 }} />
        <h2 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600, flex: 1 }}>{bucket.label}</h2>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{activeTodos.length === 0 ? '—' : openCount > 0 ? `${openCount} left` : 'all done'}</span>
      </div>

      {activeTodos.length === 0 && !adding && !gapHere(null) && (
        <div style={{ padding: '14px 0 6px', fontSize: 13, color: 'var(--faint)' }}>Nothing here yet.</div>
      )}

      {/* Divider index skips the to-do being dragged (it's folded away), so the
          first visible row never shows a stray top border. */}
      {activeTodos.map((t, idx) => renderTodo(t, idx - (dragId && activeTodos.slice(0, idx).some(x => x.id === dragId) ? 1 : 0)))}
      <DropGap open={gapHere(null)} height={gapH} color={bucket.color} />

      {adding
        ? <AddTodoRow key={openSignal} bucket={bucket.key} onAdd={onAdd} onCancel={() => setAdding(false)} />
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

const navBtn = { width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 0, flex: 'none' }

// "What would make this week a success" — one entry per Mon–Sun week. Arrows
// or a horizontal swipe move between weeks, so on a Sunday you can look back
// at this week and write next week's.
function WeeklyOutcomes() {
  const { outcomesByWeek, outcomesHistory, loadOutcomes, setOutcomes } = useTodos()
  const current = weekKey()
  const [week, setWeek] = useState(current)
  const [showHistory, setShowHistory] = useState(false)
  const swipe = useRef(null)
  const taRef = useRef(null)

  const loaded = week in outcomesByWeek
  const text = outcomesByWeek[week] ?? ''
  useEffect(() => { if (!loaded) loadOutcomes(week) }, [week, loaded, loadOutcomes])
  useEffect(() => {
    const el = taRef.current
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
  }, [text, week])

  const isPast = week < current
  const isSunday = new Date().getDay() === 0
  const rel = relativeWeekLabel(week)
  const go = (n) => { setWeek(w => shiftWeek(w, n)); setShowHistory(false) }

  const onTouchStart = (e) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY } }
  const onTouchEnd = (e) => {
    const s0 = swipe.current; swipe.current = null
    if (!s0) return
    const t = e.changedTouches[0], dx = t.clientX - s0.x, dy = t.clientY - s0.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 14, padding: '14px 16px 14px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>
            {week === current ? "This week's outcomes" : rel ? `${rel}'s outcomes` : 'Outcomes'}
          </div>
          <div style={{ fontSize: 12, color: week === current ? 'var(--mid)' : '#5f7591', marginTop: 2 }}>{formatWeekRange(week)}</div>
        </div>
        {week !== current && (
          <button onClick={() => { setWeek(current); setShowHistory(false) }} style={{ ...navBtn, width: 'auto', padding: '0 8px', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', border: '1px solid var(--bd)' }}>This week</button>
        )}
        <button onClick={() => go(-1)} aria-label="Previous week" style={navBtn}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button onClick={() => go(1)} aria-label="Next week" style={navBtn}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button onClick={() => setShowHistory(h => !h)} aria-label="Past weeks" title="Past weeks"
          style={{ ...navBtn, background: showHistory ? 'var(--surface-3)' : 'transparent', color: showHistory ? 'var(--ink)' : 'var(--muted)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="9" y1="3" x2="9" y2="6"/><line x1="15" y1="3" x2="15" y2="6"/></svg>
        </button>
      </div>

      {showHistory ? (
        <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
          {outcomesHistory.length === 0 && <div style={{ fontSize: 13, color: 'var(--faint)', padding: '6px 0' }}>No past weeks written yet.</div>}
          {outcomesHistory.map(r => (
            <button key={r.week_str} onClick={() => { setWeek(r.week_str); setShowHistory(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 0', border: 'none', borderTop: '1px solid var(--bd-xs)', background: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: r.week_str === week ? '#5f7591' : 'var(--mid)' }}>
                {relativeWeekLabel(r.week_str) ? `${relativeWeekLabel(r.week_str)} · ` : ''}{formatWeekRange(r.week_str)}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.text.split('\n')[0]}</div>
            </button>
          ))}
        </div>
      ) : (
        <textarea
          ref={taRef}
          value={text}
          disabled={!loaded}
          onChange={e => setOutcomes(week, e.target.value)}
          placeholder={!loaded ? 'Loading…' : isPast ? 'Nothing written for this week.' : 'What would make this week a win? Write 1–3 outcomes…'}
          rows={2}
          style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.65, color: 'var(--ink)', background: 'transparent', padding: 0 }}
        />
      )}

      {isSunday && week === current && !showHistory && (
        <button onClick={() => go(1)} style={{ marginTop: 4, fontSize: 12.5, fontWeight: 600, color: '#5f7591', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
          Plan next week →
        </button>
      )}
    </div>
  )
}

export default function TodoPage() {
  const isMobile = useIsMobile()
  const { todos, addTodo, addSubTodo, toggleTodo, removeTodo, reorderTodo } = useTodos()
  const { goals } = useGoals()

  const [showAllCompleted, setShowAllCompleted] = useState(false)
  const [todaySignal, setTodaySignal] = useState(0)
  useQuickAdd('Add to-do', () => setTodaySignal(n => n + 1))
  const [dragId,     setDragId]     = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [ghost,      setGhost]      = useState(null)   // lifted copy that follows the finger / cursor
  const dragRef = useRef(null)

  // ─── Drag engine (shared by mouse and touch) ──────────────────────────────
  // The drop target is { bucketKey, beforeId } — beforeId null means the end
  // of that list. It's worked out from where rows would sit with the gap
  // closed, so the gap opening (and pushing rows down) can't move the target
  // and set off a flicker loop.
  const [gapH, setGapH] = useState(44)
  const SETTLE_MS = 70

  const rowsIn = (section, exceptId) =>
    [...section.querySelectorAll('[data-todo-id]')].filter(el => el.dataset.todoId !== exceptId)

  const hitTest = (x, y, id) => {
    const section = document.elementsFromPoint(x, y).map(el => el.closest?.('[data-bucket-section]')).find(Boolean)
    if (!section) return null // between lists: keep the current target
    const gap = section.querySelector('[data-drop-gap="open"]')
    const g = gap?.getBoundingClientRect()
    const before = rowsIn(section, id).find(el => {
      const rect = el.getBoundingClientRect()
      const shift = g && rect.top >= g.top ? g.height : 0
      return y < rect.top - shift + rect.height / 2
    })
    return { bucketKey: section.dataset.bucketSection, beforeId: before?.dataset.todoId ?? null }
  }

  const applyTarget = (d, t) => {
    d.dropTarget = t
    d.targetKey = `${t.bucketKey}|${t.beforeId}`
    setDropTarget(t)
  }

  const updateDrag = (x, y) => {
    const d = dragRef.current
    if (!d?.active) return
    d.x = x; d.y = y
    setGhost(g => g && { ...g, top: y - d.offsetY, left: x - d.offsetX })
    const t = hitTest(x, y, d.id)
    if (!t) return
    const key = `${t.bucketKey}|${t.beforeId}`
    if (key === d.targetKey) { clearTimeout(d.settle); d.pendingKey = null; return }
    if (key === d.pendingKey) return
    // A new spot must hold briefly before the gap moves there, so hovering
    // right on a boundary doesn't make the list jitter.
    d.pendingKey = key
    clearTimeout(d.settle)
    d.settle = setTimeout(() => { if (dragRef.current === d) { d.pendingKey = null; applyTarget(d, t) } }, SETTLE_MS)
  }

  // Scroll the list when the drag nears the top/bottom edge of its scroller.
  const autoScroll = () => {
    const d = dragRef.current
    if (!d?.active) return
    const sc = d.scroller
    const top = sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top
    const bottom = sc === document.scrollingElement ? window.innerHeight : sc.getBoundingClientRect().bottom
    const EDGE = 70
    const speed = d.y < top + EDGE ? -(top + EDGE - d.y) / 5 : d.y > bottom - EDGE ? (d.y - (bottom - EDGE)) / 5 : 0
    if (speed) { sc.scrollTop += speed; updateDrag(d.x, d.y) }
    d.raf = requestAnimationFrame(autoScroll)
  }

  const activateDrag = () => {
    const d = dragRef.current
    const row = d.row.getBoundingClientRect()
    d.active = true
    // Start with the gap exactly where the to-do was, so nothing jumps.
    const section = d.row.closest('[data-bucket-section]')
    const all = rowsIn(section, null)
    const next = all[all.indexOf(d.row) + 1]
    d.origin = `${section.dataset.bucketSection}|${next?.dataset.todoId ?? null}`
    setGapH(row.height)
    applyTarget(d, { bucketKey: section.dataset.bucketSection, beforeId: next?.dataset.todoId ?? null })
    d.offsetY = d.y - row.top
    d.offsetX = d.x - row.left
    let sc = d.row.parentElement
    while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement
    d.scroller = sc || document.scrollingElement
    setDragId(d.id)
    setGhost({ id: d.id, left: row.left, width: row.width, top: row.top })
    navigator.vibrate?.(12)
    d.raf = requestAnimationFrame(autoScroll)
  }

  const endDrag = (commit) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    clearTimeout(d.holdTimer)
    clearTimeout(d.settle)
    cancelAnimationFrame(d.raf)
    d.cleanup?.()
    if (commit && d.active && d.dropTarget && d.targetKey !== d.origin) {
      const { bucketKey, beforeId } = d.dropTarget
      if (beforeId) reorderTodo(d.id, beforeId, true, bucketKey)
      else {
        // End of the list: after its last row, or into an empty list.
        const section = document.querySelector(`[data-bucket-section="${bucketKey}"]`)
        const last = section && rowsIn(section, d.id).at(-1)
        reorderTodo(d.id, last?.dataset.todoId ?? null, false, bucketKey)
      }
    }
    setDragId(null); setDropTarget(null); setGhost(null)
  }

  // Mouse / pen: press the grip and move.
  const handleGripDown = useCallback((e, id) => {
    if (e.pointerType === 'touch') return // touch is handled by handleTouchStart
    e.preventDefault()
    dragRef.current = { id, row: e.currentTarget.closest('[data-todo-id]'), x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, active: false }
    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      d.x = ev.clientX; d.y = ev.clientY
      if (!d.active && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) > 8) activateDrag()
      updateDrag(ev.clientX, ev.clientY)
    }
    const onUp = () => endDrag(true)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    dragRef.current.cleanup = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [reorderTodo]) // eslint-disable-line

  // Touch: hold anywhere on the row to pick it up (the grip picks up at once).
  // Moving before the hold completes is treated as a scroll and cancels it.
  const handleTouchStart = useCallback((e, id, fromGrip) => {
    if (e.touches.length !== 1 || dragRef.current) return
    if (e.target.closest('button, input, textarea')) return
    const t = e.touches[0]
    const d = dragRef.current = { id, row: e.currentTarget.closest('[data-todo-id]'), x: t.clientX, y: t.clientY, startX: t.clientX, startY: t.clientY, active: false }
    const onMove = (ev) => {
      const p = ev.touches[0]
      if (!d.active) {
        if (Math.hypot(p.clientX - d.startX, p.clientY - d.startY) > 10) endDrag(false)
        return
      }
      ev.preventDefault() // we own the gesture now: no scrolling
      updateDrag(p.clientX, p.clientY)
    }
    const onEnd = (ev) => {
      if (d.active) ev.preventDefault() // swallow the click that would open sub-tasks
      endDrag(true)
    }
    const onCancel = () => endDrag(false)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd, { passive: false })
    document.addEventListener('touchcancel', onCancel)
    d.cleanup = () => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onCancel)
    }
    d.holdTimer = setTimeout(() => { if (dragRef.current === d) activateDrag() }, fromGrip ? 120 : 380)
  }, [reorderTodo]) // eslint-disable-line

  useEffect(() => () => endDrag(false), []) // eslint-disable-line

  const staysInBucket = staysInBucketAt

  const totalOpen = todos.filter(t => !t.done && !t.parentId).length

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 26 : 34, fontWeight: 500 }}>To-do</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>
          {totalOpen > 0 ? `${totalOpen} open` : 'All clear.'}
        </p>
      </div>

      <WeeklyOutcomes />

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
            dragState={{ dragId, dropTarget, gapH }}
            onGripDown={handleGripDown}
            onTouchHold={handleTouchStart}
            openSignal={b.key === 'today' ? todaySignal : 0}
          />
        ))}
      </div>

      {/* The lifted to-do, following the finger / cursor while dragging */}
      {ghost && (() => {
        const t = todos.find(x => x.id === ghost.id)
        const b = BUCKETS.find(x => x.key === dropTarget?.bucketKey) || BUCKETS.find(x => x.key === t?.bucket)
        return t && (
          <div style={{
            position: 'fixed', left: ghost.left - 10, width: ghost.width + 20, top: ghost.top, zIndex: 300,
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px', borderRadius: 12,
            background: 'var(--surface)', border: `1.5px solid ${b?.color || 'var(--bd)'}`,
            boxShadow: '0 12px 32px rgba(0,0,0,.22)', transform: 'scale(1.03) rotate(-0.6deg)',
            pointerEvents: 'none', userSelect: 'none', fontSize: 13.5, color: 'var(--ink)',
            transition: 'border-color .12s',
          }}>
            <span style={{ color: 'var(--faint)' }}><GripIcon /></span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
          </div>
        )
      })()}

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
