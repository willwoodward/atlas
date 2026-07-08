import { useState, useRef } from 'react'
import { user } from '../data.js'
import AssistantPage from './AssistantPage.jsx'
import HomePage      from './HomePage.jsx'
import AgendaPage    from './AgendaPage.jsx'
import HabitsPage    from './HabitsPage.jsx'
import TodoPage      from './TodoPage.jsx'
import NotesPage     from './NotesPage.jsx'
import FinancesPage  from './FinancesPage.jsx'
import GoalsPage     from './GoalsPage.jsx'

const PAGES = [
  { id: 'assistant', component: AssistantPage },
  { id: 'home',      component: HomePage },
  { id: 'agenda',    component: AgendaPage },
  { id: 'habits',    component: HabitsPage },
  { id: 'todos',     component: TodoPage },
  { id: 'notes',     component: NotesPage },
  { id: 'finances',  component: FinancesPage },
  { id: 'goals',     component: GoalsPage },
]
const N = PAGES.length

export default function TabletLayout() {
  const [index, setIndex] = useState(0)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(0)
  const sx = useRef(0)
  const sy = useRef(0)
  const axis = useRef(null)
  const viewW = useRef(0)

  const onDown = (e) => {
    sx.current = e.clientX
    sy.current = e.clientY
    axis.current = null
    viewW.current = e.currentTarget.clientWidth
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
    setDragging(true)
  }
  const onMove = (e) => {
    if (!dragging) return
    const dx = e.clientX - sx.current
    const dy = e.clientY - sy.current
    if (axis.current === null) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6)
        axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      else return
    }
    if (axis.current === 'x') setDragX(dx)
  }
  const onUp = () => {
    if (!dragging) return
    if (axis.current === 'x') {
      const th = (viewW.current || 600) * 0.15
      let ni = index
      if (dragX < -th) ni = Math.min(index + 1, N - 1)
      else if (dragX > th) ni = Math.max(index - 1, 0)
      setIndex(ni)
    }
    setDragX(0)
    setDragging(false)
  }

  let eff = dragX
  if ((index === 0 && eff > 0) || (index === N - 1 && eff < 0)) eff *= 0.35
  const trackStyle = {
    display: 'flex',
    height: '100%',
    width: `${N * 100}%`,
    transform: `translateX(calc(${-index * (100 / N)}% + ${eff}px))`,
    transition: dragging ? 'none' : 'transform .38s cubic-bezier(.4,0,.2,1)',
    willChange: 'transform',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#efeae0', overflow: 'hidden' }}>

      {/* Status bar */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 30px 4px', fontSize: 12, fontWeight: 600, color: '#9a9488' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span style={{ color: '#c9c2b3' }}>·</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 22, height: 22, borderRadius: 7, background: '#c15f3c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#efeae0' }} />
            </div>
            <span style={{ fontFamily: "'Newsreader', serif", fontSize: 15, fontWeight: 600, color: '#2b2820' }}>Atlas</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Battery icon */}
          <span style={{ width: 16, height: 9, border: '1.4px solid #b2ab9d', borderRadius: 2, display: 'inline-block', position: 'relative' }}>
            <span style={{ position: 'absolute', inset: 1, right: 5, background: '#b2ab9d', borderRadius: 1 }} />
          </span>
          {/* Avatar */}
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#c88a5f,#9a6d84)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 13 }}>
            {user.initials !== '—' ? user.initials : 'A'}
          </div>
        </div>
      </div>

      {/* Pager viewport */}
      <div
        style={{ flex: 1, overflow: 'hidden', position: 'relative', touchAction: 'pan-y', cursor: 'grab' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div style={trackStyle}>
          {PAGES.map(({ id, component: Page }) => (
            <div
              key={id}
              className="no-scrollbar"
              style={{ width: `${100 / N}%`, height: '100%', flex: 'none', overflowY: 'auto' }}
            >
              <Page />
            </div>
          ))}
        </div>
      </div>

      {/* Page dots */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '14px 0 18px' }}>
        {PAGES.map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            style={{
              height: 7, borderRadius: 99, border: 'none', cursor: 'pointer', padding: 0,
              transition: 'width .3s, background .3s',
              width: i === index ? 26 : 7,
              background: i === index ? '#c15f3c' : 'rgba(43,40,32,.2)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
