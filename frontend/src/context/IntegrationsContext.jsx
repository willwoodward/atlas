import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { localDateStr, parseLocalDate, addDays } from '../lib/week.js'
import { buildAuthUrl, fetchEvents, toCalendarEvents, insertGcalEvent, deleteGcalEvent } from '../integrations/googleCalendar.js'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Ctx = createContext(null)

export function IntegrationsProvider({ children }) {
  const { token } = useAuth()
  const [gcalConnected, setGcalConnected] = useState(false)
  // Events cached per fetched week ({ [mondayStr]: events }). Refetches update
  // a week in place, so nothing already on screen flashes a loading state.
  const [gcalWeeks, setGcalWeeks] = useState({})
  const [gcalLoading, setGcalLoading] = useState(false)
  const [gcalError, setGcalError] = useState(null)
  const [gcalMutatedAt, setGcalMutatedAt] = useState(0)
  const popupRef = useRef(null)

  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token])

  // Load connection status + GitHub on mount
  useEffect(() => {
    if (!token) return
    fetch(`${API}/api/integrations`, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.gcal?.connected) setGcalConnected(true)
      })
      .catch(() => {})
  }, [token]) // eslint-disable-line

  // Get a fresh GCal access token from the backend (handles refresh automatically)
  const getAccessToken = useCallback(async () => {
    const r = await fetch(`${API}/auth/gcal/token`, { headers: authHeaders() })
    if (!r.ok) throw new Error(`gcal_token ${r.status}`)
    const { access_token } = await r.json()
    return access_token
  }, [token]) // eslint-disable-line

  const connectGoogle = useCallback(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      alert('Add VITE_GOOGLE_CLIENT_ID=your_id to .env.local, then restart the dev server.')
      return
    }
    const url = buildAuthUrl(clientId, window.location.origin + import.meta.env.BASE_URL)
    const w = 500, h = 640
    const left = window.screenX + (window.outerWidth - w) / 2
    const top  = window.screenY + (window.outerHeight - h) / 2
    popupRef.current = window.open(url, 'atlas_gcal', `width=${w},height=${h},left=${left},top=${top}`)
  }, [])

  const disconnectGoogle = useCallback(() => {
    setGcalConnected(false)
    setGcalWeeks({})
    // Revoke + clear on backend
    fetch(`${API}/auth/gcal`, { method: 'DELETE', headers: authHeaders() }).catch(() => {})
    // Also clear legacy stored token if any
    fetch(`${API}/api/integrations/gcal`, { method: 'DELETE', headers: authHeaders() }).catch(() => {})
  }, [token]) // eslint-disable-line

  // Receive confirmation from OAuth popup
  useEffect(() => {
    const handler = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'ATLAS_OAUTH' && e.data.provider === 'google') {
        setGcalConnected(true)
        setGcalError(null)
        popupRef.current?.close()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const createGcalEvent = useCallback(async (eventData) => {
    if (!gcalConnected) throw new Error('Not connected')
    const accessToken = await getAccessToken()
    const result = await insertGcalEvent(accessToken, eventData)
    setGcalMutatedAt(Date.now())
    return result
  }, [gcalConnected, getAccessToken])

  const removeGcalEvent = useCallback(async (eventId) => {
    if (!gcalConnected) throw new Error('Not connected')
    const accessToken = await getAccessToken()
    await deleteGcalEvent(accessToken, eventId)
    // Sleep events also emit a derived `<id>_wakeup` entry
    const keep = e => e.id !== eventId && e.id !== `${eventId}_wakeup`
    setGcalWeeks(prev => Object.fromEntries(Object.entries(prev).map(([k, evs]) => [k, evs.filter(keep)])))
    setGcalMutatedAt(Date.now())
  }, [gcalConnected, getAccessToken])

  const weeksRef = useRef(gcalWeeks)
  useEffect(() => { weeksRef.current = gcalWeeks }, [gcalWeeks])

  const refetchEvents = useCallback(async (weekStart, weekEnd) => {
    if (!gcalConnected) return
    const key = localDateStr(weekStart)
    // Only a week we've never loaded shows as loading; a cached one revalidates quietly.
    const firstLoad = !(key in weeksRef.current)
    if (firstLoad) setGcalLoading(true)
    setGcalError(null)
    try {
      const accessToken = await getAccessToken()
      const data = await fetchEvents(accessToken, weekStart, weekEnd)
      setGcalWeeks(prev => ({ ...prev, [key]: toCalendarEvents(data.items || []) }))
    } catch (err) {
      setGcalError(err.message)
      if (err.message.includes('401')) setGcalConnected(false)
    } finally {
      if (firstLoad) setGcalLoading(false)
    }
  }, [gcalConnected, getAccessToken])

  // Load several weeks in the background (e.g. the last 12, for goal-time
  // history). Weeks already cached are skipped, and nothing shows as loading.
  // Resolves when they're all in, so the caller can show its own state.
  const loadWeeks = useCallback(async (ranges) => {
    if (!gcalConnected) return
    const todo = ranges.filter(({ weekStart }) => !(localDateStr(weekStart) in weeksRef.current))
    if (todo.length === 0) return
    try {
      const accessToken = await getAccessToken()
      const loaded = await Promise.all(todo.map(async ({ weekStart, weekEnd }) => {
        try {
          const data = await fetchEvents(accessToken, weekStart, weekEnd)
          return [localDateStr(weekStart), toCalendarEvents(data.items || [])]
        } catch { return null }
      }))
      const ok = loaded.filter(Boolean)
      if (ok.length) setGcalWeeks(prev => ({ ...Object.fromEntries(ok), ...prev }))
    } catch { /* not connected any more — the history just shows local events */ }
  }, [gcalConnected, getAccessToken])

  // The assistant can change Google Calendar through its own tools. When it
  // does, the app signals a refresh; reload the weeks we have cached so the
  // calendar on screen shows the change without a page reload. Newest weeks
  // first, capped so a long session doesn't refetch months of history.
  const { tick } = useRefresh()
  const firstTick = useRef(true)
  useEffect(() => {
    if (firstTick.current) { firstTick.current = false; return }
    if (!gcalConnected) return
    let cancelled = false
    ;(async () => {
      try {
        const accessToken = await getAccessToken()
        const keys = Object.keys(weeksRef.current).sort().reverse().slice(0, 8)
        const loaded = await Promise.all(keys.map(async key => {
          const start = parseLocalDate(key)
          const end = addDays(start, 6); end.setHours(23, 59, 59, 999)
          try { return [key, toCalendarEvents((await fetchEvents(accessToken, start, end)).items || [])] } catch { return null }
        }))
        const ok = loaded.filter(Boolean)
        if (!cancelled && ok.length) {
          setGcalWeeks(prev => ({ ...prev, ...Object.fromEntries(ok) }))
          setGcalMutatedAt(Date.now())
        }
      } catch { /* token gone — the next normal load will surface it */ }
    })()
    return () => { cancelled = true }
  }, [tick]) // eslint-disable-line

  // Every consumer filters by date, so the union of cached weeks works as-is.
  // A sleep event's wake-up hint can land in the next week's cache too — dedupe.
  const gcalEvents = useMemo(() => {
    const seen = new Set()
    return Object.values(gcalWeeks).flat().filter(e => {
      const k = `${e.id}|${e.date}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [gcalWeeks])

  return (
    <Ctx.Provider value={{
      gcal: {
        connected: gcalConnected,
        loading: gcalLoading,
        error: gcalError,
        events: gcalEvents,
        mutatedAt: gcalMutatedAt,
      },
      connectGoogle,
      disconnectGoogle,
      refetchEvents,
      loadWeeks,
      createGcalEvent,
      removeGcalEvent,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useIntegrations = () => useContext(Ctx)
