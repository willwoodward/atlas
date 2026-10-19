// The Vosk wake word engine: a small English speech recogniser running in a
// worker, told to listen only for the wake phrases (a grammar), fed straight
// from the mic. Nothing is sent anywhere. The model (~40 MB) is downloaded
// once and kept in the browser's storage (vosk-browser caches it by URL).
import { matchWake, PHRASES } from './index.js'

let modelPromise = null

function loadModel(url) {
  if (!modelPromise) {
    modelPromise = import('vosk-browser')
      .then(({ createModel }) => createModel(url, -1))   // -1: quiet logs
      .catch(e => { modelPromise = null; throw e })    // try again next time
  }
  return modelPromise
}

/**
 * start({ modelUrl, sensitivity, onHeard, onState, isPaused }) → { stop() }
 * isPaused(): true while a voice conversation is going on; what's heard then
 * is ignored.
 */
export async function start({ modelUrl, sensitivity = 0.6, onHeard, onState = () => {}, isPaused = () => false }) {
  onState('loading')
  const model = await loadModel(modelUrl)
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
  } catch (e) {
    throw new Error(e?.name === 'NotAllowedError' ? 'Microphone access is blocked.' : "Couldn't open the microphone.")
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const rec = new model.KaldiRecognizer(ctx.sampleRate, JSON.stringify([...PHRASES, '[unk]']))
  rec.setWords(true)
  let stopped = false
  rec.on('result', msg => {
    if (stopped || isPaused()) return
    const hit = matchWake(msg.result, sensitivity)
    if (hit) onHeard(hit)
  })
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessor is old but is what vosk-browser takes (AudioBuffers); its
  // output is silence, connected only so the browser keeps calling it.
  const node = ctx.createScriptProcessor(4096, 1, 1)
  node.onaudioprocess = e => {
    if (stopped || isPaused()) return
    try { rec.acceptWaveform(e.inputBuffer) } catch { /* a dropped buffer is fine */ }
  }
  source.connect(node)
  node.connect(ctx.destination)

  // Browsers may not start audio until you've interacted with the page.
  const resume = () => ctx.resume().then(() => { if (!stopped && ctx.state === 'running') onState('listening') })
  const GESTURES = ['pointerdown', 'keydown']
  const onGesture = () => { resume(); if (ctx.state === 'running') removeGesture() }
  const removeGesture = () => GESTURES.forEach(t => window.removeEventListener(t, onGesture, true))
  if (ctx.state === 'running') {
    onState('listening')
  } else {
    onState('waiting')
    GESTURES.forEach(t => window.addEventListener(t, onGesture, true))
    resume()
  }

  return {
    stop() {
      if (stopped) return
      stopped = true
      removeGesture()
      try { node.disconnect(); source.disconnect() } catch { /* already */ }
      stream.getTracks().forEach(t => t.stop())   // mic indicator off
      try { rec.remove() } catch { /* already */ }
      ctx.close().catch(() => {})
    },
  }
}
