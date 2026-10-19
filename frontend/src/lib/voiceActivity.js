import { useEffect } from 'react'
import { speech } from './speech.js'

// Whether a voice conversation is going on: you're being recorded, Atlas is
// speaking (or about to), or a fast-voice session is open. The wake word
// ("Hey Atlas") ignores what it hears while this is true, and for a moment
// after, so Atlas saying its own name can't wake it.

const holds = new Set()
let quietSince = Date.now()
export const AFTER_VOICE_MS = 1500

function changed() { if (!holds.size) quietSince = Date.now() }

/** Mark voice as busy until the returned function is called. */
export function holdVoice(tag = 'voice') {
  const token = Symbol(tag)
  holds.add(token)
  return () => { if (holds.delete(token)) changed() }
}

/** Busy while `active` is true (a React hook). */
export function useVoiceHold(active, tag) {
  useEffect(() => (active ? holdVoice(tag) : undefined), [active, tag])
}

export function voiceBusy(now = Date.now()) {
  if (holds.size || speech.pending) return true
  return now - quietSince < AFTER_VOICE_MS
}

// Speech ending counts as the end of being busy, for the quiet period.
speech.subscribe?.(() => { if (!speech.pending && !holds.size) quietSince = Date.now() })
