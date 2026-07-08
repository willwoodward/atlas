import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Handle OAuth popup redirect — runs before React mounts.
// When Google redirects back to our app inside the popup window,
// we extract the token, post it to the opener, and close.
;(() => {
  if (!window.opener) return
  const hash = window.location.hash
  if (!hash) return
  const params = new URLSearchParams(hash.slice(1))
  const accessToken = params.get('access_token')
  if (!accessToken) return

  const state = params.get('state') || ''
  const expiresIn = parseInt(params.get('expires_in') || '3600', 10)

  if (state === 'atlas-auth') {
    // App login — send access_token for backend verification
    window.opener.postMessage(
      { type: 'ATLAS_AUTH', access_token: accessToken },
      window.location.origin
    )
  } else {
    // Google Calendar token (existing behaviour)
    window.opener.postMessage(
      { type: 'ATLAS_OAUTH', provider: 'google', token: accessToken, expiresAt: Date.now() + expiresIn * 1000 },
      window.location.origin
    )
  }
  window.close()
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
