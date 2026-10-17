// Ending a hands-free conversation by saying so ("that's all, thanks").
//
// Only a sign-off at the *end* of what was said counts, so "that's all the
// meetings on Friday?" isn't mistaken for one. Whatever came before it is
// still a message: "move my run to 7, that's all thanks" sends "move my run
// to 7" and then stops listening.

const SIGN_OFFS = [
  "that'?s (?:all|it|everything)(?: for now)?",
  'that is (?:all|it|everything)(?: for now)?',
  'that will be all', "that'?ll be all",
  "(?:i'?m|i am|we'?re|we are) (?:all )?(?:done|good|finished)(?: for now)?",
  'nothing else', 'no more',
  'stop listening', 'stop recording', 'end (?:voice|conversation)',
  'all (?:good|done)', 'good ?bye', 'bye(?: bye)?', 'cheers', 'see you(?: later)?',
]

// Fillers that can sit around a sign-off: "no, that's all, thanks atlas".
const FILLER = "(?:\\s*(?:,|\\.|!|ok(?:ay)?|no|yeah|yes|great|perfect|cool|nice|thanks|thank you|thanks a lot|cheers|atlas|for now|then|so)\\s*)*"
const RE = new RegExp(`(?:^|[\\s,.!?])${FILLER}(?:${SIGN_OFFS.join('|')})${FILLER}[.!?]*\\s*$`, 'i')

/**
 * { end, rest }: whether `text` ends the conversation, and the part of it
 * still worth sending (empty when it was only a sign-off).
 */
export function checkSignOff(text) {
  const t = (text || '').trim()
  const m = RE.exec(t)
  if (!m) return { end: false, rest: t }
  const rest = t.slice(0, m.index).replace(/[\s,.;:–—-]+$/, '').trim()
  // A couple of stray words before the sign-off ("okay so") aren't a message.
  return { end: true, rest: rest.split(/\s+/).filter(Boolean).length >= 3 ? rest : '' }
}
