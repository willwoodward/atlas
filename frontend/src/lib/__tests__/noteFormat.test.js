import { describe, it, expect } from 'vitest'
import {
  toDisplay, toMarkdown, splitNote, joinNote, autoMarker, enterEdit, backspaceEdit, tabEdit, toggleEdit, apply, forClipboard,
  BULLET, OPEN, DONE,
} from '../noteFormat.js'

// The tests are written with •, ○ and ● for readability; the editor's text uses invisible spaces of a known width.
const D = s => s.replaceAll('•', BULLET).replaceAll('○', OPEN).replaceAll('●', DONE)

describe('stored Markdown and what the editor shows', () => {
  const md = '# Shopping\nnotes\n- milk\n- [ ] eggs\n- [x] bread\n  - [ ] sub item\n* star'
  const shown = D('# Shopping\nnotes\n• milk\n○ eggs\n● bread\n  ○ sub item\n• star')

  it('shows bullets and circles', () => expect(toDisplay(md)).toBe(shown))
  it('writes them back as Markdown', () => expect(toMarkdown(shown)).toBe(md.replace('* star', '- star')))
  it('leaves other text alone', () => {
    const plain = 'Dear Sam,\n1. one\n**bold** --- text\n-no space\n\n'
    expect(toDisplay(plain)).toBe(plain)
    expect(toMarkdown(plain)).toBe(plain)
  })
  it('copies out as visible symbols', () => expect(forClipboard(D('• a\n○ b\n● c'))).toBe('• a\n○ b\n● c'))
  it('round-trips an empty item', () => expect(toMarkdown(toDisplay('- [ ] '))).toBe('- [ ] '))
})

describe('title', () => {
  it('splits off the first line and any #', () => {
    expect(splitNote('# Trip\n- a')).toEqual({ prefix: '# ', title: 'Trip', rest: '- a' })
    expect(splitNote('Just a line')).toEqual({ prefix: '', title: 'Just a line', rest: '' })
    expect(splitNote('')).toEqual({ prefix: '', title: '', rest: '' })
    expect(splitNote('\nbody')).toEqual({ prefix: '', title: '', rest: 'body' })
  })
  it('joins it back', () => {
    for (const s of ['# Trip\n- a', 'Just a line', '', '# T\n', '\nbody']) expect(joinNote(splitNote(s))).toBe(s === '# T\n' ? '# T' : s)
    expect(joinNote({ title: 'New', rest: '' })).toBe('# New')
    expect(joinNote({ title: '', rest: '' })).toBe('')
  })
})

describe('typing a marker', () => {
  it('o, 0, - and * followed by a space at the start of a line', () => {
    expect(apply('o ', autoMarker('o ', 2))).toBe(D('○ '))
    expect(apply('a\n0 milk', autoMarker('a\n0 milk', 4))).toBe(D('a\n○ milk'))
    expect(apply('- ', autoMarker('- ', 2))).toBe(D('• '))
    expect(apply('* ', autoMarker('* ', 2))).toBe(D('• '))
    expect(apply('  o ', autoMarker('  o ', 4))).toBe(D('  ○ '))
  })
  it('not in the middle of a line or word', () => {
    expect(autoMarker('hello o ', 8)).toBe(null)
    expect(autoMarker('so ', 3)).toBe(null)
    expect(autoMarker('10 ', 3)).toBe(null)
    expect(autoMarker(D('○ o '), 4)).toBe(null)
  })
})

describe('Enter, Backspace, Tab', () => {
  const enter = (t, caret = t.length) => apply(D(t), enterEdit(D(t), caret))
  it('Enter carries the list on, as an open circle even from a done one', () => {
    expect(enter('○ eggs')).toBe(D('○ eggs\n○ '))
    expect(enter('● eggs')).toBe(D('● eggs\n○ '))
    expect(enter('• milk')).toBe(D('• milk\n• '))
    expect(enter('  ○ a')).toBe(D('  ○ a\n  ○ '))
  })
  it('Enter in the middle splits the item', () => {
    expect(enter('○ ab', 3)).toBe(D('○ a\n○ b'))
  })
  it('Enter on an empty item ends the list', () => {
    expect(enter('x\n○ ')).toBe('x\n')
    expect(enterEdit('plain', 5)).toBe(null)
    expect(enterEdit(D('○ a'), 1)).toBe(null)
  })
  it('Backspace after the marker removes just the marker', () => {
    expect(apply(D('○ eggs'), backspaceEdit(D('○ eggs'), 2))).toBe('eggs')
    expect(apply(D('  • a'), backspaceEdit(D('  • a'), 4))).toBe('  a')
    expect(backspaceEdit(D('○ eggs'), 4)).toBe(null)
    expect(backspaceEdit('eggs', 0)).toBe(null)
  })
  it('Tab indents list lines by two spaces and Shift+Tab undoes it', () => {
    const t = tabEdit(D('○ a'), 3, false)
    expect(apply(D('○ a'), t)).toBe(D('  ○ a'))
    expect(t.caret).toBe(5)
    const u = tabEdit(D('  ○ a'), 5, true)
    expect(apply(D('  ○ a'), u)).toBe(D('○ a'))
    expect(u.caret).toBe(3)
    expect(tabEdit('plain', 2, false)).toBe(null)
    expect(tabEdit(D('○ a'), 3, true)).toEqual({ none: true })
  })
})

describe('tapping a circle', () => {
  it('flips it', () => {
    expect(apply(D('○ a'), toggleEdit(D('○ a'), 0))).toBe(D('● a'))
    expect(apply(D('● a'), toggleEdit(D('● a'), 0))).toBe(D('○ a'))
    expect(toggleEdit(D('• a'), 0)).toBe(null)
  })
})
