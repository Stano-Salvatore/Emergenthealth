const CACHE = "emergenthealth-v1"

// Static shell assets worth caching offline
const PRECACHE = ["/", "/dashboard", "/offline"]

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url)

  // Let API, auth, and external requests go straight to network
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.origin !== self.location.origin
  ) {
    return
  }

  // Network-first for navigation (always fresh dashboard)
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match("/offline").then((r) => r ?? caches.match("/"))
      )
    )
    return
  }

  // Cache-first for static assets (JS, CSS, fonts, images)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached
      return fetch(e.request).then((res) => {
        if (res.ok && e.request.method === "GET") {
          const clone = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, clone))
        }
        return res
      })
    })
  )
})

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  const data = e.data?.json?.() ?? {}
  const title = data.title ?? 'Emergenthealth'
  const body = data.body ?? 'Time to check in!'
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag ?? 'emergenthealth',
      data: { url: data.url ?? '/dashboard/checkin' },
      requireInteraction: false,
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = e.notification.data?.url ?? '/dashboard/checkin'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(self.location.origin))
      if (existing) return existing.focus().then(() => existing.navigate(url))
      return clients.openWindow(url)
    })
  )
})
