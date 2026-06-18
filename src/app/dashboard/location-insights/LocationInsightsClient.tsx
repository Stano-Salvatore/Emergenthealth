"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Metric = "hrv" | "readinessScore" | "sleepDuration" | "sleepEfficiency" | "restingHR" | "steps" | "mood"

type Confidence = "insufficient" | "low" | "moderate" | "good"

interface LocationCorrelationResult {
  locationKey: string
  label: string
  emoji: string
  n: number
  visitAvg: number | null
  baselineAvg: number | null
  delta: number | null
  confidence: Confidence
  caveat?: string
}

// ─── Metric config ────────────────────────────────────────────────────────────

const METRICS: { key: Metric; label: string; unit: string; higherIsBetter: boolean }[] = [
  { key: "hrv",             label: "HRV",        unit: "ms",  higherIsBetter: true  },
  { key: "readinessScore",  label: "Readiness",  unit: "pts", higherIsBetter: true  },
  { key: "sleepDuration",   label: "Sleep hrs",  unit: "min", higherIsBetter: true  },
  { key: "sleepEfficiency", label: "Sleep eff%", unit: "%",   higherIsBetter: true  },
  { key: "restingHR",       label: "Resting HR", unit: "bpm", higherIsBetter: false },
  { key: "steps",           label: "Steps",      unit: "steps", higherIsBetter: true },
  { key: "mood",            label: "Mood",       unit: "/5",  higherIsBetter: true  },
]

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence, n }: { confidence: Confidence; n: number }) {
  if (confidence === "insufficient") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-secondary text-muted-foreground border border-border/50">
        Too few visits
      </span>
    )
  }
  if (confidence === "low") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
        Low confidence (n={n})
      </span>
    )
  }
  if (confidence === "moderate") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/20">
        Moderate (n={n})
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-500/15 text-green-400 border border-green-500/20">
      Good data (n={n})
    </span>
  )
}

// ─── Delta badge ──────────────────────────────────────────────────────────────

function DeltaBadge({
  delta,
  confidence,
  unit,
  higherIsBetter,
}: {
  delta: number | null
  confidence: Confidence
  unit: string
  higherIsBetter: boolean
}) {
  if (confidence === "insufficient" || delta == null) {
    return (
      <span className="text-muted-foreground font-mono text-sm">–</span>
    )
  }
  const positive = delta > 0
  const good = higherIsBetter ? positive : !positive
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold font-mono",
        good
          ? "bg-green-500/15 text-green-400"
          : "bg-red-500/15 text-red-400",
      )}
    >
      {positive ? "+" : ""}{delta.toFixed(1)}{unit !== "steps" ? ` ${unit}` : ""}
    </span>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function VisitAvgBar({
  visitAvg,
  min,
  max,
}: {
  visitAvg: number | null
  min: number
  max: number
}) {
  if (visitAvg == null || min === max) return null
  const pct = Math.max(0, Math.min(100, ((visitAvg - min) / (max - min)) * 100))
  return (
    <div className="h-1 w-full rounded-full bg-secondary mt-2 overflow-hidden">
      <div
        className="h-full rounded-full bg-primary/60 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ─── Location row ─────────────────────────────────────────────────────────────

function LocationRow({
  result,
  unit,
  higherIsBetter,
  min,
  max,
}: {
  result: LocationCorrelationResult
  unit: string
  higherIsBetter: boolean
  min: number
  max: number
}) {
  return (
    <div className="flex flex-col gap-1.5 py-3 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Emoji + label */}
        <span className="text-xl leading-none shrink-0" role="img">{result.emoji}</span>
        <span className="font-medium text-sm flex-1 min-w-0">{result.label}</span>

        {/* Confidence badge */}
        <ConfidenceBadge confidence={result.confidence} n={result.n} />

        {/* Delta badge */}
        <DeltaBadge
          delta={result.delta}
          confidence={result.confidence}
          unit={unit}
          higherIsBetter={higherIsBetter}
        />
      </div>

      {/* Progress bar */}
      <VisitAvgBar visitAvg={result.visitAvg} min={min} max={max} />

      {/* n — always visible */}
      <p className="text-[11px] text-muted-foreground">
        {result.n === 0
          ? "No visit nights with data yet"
          : `${result.n} night${result.n === 1 ? "" : "s"} with data · avg ${result.visitAvg ?? "–"} ${unit}`}
      </p>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LocationSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} className="flex items-center gap-3 py-3 border-b border-border/50">
          <Skeleton className="h-6 w-6 rounded-full shrink-0" />
          <Skeleton className="h-4 flex-1 max-w-[180px]" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <Card className="border-dashed border-border/50">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 text-5xl leading-none select-none">📍</div>
        <h3 className="text-base font-semibold text-foreground">No visit data yet</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Drop your <code className="text-xs bg-secondary px-1 py-0.5 rounded">timeline-visits.json</code> into{" "}
          <code className="text-xs bg-secondary px-1 py-0.5 rounded">data/</code> to see correlations.
        </p>
      </CardContent>
    </Card>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LocationInsightsClient() {
  const [metric, setMetric] = useState<Metric>("hrv")
  const [data, setData] = useState<LocationCorrelationResult[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/location-correlations?metric=${metric}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<LocationCorrelationResult[]>
      })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [metric])

  const currentMetaConfig = METRICS.find(m => m.key === metric)!
  const { unit, higherIsBetter } = currentMetaConfig

  // Compute min/max across all visitAvg values for progress bars
  const visitAvgs = (data ?? []).map(r => r.visitAvg).filter((v): v is number => v != null)
  const barMin = visitAvgs.length ? Math.min(...visitAvgs) : 0
  const barMax = visitAvgs.length ? Math.max(...visitAvgs) : 1

  const allEmpty = data != null && data.every(r => r.n === 0)
  const stepsCaveat = data?.find(r => r.caveat)?.caveat

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold">Location Insights</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          How your health metrics compare on nights after visiting each location
        </p>
      </div>

      {/* ── Metric picker ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 border",
              metric === m.key
                ? "bg-gradient-to-r from-primary/20 to-primary/5 text-primary border-primary/25 shadow-sm"
                : "text-muted-foreground border-border/50 hover:text-foreground hover:bg-secondary/60",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* ── Steps caveat ── */}
      {metric === "steps" && stepsCaveat && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
          <span className="shrink-0 mt-0.5">⚠️</span>
          <span>{stepsCaveat}</span>
        </div>
      )}

      {/* ── Content ── */}
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <span role="img">📍</span>
            {currentMetaConfig.label} by Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LocationSkeleton />
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">Failed to load data. Please try refreshing.</p>
            </div>
          ) : allEmpty ? (
            <EmptyState />
          ) : (
            <div>
              {(data ?? []).map(result => (
                <LocationRow
                  key={result.locationKey}
                  result={result}
                  unit={unit}
                  higherIsBetter={higherIsBetter}
                  min={barMin}
                  max={barMax}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Footnote ── */}
      {!loading && !error && !allEmpty && (
        <p className="text-xs text-muted-foreground text-center">
          Delta = visit-night average vs. all-days baseline · baseline n = {(data ?? [])[0]?.baselineAvg != null ? "available" : "unavailable"}
        </p>
      )}
    </div>
  )
}
