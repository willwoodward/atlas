// The wake word: "Hey Atlas" heard on the device, without any audio leaving
// it, then the corner mic starts as if you'd tapped it.
//
// Engines are swappable. Each is a module exporting
//   start({ phrases, sensitivity, onHeard, onState, apiFetch }) → { stop() }
// that calls onHeard({ text, confidence }) when it hears one of the phrases,
// and onState('loading' | 'listening' | 'error', detail) as it goes.
//   vosk    a small speech recogniser (vosk-browser) limited to the phrases.
//           Works with no training; heavier, and more false wake-ups.
// Planned: openwakeword (a trained "Hey Atlas" model; lighter, more
// accurate), porcupine (Picovoice, needs an account key).

export const ENGINES = {
  vosk: { label: 'Vosk (on this device)', load: () => import('./vosk.js') },
}

// What counts as the wake word. "atlas" on its own too: "hey" is often lost.
export const PHRASES = ['hey atlas', 'atlas']

/**
 * Was this recognised utterance the wake word, confidently enough?
 *
 * The recogniser only knows the wake phrases (everything else comes out as
 * "[unk]"), so it maps sound-alikes onto them: "at last" and "a lot less"
 * both come out as "atlas". Said on purpose, the wake word is short and at the
 * start ("Hey Atlas", "Atlas, …", "OK Atlas"), and said once; a sound-alike
 * is usually mid-sentence or comes twice. So: one "atlas", near the start, in
 * a short utterance, and confident enough for the sensitivity.
 */
export function matchWake(result, sensitivity = 0.5) {
  const text = (result?.text || '').toLowerCase().trim()
  const tokens = text.split(/\s+/).filter(Boolean)
  const at = tokens.indexOf('atlas')
  if (at < 0) return null
  if (tokens.filter(t => t === 'atlas').length > 1) return null
  // Allowed before it: nothing, "hey", or one unknown word ("ok", "right").
  const before = tokens.slice(0, at)
  if (before.length > 1 || (before.length === 1 && !['hey', '[unk]'].includes(before[0]))) return null
  if (tokens.length > 4) return null
  const words = result?.result || []
  const atlas = words.filter(w => w.word === 'atlas')
  const conf = atlas.length ? Math.max(...atlas.map(w => w.conf ?? 1)) : 1
  const needed = 1 - sensitivity * 0.6          // 0 → 1.0, 0.5 → 0.7, 1 → 0.4
  return conf >= needed ? { text, confidence: conf } : null
}

/** Start an engine. Returns a promise of { stop() }. */
export async function startWakeWord(engine, opts) {
  const e = ENGINES[engine] || ENGINES.vosk
  const mod = await e.load()
  return mod.start(opts)
}
