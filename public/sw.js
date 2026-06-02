const CACHE = "emergenthealth-v2"

// Static shell assets worth caching offline
const PRECACHE = ["/", "/dashboard", "/offline", "/signin", "/pricing"]

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

self.addEventListener('push', function(event) {
  let data = { title: 'Emergy 🌱', body: 'Check in on your health!', url: '/dashboard' }
  try { data = { ...data, ...event.data.json() } } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url },
    })
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data?.url ?? '/dashboard'))
})
