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
    // The first piece may also end at a clause (after 40+ characters), so a
    // long first sentence starts playing sooner.
    const re = isFirst ? /[.!?…]+["'”’)\]]*\s+|\n+|(?<=.{40,})[,;:—–]\s+/gs : /[.!?…]+["'”’)\]]*\s+|\n+/g
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
//
// The API streams raw PCM (16-bit, 24 kHz, mono) per piece of text. It's played
// through Web Audio as it arrives — no waiting for a whole file — and every
// piece goes through the same compressor and gain, so one sentence isn't
// louder than the next. Pieces play in order, back to back.

const RATE = 24000
let ctx = null
let input = null              // where sources connect: the compressor
function audio() {
  if (ctx) return ctx
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  ctx = new AC()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -26
  comp.knee.value = 20
  comp.ratio.value = 4
  comp.attack.value = 0.003
  comp.release.value = 0.25
  const gain = ctx.createGain()
  gain.gain.value = 1.5        // make back what the compressor took off
  comp.connect(gain)
  gain.connect(ctx.destination)
  input = comp
  return ctx
}

// iOS only starts audio from a tap; once resumed, the context stays usable.
export function unlockAudio() {
  const c = audio()
  if (!c) return
  try {
    c.resume?.()
    const src = c.createBufferSource()
    src.buffer = c.createBuffer(1, 1, 22050)
    src.connect(c.destination)
    src.start(0)
  } catch { /* nothing to unlock */ }
}

// iOS: "playback" plays through the speaker at full volume even with the
// ringer switch off; the default while the mic is on is the quieter call mode.
function audioSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type } catch { /* not supported */ }
}

/** A short, quiet tone: 'listen' (your turn) or 'heard' (got it). */
export function chime(kind) {
  const c = audio()
  if (!c || c.state !== 'running') return
  const notes = kind === 'listen' ? [[660, 0], [880, 0.07]] : [[740, 0]]
  for (const [freq, at] of notes) {
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    const t = c.currentTime + at
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.05, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    o.connect(g); g.connect(c.destination)
    o.start(t); o.stop(t + 0.14)
  }
}

let fetchClip = null          // (text, signal) → Promise<Response>, set by the assistant context
let warmer = null
let utterance = null          // the run being spoken, while its text still streams
let buffer = ''
let firstPending = true
let clips = []                // texts waiting to be spoken, in order
let pumping = false
let gen = 0
let playhead = 0              // when the audio scheduled so far ends (ctx time)
let sources = new Set()
let abort = null
let endTimer = null
let recent = ''               // what was said lately, for the echo check
let lastActive = 0
const gates = new Set()       // while any returns true, the next piece waits
const listeners = new Set()
let snapshot = { speaking: false }
const setSpeaking = on => {
  if (on) lastActive = Date.now()
  if (on === snapshot.speaking) return
  snapshot = { speaking: on }
  audioSession(on ? 'playback' : 'auto')
  if (!on) lastActive = Date.now()
  listeners.forEach(fn => fn())
}

function checkEnd() {
  clearTimeout(endTimer)
  if (!ctx) return setSpeaking(false)
  const left = playhead - ctx.currentTime
  if (pumping || clips.length || left > 0.02) {
    if (!pumping && !clips.length) endTimer = setTimeout(checkEnd, left * 1000 + 30)
    return
  }
  setSpeaking(false)
}

