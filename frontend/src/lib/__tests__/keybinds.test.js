import { describe, it, expect } from 'vitest'
import { comboFromEvent, validCombo, displayCombo } from '../keybinds.js'

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
