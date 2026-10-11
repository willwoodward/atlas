import { createContext, useContext, useState, useEffect, useCallback } from 'react'

// Explicit override only — absent means "follow the system". (Older builds wrote
// 'light' to `atlas:theme` unconditionally, so that key is ignored.)
const KEY = 'atlas:theme-override'
const Ctx = createContext(null)

const media = window.matchMedia('(prefers-color-scheme: dark)')
const systemTheme = () => media.matches ? 'dark' : 'light'

export function ThemeProvider({ children }) {
  const [override, setOverride] = useState(() => localStorage.getItem(KEY))
  const [system, setSystem] = useState(systemTheme)
  const theme = override || system

  useEffect(() => {
    const onChange = () => setSystem(systemTheme())
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.style.colorScheme = theme
    // Keep the PWA title bar / browser chrome in sync with the app background
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove())
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = bg
    document.head.appendChild(meta)
  }, [theme])

  // Toggling back to whatever the system uses clears the override,
  // so the app resumes following the system setting.
  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    if (next === system) { localStorage.removeItem(KEY); setOverride(null) }
    else { localStorage.setItem(KEY, next); setOverride(next) }
  }, [theme, system])

  return <Ctx.Provider value={{ theme, isDark: theme === 'dark', toggleTheme }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
