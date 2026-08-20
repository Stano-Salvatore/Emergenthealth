"use client"

// "In my body" — one list of everything still circulating: caffeine at the
// user's own half-life, alcohol on its flat-rate clock, and any med or
// supplement whose half-life the app knows.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, RefreshCw } from "lucide-react"
import { hoursToBedtime } from "@/lib/caffeine"
import { PHARMA_DISCLAIMER } from "@/lib/supplement-info"

interface ActiveSubstance {
  kind: "caffeine" | "alcohol" | "med"
  name: string
  emoji: string
  amount: number
  unit: "mg" | "g" | "%"
  fraction?: number
  takenAt: string
  clearsAt: string | null
  detail?: string
  sourceId?: string
  doseLabel?: string | null
}

const KIND_COLOR: Record<ActiveSubstance["kind"], string> = {
  caffeine: "bg-amber-500",
  alcohol: "bg-violet-500",
  med: "bg-rose-500",
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
}

function agoLabel(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`
}

/** How far through its stay a substance is, for the progress bar. */
function progress(s: ActiveSubstance): number {
  if (s.fraction != null) return Math.min(100, Math.max(4, s.fraction * 100))
  if (!s.clearsAt) return 50
  const total = new Date(s.clearsAt).getTime() - new Date(s.takenAt).getTime()
  const left = new Date(s.clearsAt).getTime() - Date.now()
  if (total <= 0) return 4
  return Math.min(100, Math.max(4, (left / total) * 100))
}

export function BodyLoadTab() {
  const [substances, setSubstances] = useState<ActiveSubstance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch("/api/body-load")
      if (res.ok) {
        const d = await res.json()
        setSubstances(d.substances ?? [])
      }
    } catch { /* keep what's on screen */ }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  const [removing, setRemoving] = useState<string | null>(null)

  /**
   * Delete a dose logged by mistake. The half-life curve is only as good as
   * the row underneath it, so a wrong entry has to be removable from the
   * screen where it is wrong — not just from the Medications list.
   */
  const removeDose = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Remove the ${name} dose from your log?`)) return
    setRemoving(id)
    try {
      const res = await fetch(`/api/medications?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (res.ok) await load(true)
    } catch { /* leave the card in place */ }
    finally { setRemoving(null) }
  }, [load])

  useEffect(() => { load() }, [load])

  const bedH = hoursToBedtime()
  // What's still on board at 23:00 — the question that actually changes a decision
  const atBedtime = substances.filter(s => {
    if (!s.clearsAt) return false
    return (new Date(s.clearsAt).getTime() - Date.now()) / 3_600_000 > bedH
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {substances.length === 0
            ? "Nothing measurable circulating right now."
            : `${substances.length} substance${substances.length === 1 ? "" : "s"} still working through you.`}
        </p>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {substances.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-8 pb-8 text-center space-y-2">
            <p className="text-4xl">🫀</p>
            <p className="text-sm text-muted-foreground">Clear right now.</p>
            <p className="text-xs text-muted-foreground/60">
              Log a coffee, a drink or a dose and it&apos;ll appear here with how long it stays.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {substances.map(s => (
            <Card key={`${s.kind}:${s.name}`} className="border-border">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">
                    <span className="mr-1.5">{s.emoji}</span>{s.name}
                  </p>
                  <p className="text-sm font-black">
                    {s.unit === "%" ? `${s.amount}%` : s.unit === "g" ? `${s.amount} drinks` : `${s.amount} mg`}
                    <span className="text-[10px] font-medium text-muted-foreground ml-1">left</span>
                  </p>
                </div>

                <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-2">
                  <div
                    className={`h-full rounded-full transition-all ${KIND_COLOR[s.kind]}`}
                    style={{ width: `${progress(s)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <p className="text-[10px] text-muted-foreground">taken {agoLabel(s.takenAt)}</p>
                  {s.clearsAt && (
                    <p className="text-[10px] text-muted-foreground">
                      {s.kind === "alcohol" ? "clear by" : "negligible by"} {clock(s.clearsAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <p className="text-[10px] text-muted-foreground/60">
                    {[s.doseLabel, s.detail].filter(Boolean).join(" · ")}
                  </p>
                  {/* Only manual entries can be removed: an Oura tag would come
                      back on the next sync, so offering it would be a lie. */}
                  {s.sourceId && (
                    <button
                      onClick={() => removeDose(s.sourceId!, s.name)}
                      disabled={removing === s.sourceId}
                      className="shrink-0 text-[10px] text-muted-foreground/50 hover:text-red-400 transition-colors disabled:opacity-40"
                    >
                      {removing === s.sourceId ? "removing…" : "logged wrong?"}
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* When each of them leaves, on one shared 24h axis */}
      {substances.some(s => s.clearsAt) && (
        <Card className="border-border">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs font-semibold mb-2.5">Next 24 hours</p>
            <div className="space-y-1.5">
              {substances.filter(s => s.clearsAt).map(s => {
                const hoursLeft = Math.max(0, (new Date(s.clearsAt!).getTime() - Date.now()) / 3_600_000)
                const width = Math.min(100, (hoursLeft / 24) * 100)
                return (
                  <div key={`bar:${s.kind}:${s.name}`} className="flex items-center gap-2">
                    <span className="w-6 text-xs shrink-0" aria-hidden>{s.emoji}</span>
                    <div className="flex-1 h-4 rounded bg-secondary/60 relative overflow-hidden">
                      <div
                        className={`h-full rounded ${KIND_COLOR[s.kind]} opacity-80`}
                        style={{ width: `${Math.max(2, width)}%` }}
                      />
                      <span className="absolute inset-y-0 left-1.5 flex items-center text-[9px] text-white/90 font-medium">
                        {hoursLeft >= 24 ? "24h+" : hoursLeft >= 1 ? `${Math.round(hoursLeft)}h` : "<1h"}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Bedtime marker on the same scale */}
            <div className="relative mt-1.5 ml-8 h-4">
              {bedH <= 24 && (
                <div
                  className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
                  style={{ left: `${(bedH / 24) * 100}%` }}
                >
                  <div className="w-px h-2 bg-muted-foreground/40" />
                  <span className="text-[9px] text-muted-foreground/70 whitespace-nowrap">🌙 23:00</span>
                </div>
              )}
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground/50 ml-8 mt-0.5">
              <span>now</span><span>+12h</span><span>+24h</span>
            </div>
          </CardContent>
        </Card>
      )}

      {atBedtime.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5">
          <p className="text-xs text-amber-400">
            🌙 Still with you at 23:00: {atBedtime.map(s => s.name).join(", ")}
            {atBedtime.length > 1 && " — sedating substances stack, and so do their effects on sleep stages"}
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/50">
        Population-average models applied to one body — useful for planning, not measurement.
        Alcohol here is an estimate of what&apos;s left to process, never a fitness-to-drive check. {PHARMA_DISCLAIMER}
      </p>
    </div>
  )
}
