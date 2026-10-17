import { useSyncExternalStore } from 'react'

// Assistant preferences kept on this device.
//   followAlong — when Atlas changes something, open it so you see the change
//                 (desktop; on a phone that would pull you out of the chat)

const KEY = 'atlas:assistant-prefs'
const DEFAULTS = { followAlong: true }

let current = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
})()
const listeners = new Set()

export function setAssistantPrefs(patch) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* this session only */ }
  listeners.forEach(fn => fn())
}
export const getAssistantPrefs = () => current
export const useAssistantPrefs = () =>
  useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => current)
