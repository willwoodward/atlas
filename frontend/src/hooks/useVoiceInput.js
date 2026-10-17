import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const MAX_SECONDS = 5 * 60

// Formats in order of preference. Chrome/Firefox/Android record webm/opus;
// Safari (including the iOS PWA) only does mp4/aac. OpenAI accepts both.
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export const voiceSupported = () =>
  typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined'

const Recognition = () => typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

/**
 * Live, rough transcript from the browser's own recogniser (Chrome, Edge,
 * Safari), so words appear while you speak. Returns a stop function, or null
 * where there is no recogniser. Failure is silent: it's only a preview.
 *
 * Chrome ends a session after a pause even in continuous mode, so it restarts
 * until stopped, carrying the text it has already heard.
 */
function livePreview(onPartial) {
  const SR = Recognition()
  if (!SR) return null
  let carried = '', session = '', stopped = false, rec
  const begin = () => {
    try {
      rec = new SR()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = navigator.language || 'en-GB'
      rec.onresult = e => {
        session = Array.from(e.results, r => r[0]?.transcript || '').join('')
        onPartial((carried + ' ' + session).replace(/\s+/g, ' ').trim())
      }
      rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true }
      rec.onend = () => {
        carried = (carried + ' ' + session).trim(); session = ''
        if (!stopped) begin()
      }
      rec.start()
    } catch { stopped = true }
  }
  begin()
  return () => { stopped = true; try { rec?.abort() } catch { /* already ended */ } }
}

/**
 * Record from the microphone and turn it into text.
 *
 * While recording, `onPartial` gets a live preview from the browser's
 * recogniser where there is one. On stop, the audio goes to our API, which
 * passes it to OpenAI's speech-to-text (more accurate) and returns the
 * transcript for `onText`; nothing is kept. If that fails, the preview is
 * used instead so what you said isn't lost.
 *
 * state: idle | recording | transcribing
 */
export function useVoiceInput(onText, onPartial) {
  const { token } = useAuth()
  const [state, setState] = useState('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState(null)
  const rec = useRef(null)      // { recorder, stream, chunks, timer, cancelled }
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const onPartialRef = useRef(onPartial)
  onPartialRef.current = onPartial
  const previewText = useRef('')

  const release = () => {
    const r = rec.current
    if (!r) return
    clearInterval(r.timer)
    r.stopPreview?.()
    r.stream.getTracks().forEach(t => t.stop())   // turns the mic indicator off
    rec.current = null
  }
  useEffect(() => () => { if (rec.current) { rec.current.cancelled = true; release() } }, [])

  const upload = useCallback(async (blob) => {
    setState('transcribing')
    try {
      const res = await fetch(`${API}/assistant/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type.split(';')[0] || 'audio/webm' },
        body: blob,
      })
      if (!res.ok) {
        let detail = ''
        try { detail = (await res.json()).detail } catch { /* not JSON */ }
        throw new Error(typeof detail === 'string' && detail ? detail : `Couldn't transcribe (${res.status})`)
      }
      const { text } = await res.json()
      if (text) onTextRef.current?.(text)
      else if (previewText.current) onTextRef.current?.(previewText.current)
      else { onTextRef.current?.(''); setError("Didn't catch anything. Try again?") }
    } catch (e) {
      // Keep the live preview rather than lose what was said.
      onTextRef.current?.(previewText.current)
      setError(previewText.current
        ? `${e.message || "Couldn't transcribe that"}, so this is the browser's rougher version.`
        : e.message || "Couldn't transcribe that.")
    } finally {
      setState('idle')
    }
  }, [token])

  const start = useCallback(async () => {
    if (rec.current || state !== 'idle') return
    setError(null)
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      setError(e?.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Allow it in your browser settings.'
        : "Couldn't open the microphone.")
      return
    }
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported?.(t))
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const r = { recorder, stream, chunks: [], timer: null, cancelled: false }
    rec.current = r
    recorder.ondataavailable = e => { if (e.data?.size) r.chunks.push(e.data) }
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'audio/webm'
      release()
      if (!r.cancelled) upload(new Blob(r.chunks, { type }))
      else { onPartialRef.current?.(''); setState('idle') }
    }
    recorder.start()
    previewText.current = ''
    r.stopPreview = livePreview(text => { previewText.current = text; onPartialRef.current?.(text) })
    setSeconds(0)
    setState('recording')
    const began = Date.now()
    r.timer = setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS) recorder.stop()
    }, 250)
  }, [state, upload])

  const stop = useCallback(() => {
    if (rec.current?.recorder.state === 'recording') rec.current.recorder.stop()
  }, [])

  const cancel = useCallback(() => {
    if (!rec.current) return
    rec.current.cancelled = true
    if (rec.current.recorder.state === 'recording') rec.current.recorder.stop()
    else { release(); setState('idle') }
  }, [])

  return { state, seconds, error, clearError: () => setError(null), start, stop, cancel }
}
