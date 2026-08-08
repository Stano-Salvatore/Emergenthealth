"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"

const SYNC_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const SYNC_KEY = "eh_last_sync"

export function AutoSync() {
  const [syncing, setSyncing] = useState(false)
  const router = useRouter()
  const running = useRef(false)

  const runSync = useCallback(async (force = false) => {
    if (running.current) return
    const last = parseInt(localStorage.getItem(SYNC_KEY) ?? "0", 10)
    if (!force && Date.now() - last < SYNC_INTERVAL_MS) return

    running.current = true
    setSyncing(true)
    try {
      // Check if YNAB is connected before including it in the sync batch
      const ynab = await fetch("/api/ynab/connect").then(r => r.json()).catch(() => ({ connected: false }))
      const syncs = [
        fetch("/api/sync/oura", { method: "POST" }),
        fetch("/api/sync/calendar", { method: "POST" }),
      ]
      if (ynab.connected) syncs.push(fetch("/api/sync/ynab", { method: "POST" }))
      await Promise.allSettled(syncs)
      localStorage.setItem(SYNC_KEY, String(Date.now()))
      // Pages are server-rendered from the DB *before* this sync runs, so
      // without a refresh the user keeps seeing pre-sync numbers (e.g. last
      // night's sleep missing because Oura published it after the cron ran).
      router.refresh()
    } finally {
      running.current = false
      setSyncing(false)
    }
  }, [router])

  useEffect(() => {
    runSync()

    // Re-sync when the app comes back to the foreground — the phone app is
    // usually resumed rather than cold-started, so mount alone isn't enough.
    const onVisible = () => { if (document.visibilityState === "visible") runSync() }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [runSync])

  if (!syncing) return null

  return (
    <div
      style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
      className="fixed right-4 z-30 flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1.5 text-xs text-muted-foreground shadow-lg"
    >
      <RefreshCw className="h-3 w-3 animate-spin" />
      Syncing…
    </div>
  )
}
