"use client"

import { useEffect } from "react"

const SYNC_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const SYNC_KEY = "eh_last_sync"

export function AutoSync() {
  useEffect(() => {
    const last = parseInt(localStorage.getItem(SYNC_KEY) ?? "0", 10)
    if (Date.now() - last < SYNC_INTERVAL_MS) return

    // Fire and forget — don't block UI
    Promise.allSettled([
      fetch("/api/sync/oura", { method: "POST" }),
      fetch("/api/sync/calendar", { method: "POST" }),
    ]).then(() => {
      localStorage.setItem(SYNC_KEY, String(Date.now()))
    })
  }, [])

  return null
}
