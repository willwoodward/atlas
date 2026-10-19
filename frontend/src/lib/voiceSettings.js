import { useSyncExternalStore } from 'react'

// Voice input preferences, kept per device.
//   silenceSeconds — stop recording after this long without speech (0 = never)
//   autoSend       — send the transcript straight away instead of putting it
//                    in the box to edit first
//   keepListening  — conversation mode: after Atlas replies, start listening
//                    again. Always sends on a pause, whatever the two above say.
//   speakReplies   — read Atlas's replies aloud: 'dock' (only what you said
//                    to the corner mic, i.e. with the chat closed), 'voice'
//                    (whenever you spoke), 'always' or 'never'
//   ttsVoice       — which OpenAI voice reads them
//   bargeIn        — talking over a reply stops it
//   floatingMic    — the mic button in the corner when no chat is on screen
//   voiceOpensChat — the voice shortcut opens the assistant panel instead of
//                    using the corner mic
//   engine         — 'classic' (the pipeline below) or 'live' (Fast: GPT-Live
//                    listens and talks; Atlas does the work)
//   wakeWord       — listen for "Hey Atlas" on this device (lib/wakeWord)
//   wakeSensitivity — 0..1: higher wakes more easily, and wrongly more often
//   wakeEngine     — which wake word engine ('vosk')

const KEY = 'atlas:voice-settings'
export const VOICE_DEFAULTS = {
  silenceSeconds: 1.5, autoSend: true, keepListening: false,
  speakReplies: 'dock', ttsVoice: 'marin', bargeIn: false,
  floatingMic: true, voiceOpensChat: false,
  engine: 'classic',
  wakeWord: false, wakeSensitivity: 0.5, wakeEngine: 'vosk',
}
// The voices of OpenAI's realtime speech model; marin and cedar sound best.
export const TTS_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']
// A pause this long ends a turn in conversation mode when "stop when I pause" is off.
export const CONVERSATION_SILENCE = 2
// In conversation mode, how long to wait for you to start speaking before
// giving up — long enough to think.
export const CONVERSATION_WAIT = 120

// Only settings you've changed are stored, so a new default reaches you.
// Version 1 stored every setting whenever one changed, so a saved value that
// equals an old default was usually not a choice: those are dropped and the
// current default applies. Version 3 changed the pause (3 s → 1.5 s), the
// voice (coral → marin) and talking over Atlas (on → off).
const VERSION = 3
export function loadVoiceSettings(raw) {
  let saved = {}
  try { saved = JSON.parse(raw || '{}') || {} } catch { /* start afresh */ }
  const v = saved.v || 1
  if (v < 2) delete saved.speakReplies
  if (v < 3) {
    if (saved.silenceSeconds === 3) delete saved.silenceSeconds
    if (saved.bargeIn === true) delete saved.bargeIn
    if (saved.ttsVoice === 'coral' || (saved.ttsVoice && !TTS_VOICES.includes(saved.ttsVoice))) delete saved.ttsVoice
  }
  delete saved.v
  return saved
}

let saved = (() => { try { return loadVoiceSettings(localStorage.getItem(KEY)) } catch { return {} } })()
let current = { ...VOICE_DEFAULTS, ...saved }
const listeners = new Set()

export function setVoiceSettings(patch) {
  saved = { ...saved, ...patch }
  current = { ...VOICE_DEFAULTS, ...saved }
  try { localStorage.setItem(KEY, JSON.stringify({ ...saved, v: VERSION })) } catch { /* this session only */ }
  listeners.forEach(fn => fn())
}

export const getVoiceSettings = () => current

export function useVoiceSettings() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => current)
}
