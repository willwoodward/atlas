import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { BinButton, card } from './ui.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * The browser helper on the laptop (helper/ in the repo): whether it's
 * connected, which sites it allows, and the notes Atlas has kept on how each
 * site works. Sites are changed in the helper's own config, on purpose: the
 * server can't widen them.
 */
export default function BrowserHelperCard() {
  const { token } = useAuth()
  const [status, setStatus] = useState(null)
  const [notes, setNotes] = useState([])
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    const h = { Authorization: `Bearer ${token}` }
    const [s, n] = await Promise.all([
      fetch(`${API}/api/browser/status`, { headers: h }).then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${API}/api/browser/notes`, { headers: h }).then(r => (r.ok ? r.json() : [])).catch(() => []),
    ])
    setStatus(s)
    setNotes(Array.isArray(n) ? n : [])
  }, [token])

  useEffect(() => {
    if (!token) return
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [token, load])

  const forget = async site => {
    await fetch(`${API}/api/browser/notes/${encodeURIComponent(site)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    setNotes(ns => ns.filter(n => n.site !== site))
  }

  const connected = !!status?.connected
  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Browser helper</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: connected ? 'var(--sage)' : 'var(--muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? 'var(--sage)' : 'var(--faint)' }} />
          {status === null ? 'Checking…' : connected ? 'Connected' : 'Not running'}
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.45 }}>
        Lets Atlas fill in bookings in a separate browser on your laptop, then hand the page to you to pay. It never
        pays, types card details or logs in. Run it from <code>helper/</code> in the repo.
      </div>
      {connected && status.sites?.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--mid)', marginTop: 10 }}>
          Allowed sites: <span style={{ color: 'var(--ink)' }}>{status.sites.join(', ')}</span>
          <span style={{ color: 'var(--muted)' }}> · change them in the helper’s config</span>
        </div>
      )}

      {notes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 6 }}>What Atlas has learned about each site</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {notes.map(n => (
              <div key={n.site} style={{ border: '1px solid var(--bd-xs)', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={() => setOpen(o => (o === n.site ? null : n.site))} aria-expanded={open === n.site}
                    style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13.5, color: 'var(--ink)' }}>
                    {n.site}
                  </button>
                  <BinButton size={26} title="Forget these notes" onClick={() => forget(n.site)} />
                </div>
                {open === n.site && (
                  <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--mid)', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{n.notes}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
