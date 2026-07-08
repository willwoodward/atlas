import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const Ctx = createContext(null)
const JWT_KEY = 'atlas:jwt'
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function decodeJwt(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload
  } catch {
    return null
  }
}

function loadStored() {
  try {
    const token = localStorage.getItem(JWT_KEY)
    if (!token) return null
    const payload = decodeJwt(token)
    if (!payload || payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(JWT_KEY)
      return null
    }
    return { token, email: payload.sub, name: payload.name || '' }
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(loadStored)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const popupRef = useRef(null)

  const loginWithGoogle = useCallback(() => {
    if (!CLIENT_ID) {
      setError('VITE_GOOGLE_CLIENT_ID is not set')
      return
    }
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: window.location.origin,
      response_type: 'token',
      scope: 'openid email profile',
      state: 'atlas-auth',
    })
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
    const w = 520, h = 600
    const left = window.screenX + (window.outerWidth - w) / 2
    const top = window.screenY + (window.outerHeight - h) / 2
    popupRef.current = window.open(url, 'atlas-auth', `width=${w},height=${h},left=${left},top=${top}`)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(JWT_KEY)
    setAuth(null)
  }, [])

  // Listen for the postMessage from the popup
  useEffect(() => {
    const handler = async (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'ATLAS_AUTH') return

      const { access_token } = e.data
      try {
        const res = await fetch(`${API}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token }),
        })
        if (!res.ok) {
          const err = await res.json()
          setError(err.detail || 'Login failed')
          setLoading(false)
          return
        }
        const { token, email, name } = await res.json()
        localStorage.setItem(JWT_KEY, token)
        setAuth({ token, email, name })
        setError(null)
      } catch {
        setError('Could not reach the server')
      } finally {
        setLoading(false)
        popupRef.current?.close()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <Ctx.Provider value={{
      token: auth?.token ?? null,
      user: auth ? { email: auth.email, name: auth.name } : null,
      isAuthenticated: !!auth,
      loading,
      error,
      loginWithGoogle,
      logout,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
