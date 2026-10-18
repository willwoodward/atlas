import { describe, it, expect } from 'vitest'
import { comboFromEvent, validCombo, displayCombo, PAGE_SHORTCUTS, ALL_SHORTCUTS, SHORTCUTS } from '../keybinds.js'

const key = (code, key, mods = {}) => ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

describe('comboFromEvent', () => {
  it('treats Ctrl and ⌘ as the same Mod key', () => {
    expect(comboFromEvent(key('KeyK', 'k', { ctrlKey: true }))).toBe('Mod+K')
    expect(comboFromEvent(key('KeyK', 'k', { metaKey: true }))).toBe('Mod+K')
  })
  it('names the physical key, so Shift does not change it', () => {
    expect(comboFromEvent(key('Period', '>', { ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+.')
    expect(comboFromEvent(key('Digit1', '!', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+1')
  })
  it('ignores a bare modifier press', () => {
    expect(comboFromEvent(key('ControlLeft', 'Control', { ctrlKey: true }))).toBeNull()
  })
})

describe('validCombo', () => {
  it('needs a modifier unless it is a function key', () => {
    expect(validCombo('Mod+K')).toBe(true)
    expect(validCombo('Alt+V')).toBe(true)
    expect(validCombo('F8')).toBe(true)
    expect(validCombo('K')).toBe(false)
    expect(validCombo('Shift+K')).toBe(false)
  })
})

describe('displayCombo', () => {
  it('shows Ctrl on Windows/Linux and symbols on a Mac', () => {
    expect(displayCombo('Mod+Shift+K', false)).toBe('Ctrl+Shift+K')
    expect(displayCombo('Mod+Shift+K', true)).toBe('⌘⇧K')
    expect(displayCombo('', false)).toBe('—')
  })
})

describe('page shortcuts', () => {
  it('Ctrl+1 to Ctrl+9 go down the sidebar, Ctrl+0 is the Assistant', () => {
    const by = Object.fromEntries(PAGE_SHORTCUTS.map(s => [s.page, s.default]))
    expect(by.home).toBe('Mod+1')
    expect(by.inbox).toBe('Mod+9')
    expect(by.assistant).toBe('Mod+0')
    expect(by.agents).toBe('')   // no number left; set one in Settings
  })
  it('no two shortcuts share a default', () => {
    const used = ALL_SHORTCUTS.map(s => s.default).filter(Boolean)
    expect(new Set(used).size).toBe(used.length)
    expect(ALL_SHORTCUTS.length).toBe(SHORTCUTS.length + PAGE_SHORTCUTS.length)
  })
})
