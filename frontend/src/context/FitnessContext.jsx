import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function uid() { return crypto.randomUUID() }

const Ctx = createContext(null)

/**
 * Fitness: the gym log (stored here) and Strava (read live, never stored).
 *
 * Strava data is only ever held in React state for as long as the page is open.
 * It is deliberately kept out of localStorage too: Strava's terms cap retention
 * at a transient cache, and a browser store outlives the session indefinitely.
 */
export function FitnessProvider({ children }) {
  const { token } = useAuth()
  const { tick } = useRefresh()
  const [sections, setSections] = useState([])
  const [strava, setStrava] = useState({ configured: false, connected: false })
  const [summary, setSummary] = useState(null)
  const [stravaError, setStravaError] = useState('')
  const [loadingSummary, setLoadingSummary] = useState(false)

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  // ─── Gym ───────────────────────────────────────────────────────────────────
  const refreshGym = useCallback(async () => {
    const res = await call('/api/fitness/gym')
    if (res.ok) setSections((await res.json()).sections)
  }, [call])

  const mutateGym = useCallback(async (path, method, body) => {
    await call(path, { method, body: body ? JSON.stringify(body) : undefined })
    await refreshGym()
  }, [call, refreshGym])

  const addSection = useCallback((name, color) =>
    mutateGym('/api/fitness/gym/sections', 'POST', { id: uid(), name, color }), [mutateGym])
  const renameSection = useCallback((id, name) =>
    mutateGym(`/api/fitness/gym/sections/${id}`, 'PATCH', { name }), [mutateGym])
  const removeSection = useCallback((id) =>
    mutateGym(`/api/fitness/gym/sections/${id}`, 'DELETE'), [mutateGym])
  const addExercise = useCallback((sectionId, fields) =>
    mutateGym(`/api/fitness/gym/sections/${sectionId}/exercises`, 'POST', { id: uid(), ...fields }), [mutateGym])
  const updateExercise = useCallback((id, fields) =>
    mutateGym(`/api/fitness/gym/exercises/${id}`, 'PATCH', fields), [mutateGym])
  const removeExercise = useCallback((id) =>
    mutateGym(`/api/fitness/gym/exercises/${id}`, 'DELETE'), [mutateGym])

  // ─── Strava ────────────────────────────────────────────────────────────────
  const refreshStrava = useCallback(async () => {
    const res = await call('/api/fitness/strava/status')
    if (!res.ok) return
    const status = await res.json()
    setStrava(status)
    if (!status.connected) { setSummary(null); return }

    setLoadingSummary(true)
    try {
      const r = await call('/api/fitness/strava/summary?weeks=12')
      const body = await r.json()
      if (r.ok) { setSummary(body); setStravaError('') }
      else {
        setStravaError(body.detail || 'Could not load Strava.')
        // Revoked on Strava's side: the server has already forgotten it.
        if (body.code === 'revoked' || body.code === 'not_connected') {
          setStrava(s => ({ ...s, connected: false })); setSummary(null)
        }
      }
    } finally {
      setLoadingSummary(false)
    }
  }, [call])

  const connectStrava = useCallback(async () => {
    setStravaError('')
    const redirectUri = window.location.origin + (import.meta.env.BASE_URL || '/')
    const res = await call('/api/fitness/strava/authorize', {
      method: 'POST', body: JSON.stringify({ redirect_uri: redirectUri }),
    })
    const body = await res.json()
    if (!res.ok) { setStravaError(body.detail || 'Could not start Strava sign-in.'); return }
    window.open(body.url, 'strava-auth', 'width=520,height=720')
  }, [call])

  const disconnectStrava = useCallback(async () => {
    await call('/api/fitness/strava', { method: 'DELETE' })
    setSummary(null)
    await refreshStrava()
  }, [call, refreshStrava])

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'ATLAS_OAUTH' || e.data.provider !== 'strava') return
      if (e.data.connected) refreshStrava()
      else setStravaError(e.data.error || 'Strava sign-in failed.')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [refreshStrava])

  useEffect(() => {
    if (!token) return
    refreshGym()
    refreshStrava()
  }, [token, tick, refreshGym, refreshStrava])

  return (
    <Ctx.Provider value={{
      sections, addSection, renameSection, removeSection,
      addExercise, updateExercise, removeExercise,
      strava, summary, stravaError, loadingSummary,
      connectStrava, disconnectStrava, refreshStrava,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useFitness = () => useContext(Ctx)
