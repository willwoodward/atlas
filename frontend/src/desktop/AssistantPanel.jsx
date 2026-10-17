import { useEffect, useRef, useState } from 'react'
import AssistantChat from '../components/AssistantChat.jsx'

// The assistant docked to the right of whatever page you're on. It is the
// same session as the Assistant page (state lives in AssistantContext), so a
// conversation carries between the two. Drag the left edge to resize.

const WIDTH_KEY = 'atlas:assistant-panel-width'
const MIN = 340, MAX = 720

const loadWidth = () => {
  try { return Math.min(MAX, Math.max(MIN, Number(localStorage.getItem(WIDTH_KEY)) || 420)) } catch { return 420 }
}

const DURATION = 240
const EASE = 'cubic-bezier(.32,.72,0,1)'
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// `open` false plays the exit, then calls onExited so the layout can unmount it.
export default function AssistantPanel({ open = true, onExited, onClose, onExpand }) {
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const [shown, setShown] = useState(false)
  const drag = useRef(null)

  // Enter on the frame after mounting (so there's a start state to animate
  // from); exit when `open` goes false.
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => onExited?.(), reducedMotion() ? 0 : DURATION)
    return () => clearTimeout(t)
  }, [open]) // eslint-disable-line

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)) } catch { /* not kept */ }
  }, [width])

  const onPointerDown = e => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width }
    setDragging(true)
  }
  const onPointerMove = e => {
    if (!drag.current) return
    // Never squeeze the page below a usable width.
    const max = Math.min(MAX, window.innerWidth - 236 - 480)
    setWidth(Math.min(Math.max(MIN, drag.current.w + (drag.current.x - e.clientX)), Math.max(MIN, max)))
  }
  const onPointerUp = () => { drag.current = null; setDragging(false) }

  const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 5, borderRadius: 7, display: 'flex' }

  return (
    // The outer box grows from 0 so the page narrows smoothly to make room;
    // the panel inside keeps its full width and slides in from the right.
    <div style={{ width: shown ? width : 0, flex: 'none', height: '100%', overflow: 'hidden', position: 'relative',
                  transition: dragging || reducedMotion() ? 'none' : `width ${DURATION}ms ${EASE}` }}>
    <aside aria-label="Assistant" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width, display: 'flex', flexDirection: 'column', background: 'var(--bg)', borderLeft: '1px solid var(--bd)',
                  transform: shown ? 'none' : 'translateX(28px)', opacity: shown ? 1 : 0,
                  transition: dragging || reducedMotion() ? 'none' : `transform ${DURATION}ms ${EASE}, opacity ${DURATION * 0.8}ms ease` }}>
      <div role="separator" aria-orientation="vertical" aria-label="Resize assistant panel" title="Drag to resize"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={() => setWidth(420)}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'col-resize', zIndex: 3, touchAction: 'none' }} />

      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '14px 12px 10px 16px', borderBottom: '1px solid var(--bd-sm)' }}>
        <span style={{ flex: 1, fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Assistant</span>
        <button onClick={onExpand} aria-label="Open full page" title="Open full page" style={iconBtn}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
        </button>
        <button onClick={onClose} aria-label="Close assistant panel" title="Close" style={iconBtn}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <AssistantChat panel showNewChat />
      </div>
    </aside>
    </div>
  )
}
