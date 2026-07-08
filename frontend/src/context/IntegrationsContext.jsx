import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { buildAuthUrl, fetchEvents, toCalendarEvents, insertGcalEvent } from '../integrations/googleCalendar.js'

const GCAL_KEY = 'atlas:gcal:v1'

function loadGcal() {
  try {
    const raw = localStorage.getItem(GCAL_KEY)
    return raw ? JSON.parse(raw) : { token: null, expiresAt: 0 }
  } catch {
    return { token: null, expiresAt: 0 }
  }
}

const Ctx = createContext(null)

export function IntegrationsProvider({ children }) {
  const [gcalAuth, setGcalAuth] = useState(loadGcal)
  const [gcalEvents, setGcalEvents] = useState([])
  const [gcalLoading, setGcalLoading] = useState(false)
  const [gcalError, setGcalError] = useState(null)
  const [gcalMutatedAt, setGcalMutatedAt] = useState(0)
  const popupRef = useRef(null)

  const isConnected = !!(gcalAuth.token && gcalAuth.expiresAt > Date.now())

  const saveToken = useCallback((token, expiresAt) => {
    const next = { token, expiresAt }
    localStorage.setItem(GCAL_KEY, JSON.stringify(next))
    setGcalAuth(next)
    setGcalError(null)
  }, [])

  const connectGoogle = useCallback(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      alert('Add VITE_GOOGLE_CLIENT_ID=your_id to .env.local, then restart the dev server.')
      return
    }
    const url = buildAuthUrl(clientId, window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, ''))
    const w = 500, h = 640
    const left = window.screenX + (window.outerWidth - w) / 2
    const top  = window.screenY + (window.outerHeight - h) / 2
    popupRef.current = window.open(url, 'atlas_gcal', `width=${w},height=${h},left=${left},top=${top}`)
  }, [])

  const disconnectGoogle = useCallback(() => {
    localStorage.removeItem(GCAL_KEY)
    setGcalAuth({ token: null, expiresAt: 0 })
    setGcalEvents([])
  }, [])

  // Receive token from OAuth popup
  useEffect(() => {
    const handler = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'ATLAS_OAUTH' && e.data.provider === 'google') {
        saveToken(e.data.token, e.data.expiresAt)
        popupRef.current?.close()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [saveToken])

  const createGcalEvent = useCallback(async (eventData) => {
    if (!isConnected) throw new Error('Not connected')
    const result = await insertGcalEvent(gcalAuth.token, eventData)
    setGcalMutatedAt(Date.now())
    return result
  }, [isConnected, gcalAuth.token])

  const refetchEvents = useCallback(async (weekStart, weekEnd) => {
    if (!isConnected) return
    setGcalLoading(true)
    setGcalError(null)
    try {
      const data = await fetchEvents(gcalAuth.token, weekStart, weekEnd)
      setGcalEvents(toCalendarEvents(data.items || []))
    } catch (err) {
      setGcalError(err.message)
      if (err.message.includes('401')) disconnectGoogle()
    } finally {
      setGcalLoading(false)
    }
  }, [isConnected, gcalAuth.token, disconnectGoogle])

  return (
    <Ctx.Provider value={{
      gcal: {
        connected: isConnected,
        loading: gcalLoading,
        error: gcalError,
        events: gcalEvents,
        mutatedAt: gcalMutatedAt,
      },
      connectGoogle,
      disconnectGoogle,
      refetchEvents,
      createGcalEvent,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useIntegrations = () => useContext(Ctx)
