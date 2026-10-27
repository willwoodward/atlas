// How a quick note is written and edited.
//
// A note is stored as plain Markdown, which the assistant also reads and
// writes: the first line is the title, list items are `- item`, and to-dos are
// `- [ ] item` / `- [x] item`. In the editor each marker is one invisible
// space of a known width (the editor draws the bullet or circle over it), so
// the text stays one ordinary string: selecting, copying and undo just work,
// and the circles line up whatever font the device falls back to.
// Typing `- ` makes a bullet and `o ` or `0 ` makes a to-do circle.
//
// The editing rules return an edit { start, end, insert, caret? } for the
// editor to apply; nothing here touches the page.

export const BULLET = '\u2002' // en space: half an em wide
export const OPEN = '\u2003'   // em space
export const DONE = '\u2001'   // em quad, as wide as an em space
// (Indents are spaces and tabs only: \s would match the markers too.)
const MD_TASK = /^([ \t]*)[-*+] \[( |x|X)\] ?/
const MD_BULLET = /^([ \t]*)[-*+] /
const SHOWN = /^([ \t]*)([\u2001\u2002\u2003]) ?/

/** What a marker looks like when copied out of the editor. */
export function forClipboard(text) {
  return text.replaceAll(BULLET, '•').replaceAll(OPEN, '○').replaceAll(DONE, '●')
}

/** Stored Markdown → what the editor shows. */
export function toDisplay(md) {
  return String(md ?? '').split('\n').map(line => {
    const task = MD_TASK.exec(line)
    if (task) return `${task[1]}${task[2] === ' ' ? OPEN : DONE} ${line.slice(task[0].length)}`
    const bullet = MD_BULLET.exec(line)
    if (bullet) return `${bullet[1]}${BULLET} ${line.slice(bullet[0].length)}`
    return line
  }).join('\n')
}

/** What the editor shows → stored Markdown. */
export function toMarkdown(text) {
  return String(text ?? '').split('\n').map(line => {
    const m = SHOWN.exec(line)
    if (!m) return line
    const dash = m[2] === BULLET ? '- ' : m[2] === OPEN ? '- [ ] ' : '- [x] '
    return `${m[1]}${dash}${line.slice(m[0].length)}`
  }).join('\n')
}

/** A note's first line is its title (any leading #s are kept out of the field). */
export function splitNote(md) {
  const s = String(md ?? '')
  const nl = s.indexOf('\n')
  const first = nl === -1 ? s : s.slice(0, nl)
  const hashes = /^#+\s*/.exec(first)?.[0] ?? ''
  return { prefix: hashes, title: first.slice(hashes.length), rest: nl === -1 ? '' : s.slice(nl + 1) }
}

/** The other way. A new note's title is a Markdown heading, so it reads as one elsewhere. */
export function joinNote({ prefix = '# ', title, rest }) {
  const first = title === '' ? '' : `${prefix}${title}`
  return rest === '' ? first : `${first}\n${rest}`
}

export function lineAt(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1
  const end = text.indexOf('\n', pos)
  return { start, end: end === -1 ? text.length : end }
}

/** The to-do or bullet a line starts with, if any. */
export function itemOf(text, pos) {
  const { start, end } = lineAt(text, pos)
  const line = text.slice(start, end)
  const m = /^([ \t]*)([\u2001\u2002\u2003]) /.exec(line)
  if (!m) return null
  return { start, end, indent: m[1], mark: m[2], bodyStart: start + m[0].length, rest: line.slice(m[0].length) }
}

/** Just typed a space: did `o `, `0 `, `- ` or `* ` start a line? Returns the edit that makes it a circle or bullet. */
export function autoMarker(text, caret) {
  const { start } = lineAt(text, caret)
  const m = /^([ \t]*)([o0\-*]) $/.exec(text.slice(start, caret))
  if (!m) return null
  return { start: start + m[1].length, end: caret, insert: `${/[o0]/.test(m[2]) ? OPEN : BULLET} ` }
}

/** Enter on a list line: carry the list on, or end it if the item is empty. null = a normal Enter. */
export function enterEdit(text, caret) {
  const item = itemOf(text, caret)
  if (!item || caret < item.bodyStart) return null
  if (item.rest.trim() === '' && caret === item.end) return { start: item.start, end: item.end, insert: '' }
  return { start: caret, end: caret, insert: `\n${item.indent}${item.mark === BULLET ? BULLET : OPEN} ` }
}

/** Backspace right after a marker takes the marker off and leaves the text. */
export function backspaceEdit(text, caret) {
  const item = itemOf(text, caret)
  if (!item || caret !== item.bodyStart) return null
  return { start: item.start + item.indent.length, end: item.bodyStart, insert: '' }
}

/** Tab / Shift+Tab on a list line indents or outdents it by two spaces. */
export function tabEdit(text, caret, outdent) {
  const item = itemOf(text, caret)
  if (!item) return null
  if (!outdent) return { start: item.start, end: item.start, insert: '  ', caret: caret + 2 }
  const cut = Math.min(2, item.indent.length)
  return cut ? { start: item.start, end: item.start + cut, insert: '', caret: caret - cut } : { none: true }
}

/** Flip a circle between open and done. `pos` is where the circle is. */
export function toggleEdit(text, pos) {
  const c = text[pos]
  if (c !== OPEN && c !== DONE) return null
  return { start: pos, end: pos + 1, insert: c === OPEN ? DONE : OPEN }
}

/** The text with the edit applied (for tests and fallbacks). */
export function apply(text, edit) {
  return text.slice(0, edit.start) + edit.insert + text.slice(edit.end)
}
