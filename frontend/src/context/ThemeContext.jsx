import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const KEY = 'atlas:theme'
const Ctx = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(KEY) || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => setTheme(t => t === 'light' ? 'dark' : 'light'), [])

  return <Ctx.Provider value={{ theme, isDark: theme === 'dark', toggleTheme }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
