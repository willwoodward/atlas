import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import WeeklyReview from '../components/weeklyReview/WeeklyReview.jsx'
import { reviewTarget } from '../lib/weeklyReview.js'
import { useAuth } from './AuthContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Ctx = createContext(null)

/**
 * Opens the weekly review over the whole app and remembers which weeks have
 * been finished. `open()` starts the review for the week it's about now (see
 * reviewTarget); `open(week)` picks a Monday. Mounted inside every other
 * provider, because the review reads from all of them.
 */
export function WeeklyReviewProvider({ children }) {
  const { token } = useAuth()
  const [session, setSession] = useState(null)       // { week } while open
  const [completed, setCompleted] = useState(null)   // Set of week keys; null until loaded

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...opts,
  }), [token])

  useEffect(() => {
    let live = true
    call('/api/weekly-review/completed').then(r => r.ok ? r.json() : { weeks: [] })
      .then(d => live && setCompleted(new Set(d.weeks || []))).catch(() => live && setCompleted(new Set()))
    return () => { live = false }
  }, [call])

  const open = useCallback((week) => setSession({ week: week || reviewTarget().week }), [])
  const close = useCallback(() => setSession(null), [])
  const markComplete = useCallback(async (week) => {
    setCompleted(prev => new Set([...(prev || []), week]))
    await call(`/api/weekly-review/${week}/complete`, { method: 'PUT' })
  }, [call])

  const value = useMemo(() => ({ open, close, completed, markComplete, isOpen: !!session }), [open, close, completed, markComplete, session])
  return (
    <Ctx.Provider value={value}>
      {children}
      {session && <WeeklyReview key={session.week} week={session.week} onClose={close} onComplete={markComplete} />}
    </Ctx.Provider>
  )
}

export const useWeeklyReview = () => useContext(Ctx)
