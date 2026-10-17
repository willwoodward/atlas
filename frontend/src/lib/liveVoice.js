// Fast voice (GPT-Live): the WebRTC connection. Audio goes both ways on media
// tracks (with the browser's echo cancellation, so Atlas doesn't hear itself);
// JSON events on the "oai-events" data channel. Our API starts the session
// (backend/routers/assistant.py → /assistant/live/session) so the OpenAI key
// stays on the server.

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const liveSupported = () =>
  typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function' && !!navigator.mediaDevices?.getUserMedia

// One audio element, started from the tap that opened the session (iOS only
// plays sound that a tap started).
let player = null
export function livePlayer() {
  if (!player && typeof Audio !== 'undefined') {
    player = new Audio()
    player.autoplay = true
    player.setAttribute('playsinline', '')
  }
  return player
}

/**
 * Open a session. Resolves once connected; events arrive on onEvent.
 * Returns { send(event), mute(on), close() }.
 */
export async function connectLive({ token, voice, onEvent, onClosed }) {
  const audio = livePlayer()
  audio?.play?.().catch(() => {})   // claim playback while we still have the tap
  let mic
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch (e) {
    throw new Error(e?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser settings.' : "Couldn't open the microphone.")
  }
  const pc = new RTCPeerConnection()
  let closed = false
  const shutdown = () => {
    if (closed) return
    closed = true
    try { pc.close() } catch { /* already closed */ }
    mic.getTracks().forEach(t => t.stop())
    if (audio) audio.srcObject = null
    onClosed?.()
  }
  pc.ontrack = e => {
    if (!audio) return
    audio.srcObject = e.streams?.[0] || new MediaStream([e.track])
    audio.play?.().catch(() => {})
  }
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) shutdown() }
  mic.getTracks().forEach(t => pc.addTrack(t, mic))
  const channel = pc.createDataChannel('oai-events')
  channel.onmessage = e => { try { onEvent(JSON.parse(e.data)) } catch { /* not JSON */ } }
  channel.onclose = () => shutdown()

  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const res = await fetch(`${API}/assistant/live/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sdp: offer.sdp, voice }),
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json()).detail } catch { /* not JSON */ }
      throw new Error(detail || `Fast voice couldn't start (${res.status})`)
    }
    const { sdp } = await res.json()
    await pc.setRemoteDescription({ type: 'answer', sdp })
  } catch (e) {
    shutdown()
    throw e
  }

  const send = ev => { if (channel.readyState === 'open') channel.send(JSON.stringify(ev)) }
  return {
    send,
    mute(on) { mic.getAudioTracks().forEach(t => { t.enabled = !on }) },
    // Ask for a graceful close (final usage arrives in session.closed), then
    // hang up if it hasn't by itself.
    close() {
      if (closed) return
      send({ type: 'session.close' })
      setTimeout(shutdown, 1500)
    },
    get closed() { return closed },
  }
}
