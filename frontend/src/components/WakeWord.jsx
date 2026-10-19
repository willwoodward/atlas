import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { API } from '../context/InboxContext.jsx'
import { useVoiceSettings } from '../lib/voiceSettings.js'
import { voiceBusy } from '../lib/voiceActivity.js'
import { startWakeWord } from '../lib/wakeWord/index.js'
import { voiceSupported } from '../hooks/useVoiceInput.js'

// "Hey Atlas": while it's on (Assistant settings → Voice, per device), the
// page listens for the wake word on the device and, when it hears it, starts
// the corner mic as if you'd pressed the voice shortcut. It stops while the
// tab is hidden and ignores what it hears during a voice conversation.

// What the settings and the corner mic show: off | loading | waiting (needs a
// tap before audio can start) | listening | error.
let status = { state: 'off', error: null }
const listeners = new Set()
const setStatus = s => { status = { ...status, ...s }; listeners.forEach(fn => fn()) }
export const useWakeStatus = () => useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => status)

// The last few times it woke, for tuning the sensitivity (this device only).
const LOG_KEY = 'atlas:wake-log'
export function wakeLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]') } catch { return [] }
}
function remember(hit) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify([{ at: new Date().toISOString(), ...hit }, ...wakeLog()].slice(0, 20))) } catch { /* not kept */ }
}
export function clearWakeLog() { try { localStorage.removeItem(LOG_KEY) } catch { /* nothing */ } listeners.forEach(fn => fn()) }

// Two wakes this close together are one.
const DEBOUNCE_MS = 3000

function useVisible() {
  return useSyncExternalStore(fn => { document.addEventListener('visibilitychange', fn); return () => document.removeEventListener('visibilitychange', fn) },
    () => document.visibilityState !== 'hidden')
}

export default function WakeWord() {
  const { token } = useAuth()
  const { wakeWord, wakeSensitivity, wakeEngine } = useVoiceSettings()
  const visible = useVisible()
  const last = useRef(0)
  const on = !!(wakeWord && visible && token && voiceSupported())

  useEffect(() => {
    if (!on) { setStatus({ state: wakeWord ? 'paused' : 'off', error: null }); return }
    let handle = null, cancelled = false
    ;(async () => {
      try {
        setStatus({ state: 'loading', error: null })
        const res = await fetch(`${API}/wake/model`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error(`Couldn't get the wake word model (${res.status})`)
        const { url } = await res.json()
        if (cancelled) return
        const h = await startWakeWord(wakeEngine, {
          modelUrl: url.startsWith('http') ? url : `${API}${url}`,
          sensitivity: wakeSensitivity,
          isPaused: () => voiceBusy(),
          onState: state => !cancelled && setStatus({ state }),
          onHeard: hit => {
            const now = Date.now()
            if (cancelled || voiceBusy(now) || now - last.current < DEBOUNCE_MS) return
            last.current = now
            remember(hit)
            // The same as the voice shortcut: the corner mic starts (or the chat's).
            window.dispatchEvent(new CustomEvent('atlas:shortcut', { detail: 'voice' }))
          },
        })
        if (cancelled) h.stop()
        else handle = h
      } catch (e) {
        if (!cancelled) setStatus({ state: 'error', error: e?.message || "The wake word couldn't start." })
      }
    })()
    return () => { cancelled = true; handle?.stop() }
  }, [on, token, wakeEngine, wakeSensitivity]) // eslint-disable-line

  return null
}
