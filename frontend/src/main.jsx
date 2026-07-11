import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Handle OAuth popup redirect — runs before React mounts.
;(() => {
  if (!window.opener) return

  // ── GCal authorization code flow ────────────────────────────────────────
  // Google redirects here with ?code=...&state=atlas-gcal in the query string
  const search = new URLSearchParams(window.location.search)
  const code = search.get('code')
  const state = search.get('state')

  if (code && state === 'atlas-gcal') {
    // Mark so React doesn't mount (we'll close this window after exchange)
    window.__ATLAS_POPUP_PENDING = true
    const jwt = localStorage.getItem('atlas:jwt')
    const redirectUri = window.location.origin + (import.meta.env.BASE_URL || '/')
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'

    fetch(`${apiUrl}/auth/gcal/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    })
      .then(() => {
        window.opener?.postMessage(
          { type: 'ATLAS_OAUTH', provider: 'google', connected: true },
          window.location.origin
        )
      })
      .catch(() => {})
      .finally(() => window.close())
    return
  }

  // ── Implicit / hash-based flows (app login) ──────────────────────────────
  const hash = window.location.hash
  if (!hash) return
  const params = new URLSearchParams(hash.slice(1))
  const accessToken = params.get('access_token')
  if (!accessToken) return

  const hashState = params.get('state') || ''

  if (hashState === 'atlas-auth') {
    // App login — send access_token for backend verification
    window.opener.postMessage(
      { type: 'ATLAS_AUTH', access_token: accessToken },
      window.location.origin
    )
  }
  window.close()
})()

// Don't mount React if we're in the middle of an async popup exchange
if (!window.__ATLAS_POPUP_PENDING) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
