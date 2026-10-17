// Fast voice (GPT-Live): what happens on the data channel, kept free of
// WebRTC and React so it can be tested on its own.
//
// GPT-Live runs the conversation. When something needs Atlas — their data,
// a change, anything current — it sends `session.delegation.created`. That
// event carries no text, so the request is what the user said in their
// latest turn (from the live transcript). Atlas runs a normal turn; while it
// works, each tool it uses goes back as quiet context (`session.thinking.append`)
// so GPT-Live can say "checking your calendar" if it wants; the answer goes back
// as `session.commentary.append` for GPT-Live to say.
//
// Also here: ending the session when the user signs off ("that's all, thanks"),
// and after a quiet spell, since a session is billed for every minute it's open.

import { checkSignOff } from './voiceSignoff.js'
import { speakable } from './speech.js'

export const IDLE_CLOSE_MS = 60_000      // nobody's said anything for this long
export const SIGNOFF_CLOSE_MS = 4_000    // time to say goodbye
const TURN_PAUSE_MS = 1_200              // a pause this long ends a user turn
const MAX_APPEND_CHARS = 1_400           // appends are capped at 500 tokens

/** Split an answer into appends GPT-Live accepts, at sentence breaks. */
export function chunkAnswer(text, max = MAX_APPEND_CHARS) {
  const plain = speakable(text || '')
  if (plain.length <= max) return plain ? [plain] : []
  const out = []
  let cur = ''
  for (const sentence of plain.match(/[^.!?]+[.!?]*\s*/g) || [plain]) {
    if ((cur + sentence).length > max && cur) { out.push(cur.trim()); cur = '' }
    cur += sentence.length > max ? sentence.slice(0, max) : sentence
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

let seq = 0
const eventId = prefix => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`

/**
 * emit(event)        — send an event to GPT-Live
 * runAtlas(text, h)  — run an Atlas turn; h = { onTool(name), onDone(text), onError(message) }
 * close()            — end the session
 * describeTool(name) — "Reading your calendar" for a tool name
 * onChange(state)    — UI state: { phase, userText, atlasWorking, speaking, lastAnswer }
 */
export function createLiveController({ emit, runAtlas, close, describeTool = n => n, onChange = () => {}, now = () => Date.now() }) {
  let phase = 'connecting'
  let userText = ''          // the user's turn as it's being said
  let lastTurn = ''          // their last finished turn
  let lastInputAt = 0
  let lastActivity = now()
  let lastSpokeAt = 0
  let working = 0            // Atlas turns in progress
  let closing = null
  let lastAnswer = ''

  const state = () => ({ phase, userText: userText || lastTurn, atlasWorking: working > 0, speaking: now() - lastSpokeAt < 1200, lastAnswer })
  const changed = () => onChange(state())

  // A turn is over (a pause, or Atlas's voice answering). "That's all,
  // thanks" ends the session once the goodbye has been said.
  const finishTurn = () => {
    const said = userText.trim()
    if (!said) return
    lastTurn = said
    userText = ''
    const { end, rest } = checkSignOff(said)
    if (end && !rest && !working) endSoon(SIGNOFF_CLOSE_MS)
  }

  const delegate = (delegationId) => {
    finishTurn()
    const request = lastTurn
    lastTurn = ''
    if (!request) {
      emit({ type: 'session.commentary.append', event_id: eventId('nothing'), delegation_id: delegationId,
             content: "I didn't catch what to do there. Could you say it again?" })
      return
    }
    working++
    changed()
    runAtlas(request, {
      onTool: name => emit({ type: 'session.thinking.append', event_id: eventId('tool'), delegation_id: delegationId,
                             content: `Atlas is working on it: ${describeTool(name)}.` }),
      onDone: text => {
        working = Math.max(0, working - 1)
        lastActivity = now()
        lastAnswer = text || ''
        const parts = chunkAnswer(text)
        if (!parts.length) parts.push('Done.')
        for (const content of parts) emit({ type: 'session.commentary.append', event_id: eventId('answer'), delegation_id: delegationId, content })
        changed()
      },
      onError: message => {
        working = Math.max(0, working - 1)
        emit({ type: 'session.commentary.append', event_id: eventId('error'), delegation_id: delegationId,
               content: `Sorry, that didn't work: ${message || 'something went wrong'}.` })
        changed()
      },
    })
  }

  const endSoon = ms => {
    if (closing) return
    phase = 'closing'
    closing = setTimeout(() => close(), ms)
    changed()
  }

  return {
    handle(ev) {
      switch (ev?.type) {
        case 'session.started':
          phase = 'live'; lastActivity = now(); changed(); break
        case 'session.input_transcript.delta':
          userText += ev.delta || ''
          lastInputAt = lastActivity = now()
          changed(); break
        case 'session.output_transcript.delta':
          // Atlas's voice answering means the user's turn is over.
          finishTurn()
          lastSpokeAt = lastActivity = now()
          changed(); break
        case 'session.delegation.created':
          if (ev.delegation?.target === 'client' || !ev.delegation?.target) delegate(ev.delegation?.id ?? null)
          break
        case 'session.closed':
          phase = 'closed'; changed(); break
        default:
      }
    },
    /** Call every few hundred ms: turn ends, sign-offs and the idle timeout. */
    tick() {
      const t = now()
      if (phase !== 'live') return
      if (userText.trim() && t - lastInputAt > TURN_PAUSE_MS) finishTurn()
      if (!working && t - lastActivity > IDLE_CLOSE_MS) endSoon(0)
      changed()
    },
    state,
    dispose() { clearTimeout(closing) },
  }
}
