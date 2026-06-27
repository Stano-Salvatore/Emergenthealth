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
import { syncReminderNotifications } from "@/lib/native/notifications"
import { syncScreenTime } from "@/lib/native/screen-time"

const THROTTLE_MS = 30 * 60 * 1000
const LS_KEY = "native_reminder_sync_at"

export function NativeBridge() {
  useEffect(() => {
    async function sync() {
      if (document.visibilityState !== "visible") return

      const last = localStorage.getItem(LS_KEY)
      if (last && Date.now() - parseInt(last) < THROTTLE_MS) return

      try {
        const res = await fetch("/api/reminders")
        if (res.ok) {
          const reminders = await res.json()
          if (Array.isArray(reminders)) await syncReminderNotifications(reminders)
        }
        // Pull today's screen time from the device and persist it (no-ops on web)
        await syncScreenTime()
        localStorage.setItem(LS_KEY, String(Date.now()))
      } catch {
        // Non-critical — ignore
      }
    }

    sync()
    document.addEventListener("visibilitychange", sync)
    return () => document.removeEventListener("visibilitychange", sync)
  }, [])

  return null
}
