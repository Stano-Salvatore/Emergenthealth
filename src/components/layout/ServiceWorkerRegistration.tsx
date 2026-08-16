"use client"

import { useEffect } from "react"

// The native app is a thin shell that loads the live site (server.url in
// capacitor.config.ts), so a service worker caching that shell can pin the
// phone to a build the server has long since replaced — a failure mode that
// presents as "notifications don't work on this phone" when the truth is the
// WebView is running last month's code. Offline caching buys the shell nothing
// it needs, so inside the app the worker isn't just skipped: any worker and
// caches already installed are removed, which cleans up phones that got stuck
// before this change. The shell is detected by the user agent suffix the
// Capacitor config appends, deliberately not via the Capacitor JS bridge —
// when the bridge itself is what's broken, this cleanup still has to run.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    if (navigator.userAgent.includes("Emergenthealth-Capacitor")) {
      navigator.serviceWorker
        .getRegistrations()
        .then(regs => Promise.all(regs.map(r => r.unregister())))
        .catch(() => {})
      if ("caches" in window) {
        caches
          .keys()
          .then(keys => Promise.all(keys.map(k => caches.delete(k))))
          .catch(() => {})
      }
      return
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])

  return null
}
