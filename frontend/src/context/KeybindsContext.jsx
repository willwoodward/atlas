import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ALL_SHORTCUTS, comboFromEvent } from '../lib/keybinds.js'

// Holds the current bindings and listens for them. A matched shortcut is
// announced as a window event — `atlas:shortcut` with the action id as
// `detail` — so whatever owns the action (the layout, the assistant) can
// handle it without this knowing about them.

const STORE_KEY = 'atlas:keybinds'
const defaults = () => Object.fromEntries(ALL_SHORTCUTS.map(s => [s.id, s.default]))

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    return { ...defaults(), ...saved }
  } catch {
    return defaults()
  }
}

export const onShortcut = (id, fn) => {
  const handler = e => { if (e.detail === id) fn() }
  window.addEventListener('atlas:shortcut', handler)
  return () => window.removeEventListener('atlas:shortcut', handler)
}

const Ctx = createContext(null)

export function KeybindsProvider({ children }) {
  const [bindings, setBindings] = useState(load)
  // While the Settings page is waiting for a new combo, shortcuts don't fire.
  const capturing = useRef(false)

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(bindings)) } catch { /* per session only */ }
  }, [bindings])

  useEffect(() => {
    const onKey = e => {
      if (capturing.current || e.repeat) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const action = Object.keys(bindings).find(id => bindings[id] && bindings[id] === combo)
      if (!action) return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('atlas:shortcut', { detail: action }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bindings])

  const setBinding = useCallback((id, combo) => {
    setBindings(prev => {
      // A combo can only do one thing: taking it clears it from the other action.
      const next = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v === combo && k !== id ? '' : v]))
      return { ...next, [id]: combo }
    })
  }, [])
  const resetBinding = useCallback(id => setBinding(id, defaults()[id]), [setBinding])
  const setCapturing = useCallback(v => { capturing.current = v }, [])

  return (
    <Ctx.Provider value={{ bindings, setBinding, resetBinding, setCapturing }}>
      {children}
    </Ctx.Provider>
  )
}

export const useKeybinds = () => useContext(Ctx)
