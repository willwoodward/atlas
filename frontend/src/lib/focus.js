import { useEffect, useRef } from 'react'

// "Show me this item": how search opens a result. The layout switches page,
// then the page — mounted fresh or already open — gets the target and does
// what showing it means there (open the note, jump to the event's week…).
//
// A request waits here until a page claims it, because the page usually
// mounts after the request is made.

let pending = null

export function requestFocus(target) {
  pending = target
  window.dispatchEvent(new CustomEvent('atlas:focus', { detail: target }))
}

/** Handle focus requests of the given kinds while this page is mounted. */
export function useFocusRequest(kinds, handler) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const key = kinds.join(',')
  useEffect(() => {
    const take = t => {
      if (!t || !key.split(',').includes(t.kind)) return
      pending = null
      // Let the page render its data first.
      setTimeout(() => handlerRef.current(t), 0)
    }
    take(pending)
    const onFocus = e => take(e.detail)
    window.addEventListener('atlas:focus', onFocus)
    return () => window.removeEventListener('atlas:focus', onFocus)
  }, [key])
}

/**
 * Scroll an element into view and pulse a highlight on it. Waits a little for
 * it to appear (the page may still be rendering).
 */
export function flash(selector, { tries = 20 } = {}) {
  const el = document.querySelector(selector)
  if (!el) {
    if (tries > 0) setTimeout(() => flash(selector, { tries: tries - 1 }), 75)
    return
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove('search-flash')
  void el.offsetWidth // restart the animation
  el.classList.add('search-flash')
  setTimeout(() => el.classList.remove('search-flash'), 2000)
}

/**
 * Where a "show" (from a tool result or a chat card) leads: the page to open
 * and the focus target to hand it. `null` target just opens the page.
 */
export function showTarget(show) {
  switch (show?.kind) {
    case 'todo':     return { page: 'todos', target: { kind: 'todo', id: show.id } }
    case 'goal':     return { page: 'goals', target: { kind: 'goal', id: show.id } }
    case 'habit':    return { page: 'habits', target: { kind: 'habit', id: show.id } }
    case 'note':     return { page: 'notes', target: { kind: 'note', id: show.id } }
    case 'github':   return { page: 'notes', target: { kind: 'github', path: show.path } }
    case 'event':    return show.date ? { page: 'calendar', target: { kind: 'event', id: show.id, date: show.date } } : { page: 'calendar', target: null }
    case 'calendar': return { page: 'calendar', target: show.date ? { kind: 'calendar', date: show.date } : null }
    case 'finances': return { page: 'finances', target: { kind: 'finances', category: show.category, range: show.range, type: show.type } }
    case 'inbox':    return { page: 'inbox', target: show.id ? { kind: 'inbox', id: show.id } : null }
    case 'routine':  return { page: 'inbox', target: { kind: 'routine', id: show.id } }
    case 'page':     return { page: show.page, target: null }
    default:         return null
  }
}

/** Ask the layout to open something (card "Open" buttons use this). */
export function openShow(show) {
  window.dispatchEvent(new CustomEvent('atlas:show', { detail: { ...show, explicit: true } }))
}
