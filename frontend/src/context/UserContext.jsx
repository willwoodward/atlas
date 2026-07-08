import { createContext, useContext } from 'react'
import { useAuth } from './AuthContext.jsx'

const Ctx = createContext(null)

// UserContext is now derived from the authenticated Google account.
// Name and email come from the JWT; no separate API call or localStorage needed.
export function UserProvider({ children }) {
  const { user } = useAuth()

  const profile = { name: user?.name || '', email: user?.email || '' }
  const initial = profile.name.trim() ? profile.name.trim()[0].toUpperCase() : 'A'

  return (
    <Ctx.Provider value={{ profile, initial }}>
      {children}
    </Ctx.Provider>
  )
}

export const useUser = () => useContext(Ctx)
