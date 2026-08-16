// v4: app-shell speed pass. Navigations and RSC payloads are served from
// cache instantly and revalidated in the background (stale-while-revalidate),
// so tab switches feel native even on slow connections. Build assets are
// cache-first (they're content-hashed and immutable).
// v7 stops serving cached HTML to navigations. A cached document embeds the
// build it came from — Server Action ids, the Next build id — so after a
// deploy the old page posts an action the server no longer has and the app
// dies on "Failed to find Server Action". Documents are network-first now;
// the cache is only a fallback for being offline. Static assets are
// content-hashed and stay cache-first.
//
// v6 fixes an APK-bricking bug: precaching "/" and "/dashboard" followed
// their auth redirects, and serving a redirect-followed response to a
// navigation is forbidden — the browser fails the load with net::ERR_FAILED.
// Redirected responses are never cached or served to navigations now, and
// only the redirect-free /offline page is precached.
// v8 exists to reach a device that is already stuck. A long-lived WebView page
// can keep running a build whose lazily-loaded chunks no longer exist on the
// server: the app shell comes from cache, the chunk 404s, and the feature it
// belonged to silently isn't there. That is what made a phone insist for a day
// that it couldn't send notifications while the plugin sat installed and
// working. Nothing the page could load would fix it, because loading was the
// broken part.
//
// A service worker is the one thing that still updates in that state — the
// page re-registers on every load and the browser re-fetches this file — so
// activating a new version drops every cache and sends the open pages back to
// the network for a fresh build. It self-heals without anyone clearing storage
// by hand (which, in an installed app, also signs them out).
const VERSION = "v8"
const STATIC_CACHE = `emergenthealth-static-${VERSION}`
const PAGES_CACHE = `emergenthealth-pages-${VERSION}`

const PRECACHE = ["/offline"]

// Only same-origin, non-redirected 200s are safe to cache — a stored
// redirected response served to a navigation hard-fails the page load.
function cacheable(res) {
  return res.ok && !res.redirected && res.type === "basic"
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(PAGES_CACHE).then((c) => c.addAll(PRECACHE).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Everything, not just the caches this version doesn't recognise: a shell
    // cached under the current names is exactly what pins a page to a build
    // that no longer exists.
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    await self.clients.claim()

    // Activation happens once per version, so this can't loop. Pages already
    // open are the ones stuck on the old build, and they will not pick up a
    // new one on their own.
    const clients = await self.clients.matchAll({ type: "window" })
    for (const client of clients) {
      try { client.navigate(client.url) } catch { /* not navigable — next open will do */ }
    }
  })())
})

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const res = await fetch(request)
  if (cacheable(res)) cache.put(request, res.clone())
  return res
}

// Serve cached copy immediately, refresh it in the background. First visit
// (nothing cached) falls through to network; offline navigations get the
// offline page.
async function staleWhileRevalidate(event) {
  const cache = await caches.open(PAGES_CACHE)
  let cached = await cache.match(event.request)
  // Defensive: purge any redirected entry left by earlier SW versions —
  // serving it to a navigation would net::ERR_FAILED the page.
  if (cached && cached.redirected) {
    cache.delete(event.request).catch(() => {})
    cached = undefined
  }
  const network = fetch(event.request)
    .then((res) => {
      if (cacheable(res)) cache.put(event.request, res.clone())
      return res
    })
    .catch(() => null)

  // Explicit reloads must reach the server: layout/zoom toggles call
  // location.reload() expecting freshly rendered viewport meta from the new
  // cookie — serving the cached page here would undo the toggle.
  const isReload = ["reload", "no-cache", "no-store"].includes(event.request.cache)
  if (cached && !isReload) {
    event.waitUntil(network)
    return cached
  }
  if (isReload) {
    const res = await network
    if (res) return res
  }
  if (cached) return cached
  const res = await network
  if (res) return res
  if (event.request.mode === "navigate") {
    const offline = await cache.match("/offline")
    if (offline) return offline
    const home = await cache.match("/")
    if (home) return home
  }
  return Response.error()
}

// Documents: always ask the server, fall back to the cache only when the
// network is unreachable. Costs a round trip on navigation and buys immunity
// to every stale-deployment failure.
async function networkFirst(event) {
  const cache = await caches.open(PAGES_CACHE)
  try {
    const res = await fetch(event.request)
    if (cacheable(res)) cache.put(event.request, res.clone())
    return res
  } catch {
    const cached = await cache.match(event.request)
    if (cached && !cached.redirected) return cached
    const offline = await cache.match("/offline")
    if (offline) return offline
    return Response.error()
  }
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin) return

  // Live data stays live — API/auth requests never touch the SW caches
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return

  // Immutable build output + static resources
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    ["style", "script", "font", "image"].includes(e.request.destination)
  ) {
    e.respondWith(cacheFirst(e.request))
    return
  }

  // Documents must match the running deployment; everything else (RSC
  // payloads and the like) can still come from cache first.
  if (e.request.mode === "navigate" || e.request.destination === "document") {
    e.respondWith(networkFirst(e))
    return
  }

  e.respondWith(staleWhileRevalidate(e))
})

self.addEventListener("push", function (event) {
  let data = {
    title: "Emergy 🌱",
    body: "Check in on your health!",
    url: "/dashboard",
    tag: "general",
    requireInteraction: false,
  }
  try { data = { ...data, ...event.data.json() } } catch {}

  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    renotify: data.tag !== "general",
    requireInteraction: data.requireInteraction,
    vibrate: [100, 50, 100],
    data: { url: data.url },
    actions: String(data.tag).startsWith("habit")
      ? [{ action: "open", title: "Log habits" }]
      : String(data.tag).startsWith("water")
      ? [{ action: "open", title: "Log water" }]
      : [],
  }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

self.addEventListener("notificationclick", function (event) {
  event.notification.close()
  const url = event.notification.data?.url ?? "/dashboard"
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})
