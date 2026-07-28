"use client"

/**
 * Invisibly syncs the phone's native calendars (Samsung / local / any account)
 * to the server whenever the app returns to the foreground. Runs only inside
 * the Capacitor Android app and only once calendar permission has already been
 * granted — it never prompts on its own; the Settings card owns the first grant.
 * Throttled to once per hour. No-ops on the web.
 */

import { useEffect } from "react"
import {
  isDeviceCalendarAvailable,
  getPermissionState,
  syncToServer,
} from "@/lib/native/device-calendar"

const THROTTLE_MS = 60 * 60 * 1000
const LS_KEY = "device_cal_last_auto_sync"

export function DeviceCalendarAutoSync() {
  useEffect(() => {
    let enabled = false

    isDeviceCalendarAvailable().then(async (available) => {
      if (!available) return
      const perm = await getPermissionState()
      if (perm === "granted") enabled = true
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
