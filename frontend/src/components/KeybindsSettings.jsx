import { Button, card } from './ui.jsx'
import { useEffect, useState } from 'react'
import { useKeybinds } from '../context/KeybindsContext.jsx'
import { SHORTCUTS, PAGE_SHORTCUTS, ALL_SHORTCUTS, comboFromEvent, displayCombo, validCombo } from '../lib/keybinds.js'

// Settings → Keyboard shortcuts. Click a shortcut, press the new keys.
export default function KeybindsSettings() {
  const { bindings, setBinding, resetBinding, setCapturing } = useKeybinds()
  const [editing, setEditing] = useState(null)
  const [warning, setWarning] = useState(null)

  useEffect(() => {
    if (!editing) return
    setCapturing(true)
    const onKey = e => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setEditing(null); setWarning(null); return }
      const combo = comboFromEvent(e)
      if (!combo) return   // just a modifier so far
      if (!validCombo(combo)) {
        setWarning('Include Ctrl, ⌘ or Alt, so the shortcut doesn’t get in the way of typing.')
        return
      }
      const clash = ALL_SHORTCUTS.find(s => s.id !== editing && bindings[s.id] === combo)
      setBinding(editing, combo)
      setWarning(clash ? `${displayCombo(combo)} was “${clash.label}”; that one now has no shortcut.` : null)
      setEditing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); setCapturing(false) }
  }, [editing, bindings, setBinding, setCapturing])

  const row = (s, i) => {
    const combo = bindings[s.id]
    const isEditing = editing === s.id
    return (
      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid var(--bd-sm)' : 'none' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--ink)' }}>{s.label}</div>
          {s.hint && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{s.hint}</div>}
        </div>
        {combo !== s.default && !isEditing && (
          <Button variant="link" onClick={() => { resetBinding(s.id); setWarning(null) }} style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
            Reset
          </Button>
        )}
        <button onClick={() => { setEditing(isEditing ? null : s.id); setWarning(null) }}
          aria-label={`Change shortcut for ${s.label}`}
          style={{ minWidth: 92, fontSize: 13, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                   border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--bd-xl)'}`, background: 'var(--surface-2)',
                   color: isEditing ? 'var(--accent)' : combo ? 'var(--ink)' : 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>
          {isEditing ? 'Press keys…' : combo ? displayCombo(combo) : 'None'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ ...card, padding: 0, borderRadius: 12, overflow: 'hidden' }}>
      {SHORTCUTS.map(row)}
      <div style={{ padding: '14px 16px 6px', borderTop: '1px solid var(--bd-sm)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        Pages
        <div style={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginTop: 3 }}>
          Ctrl+1–9 work in the installed app. In a browser tab the browser keeps them for switching tabs, so pick other keys there if you need to.
        </div>
      </div>
      {PAGE_SHORTCUTS.map(row)}
      {(warning || editing) && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--bd-sm)', fontSize: 12.5, color: warning ? 'var(--accent)' : 'var(--muted)', background: 'var(--surface-2)' }}>
          {warning || 'Press the new combination, or Esc to cancel.'}
        </div>
      )}
    </div>
  )
}
