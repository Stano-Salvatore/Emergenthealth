"use client"

/**
 * Invisibly triggers a Health Connect → server sync on a cold start and
 * whenever the page becomes visible again (app returns to foreground).
 * Throttled to once per hour. Outside the Android shell, or when Health
 * Connect is unavailable, it exits silently after the first check — the
 * service itself refuses to touch the plugin in a browser.
 */

import { useEffect } from "react"
import { syncToServer, checkAvailability, permissionsByType } from "@/lib/health-connect-service"
import { syncOnForeground } from "@/lib/foreground-sync"

const THROTTLE_MS = 60 * 60 * 1000
const LS_KEY = "hc_last_auto_sync"

export function HealthConnectAutoSync() {
  useEffect(() => syncOnForeground({
    ready: async () => (await checkAvailability()) === "Available",
    sync: async () => {
      // Installed but never connected: nothing to read, and no outcome worth
      // recording over the Settings card's own.
      if (!(await permissionsByType())?.granted.length) return
      await syncToServer()
    },
    storageKey: LS_KEY,
    throttleMs: THROTTLE_MS,
  }), [])

  return null
}
