import { useVoiceHold } from '../lib/voiceActivity.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useAssistant } from '../context/AssistantContext.jsx'
import { connectLive } from '../lib/liveVoice.js'
import { createLiveController } from '../lib/liveSession.js'
import { getVoiceSettings } from '../lib/voiceSettings.js'
import { toolLabel } from '../lib/toolLabels.js'

const IDLE = { phase: 'idle', userText: '', atlasWorking: false, speaking: false, lastAnswer: '' }

/**
 * Fast voice (GPT-Live): one session from start() to stop() (or a sign-off,
 * or a minute of quiet). GPT-Live does the talking; Atlas does the work —
 * each delegated request becomes a normal Atlas turn in the shared
 * conversation (lib/liveSession.js).
 *
 * phase: idle | connecting | live | closing | closed
 */
export function useLiveVoice({ viaDock = false } = {}) {
  const { token } = useAuth()
  const { send } = useAssistant()
  const [ui, setUi] = useState(IDLE)
  const [error, setError] = useState(null)
  const conn = useRef(null)
  const ctrl = useRef(null)
  const timer = useRef(null)
  const starting = useRef(false)
  const sendRef = useRef(send)
  sendRef.current = send

  const cleanup = useCallback(() => {
    clearInterval(timer.current)
    ctrl.current?.dispose()
    ctrl.current = null
    conn.current = null
    starting.current = false
    setUi(IDLE)
  }, [])

  const start = useCallback(async () => {
    if (conn.current || starting.current) return
    starting.current = true
    setError(null)
    setUi({ ...IDLE, phase: 'connecting' })
    const c = createLiveController({
      emit: ev => conn.current?.send(ev),
      close: () => conn.current?.close(),
      runAtlas: (text, handlers) => sendRef.current(text, { spoken: true, viaDock, live: handlers }),
      describeTool: toolLabel,
      onChange: s => setUi(s),
    })
    ctrl.current = c
    try {
      conn.current = await connectLive({
        token,
        voice: getVoiceSettings().ttsVoice,
        onEvent: ev => {
          c.handle(ev)
          if (ev.type === 'error' && ev.error?.message) setError(ev.error.message)
        },
        onClosed: cleanup,
      })
    } catch (e) {
      setError(e.message || "Fast voice couldn't start.")
      cleanup()
      return
    }
    starting.current = false
    timer.current = setInterval(() => ctrl.current?.tick(), 300)
  }, [token, viaDock, cleanup])

  const stop = useCallback(() => {
    if (conn.current) conn.current.close()
    else cleanup()
  }, [cleanup])

  useEffect(() => () => { conn.current?.close() }, [])

  // A fast-voice session has the mic: the wake word waits.
  useVoiceHold(ui.phase !== 'idle' && ui.phase !== 'closed', 'live')
  return { ...ui, error, clearError: () => setError(null), start, stop, active: ui.phase !== 'idle' && ui.phase !== 'closed' }
}
