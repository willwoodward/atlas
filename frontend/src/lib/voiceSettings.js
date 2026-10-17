import { useSyncExternalStore } from 'react'

// Voice input preferences, kept per device.
//   silenceSeconds — stop recording after this long without speech (0 = never)
//   autoSend       — send the transcript straight away instead of putting it
//                    in the box to edit first
//   keepListening  — conversation mode: after Atlas replies, start listening
//                    again. Always sends on a pause, whatever the two above say.

const KEY = 'atlas:voice-settings'
export const VOICE_DEFAULTS = { silenceSeconds: 3, autoSend: true, keepListening: false }
// A pause this long ends a turn in conversation mode when "stop when I pause" is off.
export const CONVERSATION_SILENCE = 3
// In conversation mode, how long to wait for you to start speaking before
// giving up — long enough to think.
export const CONVERSATION_WAIT = 120

let current = (() => {
  try { return { ...VOICE_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...VOICE_DEFAULTS } }
})()
const listeners = new Set()

export function setVoiceSettings(patch) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* this session only */ }
  listeners.forEach(fn => fn())
}

export const getVoiceSettings = () => current

export function useVoiceSettings() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => current)
}
