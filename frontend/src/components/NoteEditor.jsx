import { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react'
import {
  toDisplay, toMarkdown, splitNote, joinNote, lineAt, autoMarker, enterEdit, backspaceEdit, tabEdit, toggleEdit,
  BULLET, DONE, forClipboard,
} from '../lib/noteFormat.js'

// Where a note is written: a heading-style title, then the body. In the body,
// `- ` makes a bullet and `o ` or `0 ` makes a circle you can tap to tick off
// (see lib/noteFormat.js). The note is saved as Markdown.
//
// The body is one ordinary <textarea> so selecting, copying and undo behave as
// they should. Its text is invisible; a copy of the text sits behind it with
// the same fonts and wrapping, and that copy is what you see, so the circles
// can be drawn and ticked-off lines greyed.

// Replace part of the text the way typing would, so Undo steps through it.
function applyEdit(ta, edit) {
  ta.focus()
  ta.setSelectionRange(edit.start, edit.end)
  let ok = false
  try { ok = edit.insert === '' ? document.execCommand('delete') : document.execCommand('insertText', false, edit.insert) } catch { /* below */ }
  if (!ok) {
    ta.setRangeText(edit.insert, edit.start, edit.end, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  if (edit.caret != null) ta.setSelectionRange(edit.caret, edit.caret)
}

function Mirror({ text }) {
  const lines = text.split('\n')
  let offset = 0
  return lines.map((line, i) => {
    const m = /^([ \t]*)([\u2001\u2002\u2003])/.exec(line)
    const at = offset
    offset += line.length + 1
    const nl = i < lines.length - 1 ? '\n' : '\u200b'
    if (!m) return <span key={i}>{line}{nl}</span>
    const kind = m[2] === BULLET ? 'dot' : m[2] === DONE ? 'done' : 'open'
    return (
      <span key={i} className={kind === 'done' ? 'ne-line-done' : undefined}>
        {m[1]}<span className={`ne-mark ne-${kind}`} data-pos={at + m[1].length}>{m[2]}</span>
        <span className="ne-text">{line.slice(m[1].length + 1)}</span>{nl}
      </span>
    )
  })
}

/**
 * value: the note as Markdown. onChange(markdown) is called as it's edited.
 * focus: 'title' | 'body' | null — where the cursor starts.
 * Give it a key per note: it reads `value` once, when it appears.
 */
export default function NoteEditor({ value, onChange, focus = 'body', isMobile = false }) {
  const [init] = useState(() => splitNote(value))
  const [title, setTitle] = useState(init.title)
  const [text, setText] = useState(() => toDisplay(init.rest))
  const prefix = useRef(init.prefix || (init.title === '' && init.rest === '' ? '# ' : ''))
  const titleRef = useRef(null)
  const bodyRef = useRef(null)
  const mirrorRef = useRef(null)
  const latest = useRef({ title, text })
  latest.current = { title, text }

  const emit = useCallback((nextTitle, nextText) => {
    onChange(joinNote({ prefix: prefix.current, title: nextTitle, rest: toMarkdown(nextText) }))
  }, [onChange])

  const grow = useCallback(() => {
    for (const el of [titleRef.current, bodyRef.current]) {
      if (!el) continue
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [])
  useLayoutEffect(grow, [title, text, grow])
  useEffect(() => {
    window.addEventListener('resize', grow)
    return () => window.removeEventListener('resize', grow)
  }, [grow])

  useEffect(() => {
    const el = focus === 'title' ? titleRef.current : focus === 'body' ? bodyRef.current : null
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // After a space, `o ` / `0 ` / `- ` at the start of a line becomes a circle
  // or bullet. Done on the finished input (not the key) so phone keyboards work.
  useEffect(() => {
    const ta = bodyRef.current
    let busy = false
    const onInput = e => {
      if (busy || e.inputType !== 'insertText' || e.data !== ' ' || ta.selectionStart !== ta.selectionEnd) return
      const edit = autoMarker(ta.value, ta.selectionStart)
      if (!edit) return
      busy = true
      try { applyEdit(ta, edit) } finally { busy = false }
    }
    ta.addEventListener('input', onInput)
    return () => ta.removeEventListener('input', onInput)
  }, [])

  const onBodyChange = e => {
    setText(e.target.value)
    emit(latest.current.title, e.target.value)
  }

  const onBodyKeyDown = e => {
    if (e.nativeEvent.isComposing) return
    const ta = e.currentTarget
    const collapsed = ta.selectionStart === ta.selectionEnd
    const caret = ta.selectionStart
    let edit = null
    if (collapsed && e.key === 'Enter' && !e.shiftKey) edit = enterEdit(ta.value, caret)
    else if (collapsed && e.key === 'Backspace') {
      edit = backspaceEdit(ta.value, caret)
      // At the very start, Backspace goes up to the end of the title.
      if (!edit && caret === 0) { e.preventDefault(); titleRef.current.focus(); const n = titleRef.current.value.length; titleRef.current.setSelectionRange(n, n); return }
    } else if (collapsed && e.key === 'Tab') edit = tabEdit(ta.value, caret, e.shiftKey)
    if (!edit) return
    e.preventDefault()
    if (!edit.none) applyEdit(ta, edit)
  }

  // Tapping a circle ticks it. Found by where it is on screen: the circles live in the copy behind the text.
  const onBodyClick = e => {
    const ta = e.currentTarget
    if (ta.selectionStart !== ta.selectionEnd) return
    for (const box of mirrorRef.current.querySelectorAll('.ne-open, .ne-done')) {
      const r = box.getBoundingClientRect()
      if (e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top && e.clientY <= r.bottom) {
        const edit = toggleEdit(ta.value, Number(box.dataset.pos))
        if (edit) applyEdit(ta, { ...edit, caret: lineAt(ta.value, edit.start).end })
        return
      }
    }
  }

  // Copying out of the editor gives the visible symbols, not the invisible spaces behind them.
  const onBodyCopy = e => {
    const ta = e.currentTarget
    const picked = ta.value.slice(ta.selectionStart, ta.selectionEnd)
    if (!picked) return
    e.clipboardData.setData('text/plain', forClipboard(picked))
    e.preventDefault()
    if (e.type === 'cut') applyEdit(ta, { start: ta.selectionStart, end: ta.selectionEnd, insert: '' })
  }

  const onTitleChange = e => {
    const v = e.target.value.replace(/\s*\n\s*/g, ' ')
    setTitle(v)
    emit(v, latest.current.text)
  }

  const toBody = (atStart) => {
    const ta = bodyRef.current
    ta.focus()
    const n = atStart ? 0 : ta.value.length
    ta.setSelectionRange(n, n)
  }

  const onTitleKeyDown = e => {
    if (e.nativeEvent.isComposing) return
    const t = e.currentTarget
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && t.selectionStart === t.value.length)) {
      e.preventDefault()
      toBody(true)
    }
  }

  const bodyFont = { fontFamily: 'var(--font-sans)', fontSize: isMobile ? 17 : 15, lineHeight: 1.75 }

  return (
    <div className="ne">
      <textarea
        ref={titleRef}
        className="ne-title"
        rows={1}
        value={title}
        placeholder="Title"
        aria-label="Title"
        onChange={onTitleChange}
        onKeyDown={onTitleKeyDown}
        style={{ fontSize: isMobile ? 28 : 30 }}
      />
      <div className="ne-body" style={bodyFont} onClick={e => { if (e.target === e.currentTarget) toBody(false) }}>
        <div ref={mirrorRef} className="ne-mirror" aria-hidden="true"><Mirror text={text} /></div>
        <textarea
          ref={bodyRef}
          className="ne-input"
          value={text}
          placeholder="Start writing…"
          aria-label="Note"
          onChange={onBodyChange}
          onKeyDown={onBodyKeyDown}
          onClick={onBodyClick}
          onCopy={onBodyCopy}
          onCut={onBodyCopy}
          style={bodyFont}
        />
      </div>
    </div>
  )
}