function schedule(samples) {
  const c = ctx
  const buf = c.createBuffer(1, samples.length, RATE)
  buf.copyToChannel(samples, 0)
  const src = c.createBufferSource()
  src.buffer = buf
  src.connect(input)
  const at = Math.max(playhead, c.currentTime + 0.05)
  src.start(at)
  playhead = at + buf.duration
  sources.add(src)
  src.onended = () => { sources.delete(src); checkEnd() }
  setSpeaking(true)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function streamClip(text, mine) {
  const ctrl = new AbortController()
  abort = ctrl
  let res
  try { res = await fetchClip(text, ctrl.signal) } catch { return }
  if (!res?.body || mine !== gen) return
  recent = (recent + ' ' + text).slice(-1500)
  const reader = res.body.getReader()
  let carry = new Uint8Array(0)
  let pending = [], pendingLen = 0
  const flush = () => {
    if (!pendingLen) return
    const out = new Float32Array(pendingLen)
    let o = 0
    for (const p of pending) { out.set(p, o); o += p.length }
    pending = []; pendingLen = 0
    schedule(out)
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (mine !== gen) { ctrl.abort(); return }
      if (done) break
      const bytes = new Uint8Array(carry.length + value.length)
      bytes.set(carry); bytes.set(value, carry.length)
      const even = bytes.length - (bytes.length % 2)
      carry = bytes.slice(even)
      const view = new DataView(bytes.buffer, 0, even)
      const f = new Float32Array(even / 2)
      for (let i = 0; i < f.length; i++) f[i] = view.getInt16(i * 2, true) / 32768
      pending.push(f); pendingLen += f.length
      // The first audio goes as soon as there's a little; after that, in
      // ~0.2 s blocks, scheduled back to back.
      if (pendingLen >= (playhead > ctx.currentTime ? RATE / 5 : RATE / 20)) flush()
    }
    flush()
  } catch { /* aborted or dropped: what arrived still plays */ }
}

async function pump() {
  if (pumping || !fetchClip) return
  const c = audio()
  if (!c) return
  pumping = true
  const mine = gen
  try {
    while (clips.length && mine === gen) {
      // Someone is mid-sentence: let them finish first.
      while ([...gates].some(g => g()) && mine === gen) await sleep(120)
      if (mine !== gen) break
      await streamClip(clips[0], mine)
      if (mine === gen) clips.shift()
    }
  } finally {
    if (mine === gen) pumping = false
    checkEnd()
  }
}

function enqueue(text) {
  if (!text || !fetchClip) return
  clips.push(text)
  pump()
}

function flush(final) {
  const { chunks, rest } = splitSpeech(buffer, { final, first: firstPending })
  buffer = rest
  for (const c of chunks) {
    const text = speakable(c)
    if (text) { enqueue(text); firstPending = false }
  }
}

function flushCurrent() { if (utterance) { flush(true); utterance = null } }

export const speech = {
  setFetcher(fn) { fetchClip = fn },
  setWarmer(fn) { warmer = fn },
  /** Get the speech connection ready (call when you start listening). */
  warm() { try { warmer?.() } catch { /* best effort */ } },
  /** While `fn()` is true, the next piece waits (e.g. you're mid-sentence). Returns a remover. */
  addGate(fn) { gates.add(fn); return () => gates.delete(fn) },
  /** Start reading a reply as it streams. A reply already playing finishes first. */
  begin(id) { if (utterance !== id) { flushCurrent(); utterance = id; buffer = ''; firstPending = true } },
  push(id, text) { if (id === utterance) { buffer += text; flush(false) } },
  end(id) { if (id === utterance) { flush(true); utterance = null } },
  /** Say one piece of text now (e.g. a question Atlas is waiting on). */
  say(text) { const t = speakable(text); if (t) enqueue(t) },
  /** Stop talking, and drop everything still to be said. */
  cancel() {
    gen++
    utterance = null; buffer = ''; clips = []; pumping = false
    abort?.abort(); abort = null
    for (const src of sources) { try { src.stop() } catch { /* already stopped */ } }
    sources = new Set()
    playhead = 0
    clearTimeout(endTimer)
    setSpeaking(false)
  },
  get speaking() { return snapshot.speaking },
  /** Talking, or about to: a reply still streaming in or waiting to play. */
  get pending() { return snapshot.speaking || pumping || clips.length > 0 || utterance != null },
  /** Whether anything was said since `t` (ms). */
  activeSince(t) { return snapshot.speaking || lastActive >= t },
  recentText: () => recent,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
}

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
