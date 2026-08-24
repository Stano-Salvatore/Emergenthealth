"use client"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { agoLabel, isStale, type SyncRun } from "@/lib/sync-status"

type Source = {
  id: string
  label: string
  what: string
  driver: "server" | "device"
  connected: boolean
  run: SyncRun | null
}

type Payload = {
  sources: Source[]
  cadenceMinutes: number
  newestHealthDate: string | null
}

/**
 * What synced, when, and whether it worked.
 *
 * Every line here is either something that was recorded or an explicit "not
 * known" — no source is described as fine because it hasn't complained. The
 * three states that matter are kept apart on purpose: not connected, connected
 * but never yet run, and ran and failed. Collapsing them is what lets a broken
 * sync look quiet for a week.
 */
export function SyncStatusCard() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [syncing, setSyncing] = useState(false)

  // The fetch is inlined so every setState follows an await rather than running
  // synchronously in the effect body, which cascades renders.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/sync-status")
        if (!res.ok) throw new Error()
        const d = await res.json()
        if (!cancelled) { setData(d); setError(false) }
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true }
  }, [nonce])

  /**
   * Run every connected source's sync, then re-read the status.
   *
   * allSettled rather than all: one source failing must not stop the others,
   * and a source that is not connected simply returns an error nobody needs to
   * see here — the row already says "Not connected".
   */
  async function syncNow() {
    setSyncing(true)
    try {
      await Promise.allSettled(
        (data?.sources ?? [])
          .filter(s => s.connected && s.driver === "server")
          .map(s => fetch(`/api/sync/${s.id}`, { method: "POST" })),
      )
    } finally {
      setSyncing(false)
      // Re-read regardless: a sync that failed still updated its status, and
      // that is exactly what someone pressing this wants to see.
      setNonce(n => n + 1)
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sync status</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data
                ? `Server syncs run every ${data.cadenceMinutes} minutes — GitHub schedules those and can delay them, so the times below are when one last actually finished, not when it was due. Phone syncs run when you open the app, and only record their successes.`
                : " "}
            </p>
          </div>
          {/* This used to re-fetch the status and nothing else, which is why it
              read as broken: a refresh icon on a sync card promises a sync, and
              re-reading the same numbers changes nothing on screen. It runs the
              syncs now, then shows what they did. */}
          <Button size="sm" variant="ghost" onClick={syncNow} disabled={syncing}
            aria-label="Sync now" title="Sync now" className="shrink-0 h-8 w-8 p-0">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {error && <p className="text-xs text-red-400">Couldn&apos;t load sync status.</p>}
        {!data && !error && <p className="text-xs text-muted-foreground">Loading…</p>}

        {data && (
          <div className="space-y-1.5">
            {data.sources.map(s => {
              // Only server-driven sources can be overdue. A device source
              // syncs when the phone syncs it, so a long gap means the app has
              // not been opened — calling that a fault would be inventing one.
              const stale = s.driver === "server" && s.connected && isStale(s.run ?? undefined)
              const ago = agoLabel(s.run?.at)
              return (
                <div key={s.id} className="flex items-start justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">{s.what}</p>
                    {s.run && !s.run.ok && s.run.error && (
                      <p className="text-[11px] text-red-400 mt-0.5 break-words">{s.run.error}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {!s.connected ? (
                      <span className="text-[11px] text-muted-foreground/60">Not connected</span>
                    ) : !s.run ? (
                      // Connected but never observed running: not the same as
                      // healthy, and not the same as broken.
                      <span className="text-[11px] text-amber-400">No sync recorded yet</span>
                    ) : (
                      <>
                        <span className={`text-[11px] font-medium ${
                          !s.run.ok ? "text-red-400" : stale ? "text-amber-400" : "text-emerald-400"
                        }`}>
                          {!s.run.ok ? "Failed" : stale ? "Overdue" : "OK"}
                        </span>
                        <p className="text-[11px] text-muted-foreground">{ago}</p>
                        {s.driver === "device" && (
                          <p className="text-[11px] text-muted-foreground/60">last success</p>
                        )}
                        {s.run.ok && s.run.items != null && (
                          <p className="text-[11px] text-muted-foreground/60">
                            {s.run.items === 0 ? "nothing new" : `${s.run.items} updated`}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {data?.newestHealthDate && (
          <p className="text-[11px] text-muted-foreground pt-1">
            Freshest health day held: <span className="text-foreground/80">{data.newestHealthDate}</span>
            {" — a second opinion, in case a sync reports success and brings back nothing."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
