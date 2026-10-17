import { useEffect, useState } from 'react'
import { useKeybinds } from '../context/KeybindsContext.jsx'
import { SHORTCUTS, comboFromEvent, displayCombo, validCombo } from '../lib/keybinds.js'

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
      const clash = SHORTCUTS.find(s => s.id !== editing && bindings[s.id] === combo)
      setBinding(editing, combo)
      setWarning(clash ? `${displayCombo(combo)} was “${clash.label}”; that one now has no shortcut.` : null)
      setEditing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); setCapturing(false) }
  }, [editing, bindings, setBinding, setCapturing])

  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
      {SHORTCUTS.map((s, i) => {
        const combo = bindings[s.id]
        const isEditing = editing === s.id
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid var(--bd-sm)' : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: 'var(--ink)' }}>{s.label}</div>
              {s.hint && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{s.hint}</div>}
            </div>
            {combo !== s.default && !isEditing && (
              <button onClick={() => { resetBinding(s.id); setWarning(null) }}
                style={{ fontSize: 12, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Reset
              </button>
            )}
            <button onClick={() => { setEditing(isEditing ? null : s.id); setWarning(null) }}
              aria-label={`Change shortcut for ${s.label}`}
              style={{ minWidth: 92, fontSize: 13, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                       border: `1px solid ${isEditing ? '#c15f3c' : 'var(--bd-xl)'}`, background: 'var(--surface-2)',
                       color: isEditing ? '#c15f3c' : combo ? 'var(--ink)' : 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>
              {isEditing ? 'Press keys…' : combo ? displayCombo(combo) : 'None'}
            </button>
          </div>
        )
      })}
      {(warning || editing) && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--bd-sm)', fontSize: 12.5, color: warning ? '#c15f3c' : 'var(--muted)', background: 'var(--surface-2)' }}>
          {warning || 'Press the new combination, or Esc to cancel.'}
        </div>
      )}
    </div>
  )
}
