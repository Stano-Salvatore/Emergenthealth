"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// "Is today unusual for me?" — the other half of the insights page. The
// correlation engine answers what generally affects what; this answers whether
// right now is off, measured against the user's own median rather than any
// population norm.

interface Anomaly {
  metric: string
  label: string
  emoji: string
  unit: string
  value: number
  baseline: number
  z: number
  direction: "above" | "below"
  concerning: boolean
  runLength: number
  date: string
  summary: string
}

interface AnomalyData {
  anomalies: Anomaly[]
  days: number
  latestDate: string | null
  stale: boolean
  enoughHistory: boolean
}

function Row({ a }: { a: Anomaly }) {
  const arrow = a.direction === "above" ? "▲" : "▼"
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span role="img" className="text-lg leading-none mt-0.5">{a.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{a.summary}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          usual {a.baseline}{a.unit} · now {a.value}{a.unit}
          {a.runLength >= 3 && ` · ${a.runLength} days running`}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-medium tabular-nums",
          a.concerning ? "text-amber-400" : "text-emerald-400",
        )}
      >
        {arrow} {Math.abs(a.z).toFixed(1)}σ
      </span>
    </div>
  )
}

export function BaselineAlerts() {
  const [data, setData] = useState<AnomalyData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/anomalies")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Nothing to say yet, no data, or the ring hasn't synced — stay out of the
  // way rather than explaining an absence.
  if (!data || !data.enoughHistory || data.stale) return null

  const concerning = data.anomalies.filter(a => a.concerning)
  const reassuring = data.anomalies.filter(a => !a.concerning)

  if (data.anomalies.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">
            ✓ Every tracked metric is within your normal range today.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn(concerning.length > 0 && "border-amber-500/30")}>
      <CardContent className="py-3">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          📈 Off your baseline
          <span className="text-[11px] font-normal text-muted-foreground">
            vs your own last {data.days} days
          </span>
        </p>
        <div className="mt-1 divide-y divide-border/60">
          {[...concerning, ...reassuring].map(a => <Row key={a.metric} a={a} />)}
        </div>
      </CardContent>
    </Card>
  )
}
