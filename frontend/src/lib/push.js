// Notifications for the inbox, on this device (Web Push). The service worker
// side is public/push-sw.js; the server side backend/push.py.

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// iOS only allows notifications for the app added to the Home Screen.
export const needsInstall = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia?.('(display-mode: standalone)').matches && !navigator.standalone

const call = (token, path, body) => fetch(`${API}/inbox/push/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async r => {
  if (!r.ok) {
    let detail = ''
    try { detail = (await r.json()).detail } catch { /* not JSON */ }
    throw new Error(typeof detail === 'string' && detail ? detail : `Notifications: ${r.status}`)
  }
  return r.json()
})

// The VAPID key as the browser wants it: base64url → bytes.
function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function registration() {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, no) => setTimeout(() => no(new Error('The app’s service worker isn’t running here.')), 5000)),
  ])
  return reg
}

/** 'on' | 'off' | 'blocked' | 'unsupported' */
export async function pushStatus(token) {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  try {
    const reg = await registration()
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return 'off'
    const { subscribed } = await call(token, 'status', { endpoint: sub.endpoint })
    return subscribed ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

export async function enablePush(token) {
  if (!pushSupported()) throw new Error('This browser can’t show notifications.')
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings.')
  const reg = await registration()
  const { key } = await call(token, 'key')
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with a different key can't receive ours.
  if (sub && sub.options?.applicationServerKey) {
    const have = new Uint8Array(sub.options.applicationServerKey), want = keyBytes(key)
    if (have.length !== want.length || have.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null }
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
    } catch (e) {
      throw new Error(`This browser couldn’t sign up for notifications (${e.message || e.name}).`)
    }
  }
  await call(token, 'subscribe', sub.toJSON())
}

export async function disablePush(token) {
  const reg = await registration()
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await call(token, 'unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe()
}

export const testPush = token => call(token, 'test', {})
