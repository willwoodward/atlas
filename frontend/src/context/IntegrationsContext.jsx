import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { buildAuthUrl, fetchEvents, toCalendarEvents, insertGcalEvent } from '../integrations/googleCalendar.js'
import { useAuth } from './AuthContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Ctx = createContext(null)

export function IntegrationsProvider({ children }) {
  const { token } = useAuth()
  const [gcalConnected, setGcalConnected] = useState(false)
  const [gcalEvents, setGcalEvents] = useState([])
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
    setGcalEvents([])
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

  const refetchEvents = useCallback(async (weekStart, weekEnd) => {
    if (!gcalConnected) return
    setGcalLoading(true)
    setGcalError(null)
    try {
      const accessToken = await getAccessToken()
      const data = await fetchEvents(accessToken, weekStart, weekEnd)
      setGcalEvents(toCalendarEvents(data.items || []))
    } catch (err) {
      setGcalError(err.message)
      if (err.message.includes('401')) setGcalConnected(false)
    } finally {
      setGcalLoading(false)
    }
  }, [gcalConnected, getAccessToken])

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
      createGcalEvent,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useIntegrations = () => useContext(Ctx)
