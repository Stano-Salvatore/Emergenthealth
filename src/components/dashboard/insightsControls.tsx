"use client"

import { useEffect, useState, useCallback } from "react"
import { Star, Minus, Plus } from "lucide-react"

export type InsightPeriod = "week" | "month" | "overall"

// Default number of correlation rows shown per period — user-adjustable and
// persisted so the dashboard isn't flooded. Fewer for the noisier short window,
// more for the well-evidenced overall view.
export const DEFAULT_COUNTS: Record<InsightPeriod, number> = { week: 3, month: 6, overall: 10 }
export const MIN_COUNT = 1
export const MAX_COUNT = 10

// Shared state for the choosable count + pin/watch list, persisted via
// /api/preferences/insights. Used by both PeriodInsightCard (per-period widgets)
// and InsightsPanel (the combined widget) so they stay in sync.
export function useInsightsPrefs() {
  const [counts, setCounts] = useState<Record<InsightPeriod, number>>(DEFAULT_COUNTS)
  const [pinned, setPinned] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch("/api/preferences/insights")
      .then(r => (r.ok ? r.json() : null))
      .then((d: { counts?: Record<string, number>; pinned?: string[] } | null) => {
        if (!d) return
        if (d.counts) setCounts(c => ({ ...c, ...d.counts }))
        if (Array.isArray(d.pinned)) setPinned(new Set(d.pinned))
      })
      .catch(() => {})
  }, [])

  const persist = useCallback((body: { counts?: Record<string, number>; pinned?: string[] }) => {
    fetch("/api/preferences/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {})
  }, [])

  const changeCount = useCallback((period: InsightPeriod, n: number) => {
    setCounts(prev => {
      const next = { ...prev, [period]: n }
      persist({ counts: next })
      return next
    })
  }, [persist])

  const togglePin = useCallback((id: string) => {
    setPinned(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      persist({ pinned: [...next] })
      return next
    })
  }, [persist])

  return { counts, pinned, changeCount, togglePin }
}

// Pinned (watched) correlations always show; the rest fill up to `count`.
export function sliceCorrelations<T extends { id: string }>(
  corr: T[], count: number, pinned: Set<string>,
): T[] {
  const pinnedInCorr = corr.filter(c => pinned.has(c.id))
  const rest = corr.filter(c => !pinned.has(c.id))
  return [...pinnedInCorr, ...rest].slice(0, Math.max(count, pinnedInCorr.length))
}

// Compact −/+ stepper for choosing how many correlation rows to show. Sized as
// real tap targets so it stays usable even at web-mode zoom on a phone.
export function CountStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background/40 px-0.5">
      <button
        onClick={() => onChange(Math.max(MIN_COUNT, value - 1))}
        disabled={value <= MIN_COUNT}
        className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground/70 hover:text-foreground hover:bg-background/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Show fewer"
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="text-[11px] font-bold tabular-nums w-3.5 text-center text-muted-foreground">{value}</span>
      <button
        onClick={() => onChange(Math.min(MAX_COUNT, value + 1))}
        disabled={value >= MAX_COUNT}
        className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground/70 hover:text-foreground hover:bg-background/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Show more"
      >
        <Plus className="h-3 w-3" />
      </button>
    </span>
  )
}

// Star toggle to pin/watch a correlation. Larger hit area for touch.
export function PinButton({ pinned, onClick }: { pinned: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex items-center justify-center h-6 w-6 -ml-1 rounded transition-colors ${
        pinned ? "text-amber-400" : "text-muted-foreground/25 hover:text-muted-foreground/60"
      }`}
      title={pinned ? "Unwatch this correlation" : "Watch this correlation — get alerted when it changes"}
      aria-pressed={pinned}
    >
      <Star className={`h-3.5 w-3.5 ${pinned ? "fill-current" : ""}`} />
    </button>
  )
}
