import { useEffect, useRef, useState, useCallback } from 'react'
import { useIsMobile } from '../hooks/useIsMobile.js'

// The app's one drawer / dialog.
//
// Phone: a bottom sheet that slides up, with a grab handle. Drag the handle
// (or the header) down and it follows your finger; let go past a third of the
// way, or flick, and it closes — otherwise it springs back.
// Laptop / desktop: a centred dialog that fades in, never taller than the
// window (the header stays put and the content scrolls).
// Both: Escape, the backdrop and the ✕ close it, with the exit animated.
//
// `children` may be a function, called with `close`, for content that wants
// to dismiss the sheet with the animation (e.g. after saving).

const EASE = 'cubic-bezier(.32,.72,0,1)' // the iOS sheet curve
const DURATION = 280

export default function Sheet({
  title, onClose, children,
  width = 440,          // desktop dialog width
  height,               // fixed height (e.g. '82vh'); default fits content
  headerExtra,          // controls shown beside the title (before ✕)
  accent,               // colour strip across the top (calendar events)
  bodyPadding,          // override the content padding
  ariaLabel,
}) {
  const isMobile = useIsMobile()
  const [shown, setShown] = useState(false)   // drives the enter/exit transition
  const [drag, setDrag] = useState(0)         // px dragged down (phone)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const closingRef = useRef(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    // Focus the dialog for Escape/screen readers, unless a field inside
    // already took focus (autoFocus) — don't steal it.
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus({ preventScroll: true })
    return () => cancelAnimationFrame(id)
  }, [])

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setDragging(false)
    setShown(false)
    setTimeout(onClose, DURATION)
  }, [onClose])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  // ── Drag to dismiss (phone) ──
  const onPointerDown = (e) => {
    if (!isMobile || e.target.closest('button, a, input, select, textarea')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { y: e.clientY, t: performance.now(), lastY: e.clientY, lastT: performance.now(), v: 0 }
    setDragging(true)
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dy = e.clientY - d.y
    const now = performance.now()
    d.v = (e.clientY - d.lastY) / Math.max(now - d.lastT, 1) // px/ms, for flicks
    d.lastY = e.clientY; d.lastT = now
    // Down follows the finger; up resists, like iOS.
    setDrag(dy > 0 ? dy : dy / 6)
  }
  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    const h = panelRef.current?.offsetHeight || 400
    if (drag > h / 3 || (d.v > 0.6 && drag > 20)) close()
    else { setDragging(false); setDrag(0) }
  }

  const transition = dragging ? 'none' : `transform ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}`
  const panelH = panelRef.current?.offsetHeight || 600
  const backdropOpacity = shown ? Math.max(0, 1 - Math.max(drag, 0) / panelH) : 0

  const panelStyle = isMobile
    ? {
        width: '100%', maxHeight: 'calc(100dvh - 24px)', height,
        borderRadius: '20px 20px 0 0',
        transform: shown ? `translateY(${Math.max(drag, -24)}px)` : 'translateY(100%)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }
    : {
        width, maxWidth: 'calc(100vw - 32px)',
        // Fits a 13" laptop: never taller than the window, whatever `height` asks for.
        height: height ? `min(${height}, calc(100dvh - 48px))` : undefined,
        maxHeight: 'calc(100dvh - 48px)',
        borderRadius: 20,
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(12px) scale(.98)',
      }

  return (
    <div onClick={e => e.target === e.currentTarget && close()}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex', justifyContent: 'center',
        alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 24,
        background: `rgba(20,18,15,${0.42 * backdropOpacity})`,
        transition: dragging ? 'none' : `background ${DURATION}ms ${EASE}`,
      }}>
      <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}
        aria-label={ariaLabel || (typeof title === 'string' ? title : undefined)}
        style={{
          // Sheets open from all sorts of places (e.g. the centred empty chat);
          // they shouldn't inherit the opener's text alignment.
          textAlign: 'left',
          background: 'var(--surface)', boxShadow: '0 24px 60px rgba(0,0,0,.24)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none',
          boxSizing: 'border-box', transition, ...panelStyle,
        }}>
        {accent && <div style={{ height: 5, background: accent, flex: 'none' }} />}

        {/* Grab handle + header: the drag target on a phone */}
        <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          style={{ flex: 'none', touchAction: isMobile ? 'none' : 'auto', cursor: isMobile ? 'grab' : 'default' }}>
          {isMobile && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px' }}>
              <div style={{ width: 38, height: 5, borderRadius: 99, background: 'var(--bd-xl)' }} />
            </div>
          )}
          {(title || headerExtra) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '10px 18px 12px' : '24px 28px 14px' }}>
              <div style={{ flex: 1, minWidth: 0, margin: 0, fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25 }}>{title}</div>
              {headerExtra}
              <button onClick={close} aria-label="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 20, lineHeight: 1, padding: 4, flex: 'none' }}>×</button>
            </div>
          )}
        </div>

        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain',
          display: 'flex', flexDirection: 'column',
          padding: bodyPadding ?? (isMobile ? '0 18px 22px' : '0 28px 28px'),
        }}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      </div>
    </div>
  )
}
