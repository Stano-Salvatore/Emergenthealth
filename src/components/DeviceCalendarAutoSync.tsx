"use client"

/**
 * Invisibly syncs the phone's native calendars (Samsung / local / any account)
 * to the server on a cold start and whenever the app returns to the
 * foreground. Runs only inside the Capacitor Android app and only once
 * calendar permission has already been granted — it never prompts on its own;
 * the Settings card owns the first grant. Throttled to once per hour. No-ops
 * on the web.
 */

import { useEffect } from "react"
import {
  isDeviceCalendarAvailable,
  getPermissionState,
  syncToServer,
} from "@/lib/native/device-calendar"
import { syncOnForeground } from "@/lib/foreground-sync"

const THROTTLE_MS = 60 * 60 * 1000
const LS_KEY = "device_cal_last_auto_sync"

export function DeviceCalendarAutoSync() {
  useEffect(() => syncOnForeground({
    ready: async () => (await isDeviceCalendarAvailable()) && (await getPermissionState()) === "granted",
    sync: syncToServer,
    storageKey: LS_KEY,
    throttleMs: THROTTLE_MS,
  }), [])

  return null
}
