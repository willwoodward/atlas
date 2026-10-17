import { useEffect, useRef, useState } from 'react'
import { useAssistant } from '../context/AssistantContext.jsx'
import { useVoiceInput } from './useVoiceInput.js'
import { getVoiceSettings, CONVERSATION_SILENCE, CONVERSATION_WAIT } from '../lib/voiceSettings.js'
import { checkSignOff } from '../lib/voiceSignoff.js'
import { speech, isEcho, unlockAudio } from '../lib/speech.js'

const joinText = (a, b) => (a.trim() && b ? a.trimEnd() + ' ' : a) + b

/**
 * Talking to Atlas, shared by the chat's mic and the corner mic.
 *
 * One go: speak, and on a pause it's transcribed and sent (or, with
 * auto-send off and an `onDraft` to put it in, left to edit first).
 *
 * Conversation mode ("Keep listening"): each pause sends what you said and
 * listening starts again straight away, so you can line up the next thing
 * while Atlas is still answering — it's queued and sent when that turn ends.
 * It waits up to CONVERSATION_WAIT for you to start talking (thinking time),
 * and ends when you sign off ("that's all, thanks"), on end(), after that long
 * in silence, or when the component goes away.
 *
 * Spoken replies: talking over one stops it (if "Stop when I talk" is on),
 * and anything the mic picked up that is only Atlas's own voice coming back
 * through the speakers is dropped rather than sent.
 *
 * `draft` is text already typed, which the transcript is added to.
 */
export function useVoiceConversation({ draft = '', onSend, onDraft, viaDock = false } = {}) {
  const { send } = useAssistant()
  const [live, setLive] = useState('')
  const [conversing, setConversing] = useState(false)
  const listenAgain = useRef(false)
  const startedAt = useRef(0)
  const conversingRef = useRef(false)
  conversingRef.current = conversing
  const deliver = onSend || (text => send(text, { spoken: true, viaDock }))
  const conversationOpts = () => ({ silenceSeconds: getVoiceSettings().silenceSeconds || CONVERSATION_SILENCE, nothingSeconds: CONVERSATION_WAIT })

  // Words over Atlas's voice that aren't its own: they want to cut in.
  const onPartial = text => {
    setLive(text)
    if (speech.speaking && getVoiceSettings().bargeIn && text.split(/\s+/).filter(Boolean).length >= 2 &&
        !isEcho(text, speech.recentText())) speech.cancel()
  }

  const voice = useVoiceInput(text => {
    setLive('')
    // Heard while Atlas was talking, and it's only Atlas: ignore it.
    if (text && speech.activeSince(startedAt.current) && isEcho(text, speech.recentText())) text = ''
    if (conversingRef.current) {
      const { end, rest } = checkSignOff(joinText(draft, text))
      if (rest) deliver(rest)           // sends now, or queues behind the current turn
      if (end) { setConversing(false); return }
      listenAgain.current = true
      return
    }
    if (!text) return
    if (onDraft && !getVoiceSettings().autoSend) { onDraft(joinText(draft, text)); return }
    deliver(joinText(draft, text))
  }, onPartial, {
    onNothingHeard: () => setConversing(false),
  })

  const listen = opts => { startedAt.current = Date.now(); voice.start(opts) }
  const begin = () => {
    unlockAudio()   // a tap or key press: the moment iOS allows sound to be enabled
    const { keepListening } = getVoiceSettings()
    setConversing(keepListening)
    listenAgain.current = false
    listen(keepListening ? conversationOpts() : {})
  }
  const end = () => { setConversing(false); listenAgain.current = false; speech.cancel(); voice.cancel() }

  // The last message is away: listen for the next one.
  useEffect(() => {
    if (!conversing || voice.state !== 'idle' || !listenAgain.current) return
    listenAgain.current = false
    listen(conversationOpts())
  }, [conversing, voice.state]) // eslint-disable-line

  // Tap or shortcut. While Atlas is talking it only cuts the reply off; in a
  // conversation it's already listening for what you say next.
  const toggle = () => {
    if (speech.speaking) { speech.cancel(); return }
    if (conversing) end()
    else if (voice.state === 'recording') voice.stop()
    else if (voice.state === 'idle') begin()
  }

  const listening = voice.state === 'recording'
  useEffect(() => {
    if (!listening && !conversing) return
    const onEsc = e => { if (e.key === 'Escape') end() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [listening, conversing]) // eslint-disable-line

  return { voice, live, conversing, listening, begin, end, toggle, joinText }
}
