"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"

const SYNC_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const SYNC_KEY = "eh_last_sync"

export function AutoSync() {
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const last = parseInt(localStorage.getItem(SYNC_KEY) ?? "0", 10)
    if (Date.now() - last < SYNC_INTERVAL_MS) return

    setSyncing(true)

    // Check if YNAB is connected before including it in the sync batch
    const ynabCheck = fetch("/api/ynab/connect").then(r => r.json()).catch(() => ({ connected: false }))

    ynabCheck.then(ynab => {
      const syncs = [
        fetch("/api/sync/oura", { method: "POST" }),
        fetch("/api/sync/calendar", { method: "POST" }),
      ]
      if (ynab.connected) syncs.push(fetch("/api/sync/ynab", { method: "POST" }))
      return Promise.allSettled(syncs)
    }).then(() => {
      localStorage.setItem(SYNC_KEY, String(Date.now()))
    }).finally(() => {
      setSyncing(false)
    })
  }, [])

  if (!syncing) return null

  return (
    <div className="fixed top-4 right-4 z-30 flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1.5 text-xs text-muted-foreground shadow-lg">
      <RefreshCw className="h-3 w-3 animate-spin" />
      Syncing…
    </div>
  )
}
