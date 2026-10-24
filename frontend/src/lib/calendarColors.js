// Event colours. Atlas draws events in its own six colours; the colour Google
// Calendar shows comes from title rules (stored by the backend, see
// backend/calendar_colors.py — this matches titles the same way).

export const ATLAS_COLORS = [
  { name: 'blue',  hex: '#5f7591' }, { name: 'sage',  hex: '#6f8168' },
  { name: 'coral', hex: '#c15f3c' }, { name: 'gold',  hex: '#b08a3e' },
  { name: 'mauve', hex: '#9a6d84' }, { name: 'grey',  hex: '#9a9488' },
]
export const atlasHex = (name) => ATLAS_COLORS.find(c => c.name === name)?.hex ?? null
export const atlasNameForHex = (hex) => ATLAS_COLORS.find(c => c.hex === hex?.toLowerCase())?.name ?? ''

// Google's event colours, as Google Calendar shows them.
export const GCAL_COLORS = [
  { id: '1', name: 'lavender', hex: '#7986cb' }, { id: '2', name: 'sage', hex: '#33b679' },
  { id: '3', name: 'grape', hex: '#8e24aa' }, { id: '4', name: 'flamingo', hex: '#e67c73' },
  { id: '5', name: 'banana', hex: '#f6bf26' }, { id: '6', name: 'tangerine', hex: '#f4511e' },
  { id: '7', name: 'peacock', hex: '#039be5' }, { id: '8', name: 'graphite', hex: '#616161' },
  { id: '9', name: 'blueberry', hex: '#3f51b5' }, { id: '10', name: 'basil', hex: '#0b8043' },
  { id: '11', name: 'tomato', hex: '#d50000' },
]

/** A rule's pattern as a case-insensitive RegExp, or null if it doesn't compile. */
function toRegExp(pattern) {
  try { return new RegExp(pattern, 'i') } catch { return null }
}

/** The Google colour name a title gets: first matching rule, else the fallback. */
export function gcalColorNameFor(title, cfg) {
  for (const rule of cfg?.rules ?? []) {
    const re = toRegExp(rule.pattern)
    if (re?.test(title ?? '')) return rule.color
  }
  return cfg?.fallback ?? 'default'
}

/** colorId to send to Google; null = the calendar's own colour. */
export function gcalColorIdFor(title, cfg) {
  const name = gcalColorNameFor(title, cfg)
  return GCAL_COLORS.find(c => c.name === name)?.id ?? null
}

/** Is this a pattern both JS and the backend can use? (Empty = no.) */
export const isValidPattern = (pattern) => !!pattern && toRegExp(pattern) !== null
