"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"

const SYNC_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const SYNC_KEY = "eh_last_sync"

const TAG_ISSUE_DISMISSED = "eh_tag_issue_dismissed"

export function AutoSync() {
  const [syncing, setSyncing] = useState(false)
  const [tagIssue, setTagIssue] = useState<string | null>(null)
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
      const jsonPost = (url: string, body: unknown) =>
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const ouraSync = fetch("/api/sync/oura", { method: "POST" })
      const syncs: Promise<unknown>[] = [
        ouraSync,
        // No calendar call here. /api/sync/calendar is a read despite the
        // name: it asks Google for events and returns them, storing nothing,
        // so there is no local copy for a background call to refresh. This
        // posted to it on every app open and got a 405 every time, because
        // that route only exports GET — and allSettled below meant nobody
        // ever heard about it. The calendar page fetches live when it renders.
        //
        // Connected-service syncs answer with a quick 4xx when not set up, so
        // it's safe to just attempt them all — everything fresh on app open.
        fetch("/api/sync/strava", { method: "POST" }),
        jsonPost("/api/lastfm", { action: "sync" }),
        jsonPost("/api/rescuetime", { action: "sync" }),
      ]
      if (ynab.connected) syncs.push(fetch("/api/sync/ynab", { method: "POST" }))
      await Promise.allSettled(syncs)

      // Tags silently failing (usually a pre-"tag"-scope Oura connection) is
      // invisible unless someone surfaces it — this is that someone.
      try {
        const res = await ouraSync
        const data = res.ok ? await res.clone().json() : null
        if (data?.tagsError && sessionStorage.getItem(TAG_ISSUE_DISMISSED) !== "1") {
          setTagIssue(String(data.tagsError))
        }
      } catch { /* sync result unavailable — skip the banner */ }

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

  return (
    <>
      {syncing && (
        <div
          style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
          className="fixed right-4 z-30 flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1.5 text-xs text-muted-foreground shadow-lg"
        >
          <RefreshCw className="h-3 w-3 animate-spin" />
          Syncing…
        </div>
      )}
      {tagIssue && (
        <div
          style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}
          className="fixed left-4 right-4 z-30 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/90 backdrop-blur px-3 py-2.5 text-xs text-amber-200 shadow-lg"
        >
          <span className="shrink-0">🏷️</span>
          <p className="flex-1">
            Oura tags aren&apos;t syncing: {tagIssue}{" "}
            <a href="/dashboard/settings" className="underline font-semibold">Open Settings</a>
          </p>
          <button
            aria-label="Dismiss"
            onClick={() => { sessionStorage.setItem(TAG_ISSUE_DISMISSED, "1"); setTagIssue(null) }}
            className="shrink-0 px-1 text-amber-200/60 hover:text-amber-200"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
