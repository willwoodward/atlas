import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useFinances } from '../../context/FinancesContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * A week's recap from the server: figures and observations per section.
 * `reload()` fetches it again without clearing what's on screen, for after you
 * change something (tick a habit, import a statement).
 *
 * The commentary is written by the model and takes a few seconds, so it is a
 * separate request: `narrative` is null until it arrives, and `false` if it
 * couldn't be had (the screens then show the plain observations alone).
 */
export function useRecap(week) {
  const { token } = useAuth()
  const { displayCurrency } = useFinances()
  const [recap, setRecap] = useState(null)
  const [error, setError] = useState('')
  const [narrative, setNarrative] = useState(null)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...opts,
  }), [token])

  const reload = useCallback(async () => {
    try {
      const r = await call(`/api/weekly-review/${week}?currency=${displayCurrency}`)
      if (!r.ok) throw new Error(`The server said ${r.status}`)
      const data = await r.json()
      if (live.current) { setRecap(data); setError('') }
      return data
    } catch (e) {
      if (live.current) setError(e.message || 'Could not load the week')
      return null
    }
  }, [call, week, displayCurrency])

  useEffect(() => { reload() }, [reload])

  const narrate = useCallback(async (goalHours = [], refresh = false) => {
    setNarrative(null)
    try {
      const r = await call(`/api/weekly-review/${week}/narrate`, {
        method: 'POST', body: JSON.stringify({ currency: displayCurrency, refresh, goal_hours: goalHours }),
      })
      if (!r.ok) throw new Error()
      const data = await r.json()
      if (live.current) setNarrative(data)
    } catch {
      if (live.current) setNarrative(false)
    }
  }, [call, week, displayCurrency])

  return { recap, error, reload, narrative, narrate }
}
