import { useEffect, useRef, useState } from 'react'
import { useAssistant } from '../context/AssistantContext.jsx'
import { useKeybinds } from '../context/KeybindsContext.jsx'
import { useVoiceConversation } from '../hooks/useVoiceConversation.js'
import { voiceSupported } from '../hooks/useVoiceInput.js'
import { useVoiceSettings } from '../lib/voiceSettings.js'
import { useSpeaking } from '../lib/speech.js'
import { renderMarkdown } from '../lib/markdown.js'
import { displayCombo } from '../lib/keybinds.js'
import { toolLabel } from './AssistantChat.jsx'
import { IconButton } from './ui.jsx'
import ApprovalCard from './ApprovalCard.jsx'

// How long a one-off reply stays up after everything has gone quiet.
const LINGER_MS = 10000
// After a voice conversation ends (you said bye, pressed stop, or it timed
// out), the card goes once Atlas has finished speaking: there's nothing left.
const AFTER_END_MS = 1200

const MicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
)
const StopIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
const CheckIcon = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>

/**
 * The corner mic: talk to Atlas from any page without opening the chat.
 *
 * Shown when no chat is on screen (Assistant settings → Voice → "Corner
 * mic"). Tap it, or press the voice shortcut, and speak: the message goes to
 * the same conversation as the chat, the reply streams into a small card
 * above the button and is read aloud, and "Open in chat" carries on there.
 * Changes Atlas makes still show on the page as they happen.
 */
