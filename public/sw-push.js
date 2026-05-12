/**
 * sw-push.js — loaded inside the Workbox-generated service worker via importScripts.
 * Handles push events (show notification) and notificationclick events (open app).
 *
 * Served from /sw-push.js (public/) so the URL is stable across builds.
 */

/* global self, clients */

// ── Push event ──────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'BOS', body: event.data.text(), url: '/' }
  }

  const title = data.title || 'BOS'
  const options = {
    body:    data.body  || '',
    icon:    '/icon-192.png',
    badge:   '/icon-192.png',
    tag:     data.tag   || 'bos-notification',
    renotify: true,
    data:    { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Mở app' },
    ],
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If BOS is already open in a tab, focus it and post a navigate message
      // so the SPA can route via React Router (preserves state, processes query params)
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'bos-push-navigate', url })
          return client.focus()
        }
      }
      // Otherwise open a new window — query params processed on fresh load
      if (clients.openWindow) {
        return clients.openWindow(url)
      }
    })
  )
})
