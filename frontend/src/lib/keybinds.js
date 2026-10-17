// Keyboard shortcuts. Each action has a default combo; the user can rebind it
// on the Settings page (stored per device, since keyboards differ).
//
// Combos are strings like "Mod+K" or "Mod+Shift+." — "Mod" is Ctrl on
// Windows/Linux and ⌘ on a Mac, so one binding works on both.

export const SHORTCUTS = [
  { id: 'voice', label: 'Start / stop voice input', hint: 'Opens the assistant if it isn’t on screen', default: 'Mod+K' },
  { id: 'assistantPanel', label: 'Open / close the assistant panel', hint: 'Desktop', default: 'Mod+.' },
]

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

// Physical key → the character it names, so Shift doesn't turn "." into ">".
const CODE_KEYS = {
  Period: '.', Comma: ',', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  Space: 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
}

function keyName(e) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  if (/^F\d{1,2}$/.test(e.code)) return e.code
  if (CODE_KEYS[e.code]) return CODE_KEYS[e.code]
  const k = e.key || ''
  return k.length === 1 ? k.toUpperCase() : k
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'OS'])

/** The combo a keydown event represents, or null for a bare modifier press. */
export function comboFromEvent(e) {
  if (MODIFIER_KEYS.has(e.key)) return null
  const parts = []
  if (e.ctrlKey || e.metaKey) parts.push('Mod')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(keyName(e))
  return parts.join('+')
}

/**
 * Whether a combo is allowed as a shortcut. Shortcuts fire while you're typing,
 * so a plain key (or Shift+key) would swallow ordinary text — they need Mod or
 * Alt, unless they're a function key.
 */
export function validCombo(combo) {
  if (!combo) return false
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  return parts.includes('Mod') || parts.includes('Alt') || /^F\d{1,2}$/.test(key)
}

/** "Mod+Shift+K" → "Ctrl+Shift+K", or "⌘⇧K" on a Mac. */
export function displayCombo(combo, mac = isMac()) {
  if (!combo) return '—'
  const parts = combo.split('+')
  if (mac) {
    const sym = { Mod: '⌘', Alt: '⌥', Shift: '⇧' }
    return parts.map(p => sym[p] || p).join('')
  }
  return parts.map(p => (p === 'Mod' ? 'Ctrl' : p)).join('+')
}
