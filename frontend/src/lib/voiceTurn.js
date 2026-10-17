// When has someone finished talking? A pause ends the turn, but a pause right
// after "and", "so", "um"… usually means more is coming, so it gets longer.

const TRAILING = new Set([
  'and', 'but', 'or', 'so', 'because', 'cause', 'then', 'also', 'if', 'when', 'that', 'which', 'with', 'to', 'for',
  'of', 'the', 'a', 'an', 'my', 'your', 'in', 'on', 'at', 'from', 'about', 'like', 'um', 'uh', 'er', 'erm', 'hmm',
  'maybe', 'just', 'is', 'are', 'was', 'can', 'could', 'should', 'would', 'will', 'do', 'it', "it's", 'i', "i'm", 'we',
])

/** Whether the words so far end mid-thought ("move my dentist to…"). */
export function endsMidThought(text) {
  const t = (text || '').trim().toLowerCase()
  if (!t || /[.!?]$/.test(t)) return false
  const last = t.replace(/[^\p{L}\p{N}'\s]/gu, ' ').trim().split(/\s+/).pop()
  return TRAILING.has(last)
}

/** Extra seconds to wait before ending the turn. */
export const extraPause = text => (endsMidThought(text) ? 1.5 : 0)
