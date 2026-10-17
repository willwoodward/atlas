// Inbox notifications (Web Push), loaded into the service worker Workbox
// generates (vite.config.js → workbox.importScripts). The server sends
// { title, body, tag, url }; see backend/push.py.

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(data.title || 'Atlas', {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: '/atlas/icons/192.png',
    badge: '/atlas/icons/192.png',
    data: { url: data.url || '/atlas/' },
  }))
})

// Tapping it: bring an open Atlas forward and tell it what to show, or open one.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/atlas/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).pathname.startsWith('/atlas/')) {
        client.postMessage({ type: 'atlas:open', url })
        return client.focus()
      }
    }
    return self.clients.openWindow(url)
  })())
})
