import { useSyncExternalStore } from 'react'
import { getVoiceSettings } from './voiceSettings.js'

// Spoken replies. As a reply streams in, it is cut into sentences, each sent
// to the API's /assistant/speak (OpenAI text-to-speech) as soon as it's
// complete, and the clips play in order — so Atlas starts talking after the
// first sentence rather than at the end of the reply.

// After the first clip, wait for this much text before sending the next:
// fewer requests, and longer clips sound more natural.
const CHUNK_CHARS = 140
// A run-on with no sentence break is cut at a space after this long.
const RUN_ON_CHARS = 500

const fenceOpen = s => ((s.match(/```/g) || []).length % 2) === 1

/**
 * Take the complete pieces off the front of a streaming reply.
 * `first`: nothing has been spoken yet, so send the first sentence alone.
 * `final`: the reply has ended, so whatever is left goes too.
 */
export function splitSpeech(buf, { final = false, first = false } = {}) {
  const chunks = []
  let rest = buf
  let isFirst = first
  for (;;) {
    const min = isFirst ? 1 : CHUNK_CHARS
    let cut = -1
    const re = /[.!?…]+["'”’)\]]*\s+|\n+/g
    let m
    while ((m = re.exec(rest))) {
      const end = m.index + m[0].length
      const cand = rest.slice(0, end)
      if (fenceOpen(cand)) continue
      if (cand.trim().length >= min) { cut = end; break }
    }
    if (cut < 0 && !final && rest.length > RUN_ON_CHARS && !fenceOpen(rest)) {
      const sp = rest.lastIndexOf(' ', RUN_ON_CHARS)
      if (sp > 0) cut = sp + 1
    }
    if (cut < 0) {
      if (final && rest.trim()) { chunks.push(rest); rest = '' }
      break
    }
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
    isFirst = false
  }
  return { chunks, rest }
}

/** Markdown → what to say: no code, tables, links, markers or emoji. */
export function speakable(md) {
  let s = (md || '')
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .replace(/^\s*\|.*\|?\s*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,!?:;]|$)/gm, '$1$2')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
  // A list item or heading ends with a pause, not a run into the next line.
  s = s.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => (/[.!?:;,…]["'”’)]*$/.test(l) ? l : l + '.')).join(' ')
  return s.replace(/\s+/g, ' ').trim()
}

const words = s => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean)

/**
 * Whether what the mic heard is just Atlas's own voice coming back through
 * the speakers. Three-word runs are compared, so a short answer like "yes"
 * is never mistaken for echo even if Atlas said "yes" too.
 */
export function isEcho(heard, spoken) {
  const h = words(heard), s = words(spoken)
  if (h.length < 3 || s.length < 3) return false
  const grams = new Set()
  for (let i = 0; i + 2 < s.length; i++) grams.add(s.slice(i, i + 3).join(' '))
  let hit = 0, total = 0
  for (let i = 0; i + 2 < h.length; i++) { total++; if (grams.has(h.slice(i, i + 3).join(' '))) hit++ }
  return hit / total >= 0.5
}

// ── The player ───────────────────────────────────────────────────────────────

// One audio element for everything: iOS only lets a page play sound from an
// element that first played during a tap, so it is "unlocked" on the mic or
// send button (unlockAudio) and reused.
let audio = null
const el = () => {
  if (!audio && typeof Audio !== 'undefined') { audio = new Audio(); audio.preload = 'auto' }
  return audio
}

// A tenth of a second of silence, as a WAV, built rather than embedded.
let silence = null
function silentWav() {
  if (silence) return silence
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * 2, true)
  let bin = ''
  new Uint8Array(buf).forEach(b => { bin += String.fromCharCode(b) })
  silence = `data:audio/wav;base64,${btoa(bin)}`
  return silence
}

/** Call from a tap or key press, before anything is spoken. */
export function unlockAudio() {
  const a = el()
  if (!a || a.dataset?.unlocked || speech.speaking) return
  try {
    a.src = silentWav()
    a.play()?.then(() => { if (a.dataset) a.dataset.unlocked = '1' }).catch(() => {})
  } catch { /* nothing to unlock */ }
}

let fetchClip = null          // text → Promise<Blob>, set by the assistant context
let utterance = null          // the run being spoken, while its text still streams
let buffer = ''
let firstPending = true
let clips = []                // [{ text, url: Promise<string|null> }]
let playing = false
let gen = 0
let endPlay = null
let recent = ''               // what was said lately, for the echo check
let lastActive = 0
const listeners = new Set()
let snapshot = { speaking: false }
const notify = () => {
  const speaking = playing || clips.length > 0
  if (speaking) lastActive = Date.now()
  if (speaking !== snapshot.speaking) { snapshot = { speaking }; listeners.forEach(fn => fn()) }
}

function enqueue(text) {
  if (!text || !fetchClip) return
  const url = fetchClip(text).then(b => URL.createObjectURL(b)).catch(() => null)
  clips.push({ text, url })
  notify()
  if (!playing) play()
}

function flush(final) {
  const { chunks, rest } = splitSpeech(buffer, { final, first: firstPending })
  buffer = rest
  for (const c of chunks) {
    const text = speakable(c)
    if (text) { enqueue(text); firstPending = false }
  }
}

async function play() {
  playing = true
  const mine = gen
  notify()
  while (clips.length && mine === gen) {
    const clip = clips[0]
    const url = await clip.url
    if (mine !== gen) { if (url) URL.revokeObjectURL(url); break }
    if (url) {
      recent = (recent + ' ' + clip.text).slice(-1500)
      lastActive = Date.now()
      await new Promise(resolve => {
        const a = el()
        endPlay = resolve
        a.onended = a.onerror = () => resolve()
        a.src = url
        a.play()?.catch(() => resolve())
      })
      endPlay = null
      URL.revokeObjectURL(url)
    }
    if (mine === gen) clips.shift()
  }
  if (mine === gen) playing = false
  lastActive = Date.now()
  notify()
}

export const speech = {
  setFetcher(fn) { fetchClip = fn },
  /** Start reading a reply as it streams. A reply already playing finishes first. */
  begin(id) { if (utterance !== id) { flushCurrent(); utterance = id; buffer = ''; firstPending = true } },
  push(id, text) { if (id === utterance) { buffer += text; flush(false) } },
  end(id) { if (id === utterance) { flush(true); utterance = null } },
  /** Say one piece of text now (e.g. a question Atlas is waiting on). */
  say(text) { const t = speakable(text); if (t) enqueue(t) },
  /** Stop talking, and drop everything still to be said. */
  cancel() {
    gen++
    utterance = null; buffer = ''
    clips.forEach(c => c.url.then(u => u && URL.revokeObjectURL(u)))
    clips = []
    playing = false
    const a = audio
    if (a) { try { a.pause() } catch { /* already stopped */ } }
    endPlay?.(); endPlay = null
    lastActive = Date.now()
    notify()
  },
  get speaking() { return snapshot.speaking },
  /** Whether anything was said since `t` (ms). */
  activeSince(t) { return snapshot.speaking || lastActive >= t },
  recentText: () => recent,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
}

function flushCurrent() { if (utterance) { flush(true); utterance = null } }

export const useSpeaking = () => useSyncExternalStore(speech.subscribe, () => snapshot.speaking)

/**
 * Should the reply to this message be read aloud?
 * `spoken`: said, not typed. `viaDock`: said to the corner mic, so the chat
 * isn't open to read the reply in.
 */
export function shouldSpeak(spoken, viaDock = false, mode = getVoiceSettings().speakReplies) {
  if (mode === 'always') return true
  if (mode === 'voice') return !!spoken
  if (mode === 'dock') return !!spoken && !!viaDock
  return false
}
