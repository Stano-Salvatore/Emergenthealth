"use client"

/**
 * Invisibly triggers a Health Connect → server sync whenever the page
 * becomes visible (tab/app returns to foreground). Works in both the
 * Capacitor Android WebView and the browser — no extra packages needed.
 * Throttled to once per hour. On non-Android or when Health Connect is
 * unavailable, it exits silently after the first check.
 */

import { useEffect } from "react"
import { syncToServer, checkAvailability } from "@/lib/health-connect-service"

const THROTTLE_MS = 60 * 60 * 1000
const LS_KEY = "hc_last_auto_sync"

export function HealthConnectAutoSync() {
  useEffect(() => {
    let enabled = false

    // One-time availability check on mount
    checkAvailability().then(av => {
      if (av === "Available") enabled = true
    })

    async function onVisible() {
      if (document.visibilityState !== "visible") return
      if (!enabled) return

      const last = localStorage.getItem(LS_KEY)
      if (last && Date.now() - parseInt(last) < THROTTLE_MS) return

      try {
        await syncToServer()
        localStorage.setItem(LS_KEY, String(Date.now()))
      } catch {
        // Swallow — background sync failures are non-critical
      }
    }

    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])

  return null
}
