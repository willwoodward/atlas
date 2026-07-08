import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { buildAuthUrl, fetchEvents, toCalendarEvents, insertGcalEvent } from '../integrations/googleCalendar.js'
import { useAuth } from './AuthContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Ctx = createContext(null)

export function IntegrationsProvider({ children }) {
  const { token } = useAuth()
  const [gcalAuth, setGcalAuth] = useState({ token: null, expiresAt: 0 })
  const [gcalEvents, setGcalEvents] = useState([])
  const [gcalLoading, setGcalLoading] = useState(false)
  const [gcalError, setGcalError] = useState(null)
  const [gcalMutatedAt, setGcalMutatedAt] = useState(0)
  const popupRef = useRef(null)

  const isConnected = !!(gcalAuth.token && gcalAuth.expiresAt > Date.now())

  const authHeaders = { Authorization: `Bearer ${token}` }

  // Load integrations from server on mount
  useEffect(() => {
    if (!token) return
    fetch(`${API}/api/integrations`, { headers: authHeaders })
      .then(r => r.json())
      .then(data => {
        if (data.gcal) {
          setGcalAuth({ token: data.gcal.token, expiresAt: data.gcal.expires_at })
        }
      })
      .catch(() => {})
  }, [token]) // eslint-disable-line

  const saveToken = useCallback((gcalToken, expiresAt) => {
    setGcalAuth({ token: gcalToken, expiresAt })
    setGcalError(null)
    fetch(`${API}/api/integrations/gcal`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: gcalToken, expires_at: expiresAt }),
    }).catch(() => {})
  }, [token]) // eslint-disable-line

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
    setGcalAuth({ token: null, expiresAt: 0 })
    setGcalEvents([])
    fetch(`${API}/api/integrations/gcal`, {
      method: 'DELETE',
      headers: authHeaders,
    }).catch(() => {})
  }, [token]) // eslint-disable-line

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
