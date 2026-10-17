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