export default function VoiceDock({ right = 16, bottom = 16 }) {
  const { messages, busy, queued, registerVoiceDock, chatsOnScreen, answer } = useAssistant()
  const { floatingMic } = useVoiceSettings()
  const { bindings } = useKeybinds() || {}
  const speaking = useSpeaking()
  // The thread position when this round began, so the card shows only the
  // replies to what was said here.
  const [since, setSince] = useState(null)
  const [hover, setHover] = useState(false)
  const sinceRef = useRef(null)
  sinceRef.current = since
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // In a conversation it waits for Atlas to answer before listening again.
  const { voice, live, conversing, listening, toggle, end, fast } = useVoiceConversation({ viaDock: true, waitForReply: true })
  const working = voice.state !== 'idle' || conversing
  const begun = () => { if (sinceRef.current === null) setSince(messagesRef.current.length) }

  const toggleRef = useRef(null)
  toggleRef.current = () => { if (voice.state === 'idle' && !conversing) begun(); toggle() }
  const activeRef = useRef(false)
  activeRef.current = working
  useEffect(() => registerVoiceDock({ toggle: () => toggleRef.current(), active: () => activeRef.current }), [registerVoiceDock])

  // The card is up while there's something to show, then lingers a little.
  const round = since !== null
  const showing = working || (round && (busy || speaking))
  // Whether this round was a conversation that has now ended.
  const [ended, setEnded] = useState(false)
  const wasConversing = useRef(false)
  useEffect(() => {
    if (conversing) { wasConversing.current = true; setEnded(false) }
    else if (wasConversing.current) { wasConversing.current = false; setEnded(true) }
  }, [conversing])
  useEffect(() => { if (!round) { setEnded(false); setHover(false) } }, [round])
  useEffect(() => {
    if (!round || showing) return
    // A finished conversation closes itself; a one-off reply lingers to be read
    // (longer while the pointer is on it).
    if (ended) { const t = setTimeout(() => setSince(null), AFTER_END_MS); return () => clearTimeout(t) }
    if (hover) return
    const t = setTimeout(() => setSince(null), LINGER_MS)
    return () => clearTimeout(t)
  }, [round, showing, hover, ended])
  const close = () => { end(); setSince(null); setHover(false) }

  const replies = round ? messages.slice(since).filter(m => m.role === 'assistant') : []
  const reply = replies[replies.length - 1]
  const bodyRef = useRef(null)
  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight }, [reply?.content, live])

  if (!floatingMic || !voiceSupported()) return null
  // A chat on screen has its own mic; the corner one stays only to finish what it started.
  if (chatsOnScreen > 0 && !round && !working) return null

  const lastTool = reply?.tools?.filter(t => typeof t === 'object').slice(-1)[0]
  // A tool set to "ask first" (Agents page) is waiting for a yes. The only
  // thing the corner shows besides speech: a change can't go ahead unseen.
  const approval = reply?.question?.kind === 'approval' && reply.question.status === 'open' ? reply.question : null
  const atlasStatus = approval ? 'Needs your OK' : lastTool && !lastTool.status ? toolLabel(lastTool.name) : reply?.content ? 'Answering' : 'Thinking'
  const status = fast
    ? (fast.phase === 'connecting' ? 'Connecting' : fast.phase === 'closing' ? 'Ending'
      : busy ? atlasStatus : fast.speaking ? 'Speaking' : fast.active ? 'Listening' : 'Atlas')
    : listening ? 'Listening'
    : voice.state === 'transcribing' ? 'Transcribing'
    : speaking ? 'Speaking'
    : busy ? atlasStatus
    : conversing ? 'Voice mode' : 'Atlas'
  const shortcut = bindings?.voice ? ` (${displayCombo(bindings.voice)})` : ''

  const button = {
    label: listening ? 'Stop and send' : speaking ? 'Stop speaking' : 'Talk to Atlas',
    icon: listening ? <CheckIcon /> : speaking ? <StopIcon /> : <MicIcon />,
    on: listening || speaking,
  }

  return (
    <div style={{ position: 'fixed', right, bottom, zIndex: 150, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, pointerEvents: 'none' }}>
      {round && (
        <div role="status" aria-live="polite" className="voice-dock-card" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          style={{ pointerEvents: 'auto', width: 'min(360px, calc(100vw - 32px))', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '1px solid var(--bd)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden', transformOrigin: 'bottom right' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 8px 14px' }}>
            <span className={listening || busy ? 'voice-dock-pulse' : undefined}
              style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: listening ? 'var(--accent)' : busy || speaking ? 'var(--sage)' : 'var(--faint)' }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[status, fast?.active ? 'fast voice' : conversing && status !== 'Voice mode' ? 'voice mode' : null, queued.length ? `${queued.length} queued` : null].filter(Boolean).join(' · ')}
            </span>
            <IconButton size={28} aria-label="Open in chat" title="Open in chat"
              onClick={() => { setSince(null); window.dispatchEvent(new CustomEvent('atlas:show-assistant')) }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-8 8M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" /></svg>
            </IconButton>
            <IconButton size={28} aria-label={conversing ? 'End voice mode' : 'Close'} title={conversing ? 'End voice mode (Esc)' : 'Close'} onClick={close}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </IconButton>
          </div>
          <div ref={bodyRef} style={{ maxHeight: 'min(38vh, 320px)', overflowY: 'auto', padding: '0 14px 12px', textAlign: 'left' }}>
            {/* Fast voice: what you said, then Atlas's answer as it comes. */}
            {fast?.active && fast.userText && (busy || reply?.content) && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 6 }}>“{fast.userText}”</div>}
            {voice.state !== 'idle' && !(fast?.active && (busy || reply?.content))
              ? <div style={{ fontSize: 13.5, lineHeight: 1.5, color: live ? 'var(--ink)' : 'var(--faint)' }}>{live || (listening ? 'Go ahead…' : '…')}</div>
              : reply?.content
                ? <div className="md-prose" style={{ fontSize: 13.5, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(reply.content) }} />
                : reply?.error ? <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{reply.error}</div>
                : <div style={{ fontSize: 13, color: 'var(--faint)' }}>{busy ? 'Working on it…' : conversing ? 'Go ahead whenever you’re ready.' : '—'}</div>}
            {approval && <ApprovalCard question={approval} runId={reply.runId} onAnswer={answer} compact />}
            {voice.error && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--accent)' }}>{voice.error}</div>}
          </div>
        </div>
      )}
      <button type="button" onClick={() => toggleRef.current()} disabled={voice.state === 'transcribing'}
        aria-label={button.label} title={button.label + shortcut} className={listening ? 'voice-dock-live' : undefined}
        style={{ pointerEvents: 'auto', width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
                 border: button.on ? 'none' : '1px solid var(--bd)', background: button.on ? 'var(--accent)' : 'var(--surface)', color: button.on ? '#fff' : 'var(--mid)',
                 boxShadow: button.on ? 'var(--shadow-accent)' : '0 4px 16px var(--bd-sm)', transition: 'background .15s, color .15s, transform .15s',
                 opacity: voice.state === 'transcribing' ? 0.7 : 1 }}>
        {button.icon}
      </button>
    </div>
  )
}
