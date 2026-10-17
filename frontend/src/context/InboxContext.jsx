import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'
import { openShow } from '../lib/focus.js'

// The inbox's counts for the nav badge, and opening an item from outside the
// page: a tapped notification (?inbox=<id> on launch, or a message from the
// service worker when the app is already open).

export const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const POLL_MS = 30000
const EMPTY = { unread: 0, action: 0, running: 0 }

const Ctx = createContext({ counts: EMPTY, reload: () => {} })

export function inboxFetch(token, path, { method = 'GET', body } = {}) {
  return fetch(`${API}/inbox${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => {
    if (!r.ok) {
      let detail = ''
      try { detail = (await r.json()).detail } catch { /* not JSON */ }
      throw new Error(typeof detail === 'string' && detail ? detail : `Inbox error (${r.status})`)
    }
    return r.json()
  })
}

/** The item a notification points at, from its URL. */
export function inboxIdFrom(url) {
  try { return new URL(url, window.location.origin).searchParams.get('inbox') } catch { return null }
}

export function InboxProvider({ children }) {
  const { token } = useAuth()
  const { tick } = useRefresh()
  const [counts, setCounts] = useState(EMPTY)

  const reload = useCallback(async () => {
    if (!token) return
    try { setCounts(await inboxFetch(token, '/counts')) } catch { /* keep the last counts */ }
  }, [token])

  useEffect(() => {
    reload()
    const onShow = () => { if (document.visibilityState === 'visible') reload() }
    const id = setInterval(onShow, POLL_MS)
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onShow) }
  }, [reload, tick])

  // A tapped notification.
  useEffect(() => {
    const id = inboxIdFrom(window.location.href)
    if (id) {
      const url = new URL(window.location.href)
      url.searchParams.delete('inbox')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
      setTimeout(() => openShow({ kind: 'inbox', id }), 200)
    }
    if (!('serviceWorker' in navigator)) return
    const onMessage = e => {
      if (e.data?.type !== 'atlas:open') return
      const target = inboxIdFrom(e.data.url)
      openShow(target ? { kind: 'inbox', id: target } : { kind: 'page', page: 'inbox' })
      reload()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [reload])

  return <Ctx.Provider value={{ counts, setCounts, reload }}>{children}</Ctx.Provider>
}

export const useInbox = () => useContext(Ctx)
