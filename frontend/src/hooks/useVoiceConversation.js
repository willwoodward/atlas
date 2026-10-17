import { useEffect, useRef, useState } from 'react'
import { useAssistant } from '../context/AssistantContext.jsx'
import { useVoiceInput } from './useVoiceInput.js'
import { useLiveVoice } from './useLiveVoice.js'
import { liveSupported } from '../lib/liveVoice.js'
import { getVoiceSettings, useVoiceSettings, CONVERSATION_SILENCE, CONVERSATION_WAIT } from '../lib/voiceSettings.js'
import { checkSignOff } from '../lib/voiceSignoff.js'
import { speech, isEcho, unlockAudio, chime, useSpeaking } from '../lib/speech.js'

// How long after Atlas stops talking before the mic opens again.
const RESUME_AFTER_SPEECH_MS = 500

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
 * Spoken replies: the mic pauses while Atlas talks and picks up again after
 * (keeping it on puts phones and some laptops into "call" audio, which is
 * quieter and uneven). With "Stop when I talk" on, it stays on instead, and
 * talking over Atlas cuts it off. Either way, if you're mid-sentence when a
 * reply is ready, it waits for you to finish; and anything the mic picked up
 * that is only Atlas's own voice is dropped rather than sent.
 *
 * `waitForReply` (the corner mic): in a conversation, don't listen while Atlas
 * works — show it thinking, let it answer, then listen. The chat listens
 * straight away instead, so you can queue up the next thing.
 *
 * Voice engine "Fast" (Assistant settings → Voice): GPT-Live does the
 * listening and talking instead (useLiveVoice), behind the same interface.
 *
 * `draft` is text already typed, which the transcript is added to.
 */
export function useVoiceConversation({ draft = '', onSend, onDraft, viaDock = false, waitForReply = false } = {}) {
  const { send, busy } = useAssistant()
  const { engine } = useVoiceSettings()
  const fast = useLiveVoice({ viaDock })
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

  const listen = opts => {
    startedAt.current = Date.now()
    if (getVoiceSettings().speakReplies !== 'never') speech.warm()
    voice.start(opts)
  }
  const begin = () => {
    unlockAudio()   // a tap or key press: the moment iOS allows sound to be enabled
    const { keepListening } = getVoiceSettings()
    setConversing(keepListening)
    listenAgain.current = false
    listen(keepListening ? conversationOpts() : {})
  }
  const end = () => { setConversing(false); listenAgain.current = false; pausedForSpeech.current = false; speech.cancel(); voice.cancel() }

  // ── Sharing the air with spoken replies ──
  const speaking = useSpeaking()
  const pausedForSpeech = useRef(false)
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  // A reply waits while you're mid-sentence.
  useEffect(() => speech.addGate(() => voiceRef.current.state === 'recording' && voiceRef.current.hasSpeech()), [])
  useEffect(() => {
    const barge = getVoiceSettings().bargeIn
    if (speaking && !barge && voice.state === 'recording' && !voice.hasSpeech()) {
      // Atlas starts talking while the mic waits for you: step aside.
      pausedForSpeech.current = conversingRef.current
      voice.cancel()
    } else if (!speaking && pausedForSpeech.current && conversingRef.current && voice.state === 'idle') {
      // A moment before listening again: the end of the reply is still
      // ringing out of the speaker and round the room, and the mic would
      // otherwise catch it and send it as if you'd said it.
      pausedForSpeech.current = false
      const t = setTimeout(() => {
        if (conversingRef.current && !speech.speaking && voiceRef.current.state === 'idle') listen(conversationOpts())
      }, RESUME_AFTER_SPEECH_MS)
      return () => clearTimeout(t)
    }
  }, [speaking, voice.state]) // eslint-disable-line

  // The last message is away: listen for the next one (after Atlas has
  // spoken, unless talking over it is allowed; with waitForReply, after it
  // has answered at all).
  const waiting = useRef(false)
  useEffect(() => {
    if (!conversing || voice.state !== 'idle' || !listenAgain.current) return
    listenAgain.current = false
    if (waitForReply) { waiting.current = true; return }
    if (speech.speaking && !getVoiceSettings().bargeIn) { pausedForSpeech.current = true; return }
    listen(conversationOpts())
  }, [conversing, voice.state]) // eslint-disable-line
  // Waiting for the reply: done once Atlas has finished and said it.
  useEffect(() => {
    if (!waiting.current) return
    const t = setInterval(() => {
      if (!conversingRef.current) { waiting.current = false; clearInterval(t); return }
      if (busyRef.current || speech.pending || voiceRef.current.state !== 'idle') return
      waiting.current = false
      clearInterval(t)
      setTimeout(() => { if (conversingRef.current && !speech.pending && voiceRef.current.state === 'idle') listen(conversationOpts()) }, RESUME_AFTER_SPEECH_MS)
    }, 200)
    return () => clearInterval(t)
  }, [busy, voice.state, conversing]) // eslint-disable-line
  const busyRef = useRef(busy)
  busyRef.current = busy

  // A soft tone when it starts listening, and when it has heard you.
  const lastState = useRef(voice.state)
  useEffect(() => {
    const was = lastState.current
    lastState.current = voice.state
    if (was === 'idle' && voice.state === 'recording') chime('listen')
    if (was === 'recording' && voice.state === 'transcribing') chime('heard')
  }, [voice.state])

  // Tap or shortcut. While Atlas is talking it only cuts the reply off; in a
  // conversation it's already listening for what you say next.
  const toggle = () => {
    if (speech.speaking) { speech.cancel(); return }
    if (conversing) end()
    else if (voice.state === 'recording') voice.stop()
    else if (voice.state === 'idle') begin()
  }

  const listening = voice.state === 'recording'
  const useFast = engine === 'live' && liveSupported()
  useEffect(() => {
    if (!listening && !conversing && !fast.active) return
    const onEsc = e => { if (e.key === 'Escape') { end(); fast.stop() } }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [listening, conversing, fast.active]) // eslint-disable-line

  if (useFast) {
    // GPT-Live behind the same shape the mics already use.
    const state = fast.phase === 'connecting' ? 'transcribing' : fast.active ? 'recording' : 'idle'
    const begin = () => { unlockAudio(); fast.start() }
    return {
      fast,
      voice: { ...voice, state, seconds: 0, error: fast.error, clearError: fast.clearError, start: begin, stop: fast.stop, cancel: fast.stop, hasSpeech: () => false },
      live: fast.userText,
      conversing: fast.active,
      listening: fast.active && !fast.speaking && !fast.atlasWorking,
      begin,
      end: fast.stop,
      toggle: () => (fast.active ? fast.stop() : begin()),
      joinText,
    }
  }
  return { fast: null, voice, live, conversing, listening, waitingForReply: waitForReply && conversing && voice.state === 'idle' && (busy || speaking), begin, end, toggle, joinText }
}
