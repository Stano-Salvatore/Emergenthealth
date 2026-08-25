"use client"

/**
 * Wires native phone capabilities into the app when running inside the
 * Capacitor Android WebView. No-ops in the browser.
 *
 * Currently: keeps the device's scheduled local notifications in sync with
 * the user's upcoming reminders, so reminders actually buzz the phone even
 * when the app is closed. Re-syncs on foreground, throttled to every 30 min.
 */

import { useEffect } from "react"
import { registerNotificationActionHandler, resyncNotifications } from "@/lib/native/notifications"
import { syncScreenTime } from "@/lib/native/screen-time"
import { registerNativePush } from "@/lib/native/bubble"

const THROTTLE_MS = 30 * 60 * 1000
const LS_KEY = "native_reminder_sync_at"

export function NativeBridge() {
  useEffect(() => {
    async function sync() {
      if (document.visibilityState !== "visible") return

      const last = localStorage.getItem(LS_KEY)
      if (last && Date.now() - parseInt(last) < THROTTLE_MS) return

      try {
        // Reschedule reminders + daily nudges as native notifications (no-ops on web)
        await resyncNotifications()
        // Pull today's screen time from the device and persist it (no-ops on web)
        await syncScreenTime()
        // Register for native push. Cheap, idempotent, and the token changes
        // on reinstall — so it is re-sent rather than assumed still good.
        await registerNativePush()
        localStorage.setItem(LS_KEY, String(Date.now()))
      } catch {
        // Non-critical — ignore
      }
    }

    // Not throttled with the sync below: the listener must exist every app
    // session, or button taps made while the app was closed are lost.
    registerNotificationActionHandler().catch(() => {})

    sync()
    document.addEventListener("visibilitychange", sync)
    return () => document.removeEventListener("visibilitychange", sync)
  }, [])

  return null
}
