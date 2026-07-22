"use client"

import { useEffect, useCallback, useSyncExternalStore } from "react"
import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

export type InsightPeriod = "week" | "month" | "overall"

// Default number of correlation rows shown per period — user-adjustable and
// persisted so the dashboard isn't flooded. Fewer for the noisier short window,
// more for the well-evidenced overall view.
export const DEFAULT_COUNTS: Record<InsightPeriod, number> = { week: 3, month: 6, overall: 10 }
export const ALL_VALUE = 99 // "show all" — slice caps naturally at the real count
const PRESETS = [3, 6, 10]

// Which grid blocks are per-period insight widgets, for the Customize panel.
export const INSIGHT_PERIOD_BLOCKS: { id: string; period: InsightPeriod; label: string }[] = [
  { id: "insights_week",    period: "week",    label: "7 days" },
  { id: "insights_month",   period: "month",   label: "30 days" },
  { id: "insights_overall", period: "overall", label: "Overall" },
]

// ── Shared store ────────────────────────────────────────────────────────────
// A single module-level store (not per-component state) so every count picker
// and every insight widget read/write the same values and update live — change
// the number in the Customize panel and the widget re-slices immediately.

type PrefState = { counts: Record<InsightPeriod, number>; pinned: Set<string> }
let state: PrefState = { counts: { ...DEFAULT_COUNTS }, pinned: new Set() }
const listeners = new Set<() => void>()
let loadStarted = false

function emit() { for (const l of listeners) l() }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
function getSnapshot() { return state }

function persist(body: { counts?: Record<string, number>; pinned?: string[] }) {
  fetch("/api/preferences/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {})
}

function ensureLoaded() {
  if (loadStarted) return
  loadStarted = true
  fetch("/api/preferences/insights")
    .then(r => (r.ok ? r.json() : null))
    .then((d: { counts?: Record<string, number>; pinned?: string[] } | null) => {
      if (!d) return
      state = {
        counts: { ...state.counts, ...(d.counts ?? {}) },
        pinned: Array.isArray(d.pinned) ? new Set(d.pinned) : state.pinned,
      }
      emit()
    })
    .catch(() => {})
}

export function useInsightsPrefs() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => { ensureLoaded() }, [])

  const changeCount = useCallback((period: InsightPeriod, n: number) => {
    state = { ...state, counts: { ...state.counts, [period]: n } }
    emit()
    persist({ counts: state.counts })
  }, [])

  const togglePin = useCallback((id: string) => {
    const next = new Set(state.pinned)
    next.has(id) ? next.delete(id) : next.add(id)
    state = { ...state, pinned: next }
    emit()
    persist({ pinned: [...next] })
  }, [])

  return { counts: snap.counts, pinned: snap.pinned, changeCount, togglePin }
}

// Pinned (watched) correlations always show; the rest fill up to `count`.
export function sliceCorrelations<T extends { id: string }>(
  corr: T[], count: number, pinned: Set<string>,
): T[] {
  const pinnedInCorr = corr.filter(c => pinned.has(c.id))
  const rest = corr.filter(c => !pinned.has(c.id))
  return [...pinnedInCorr, ...rest].slice(0, Math.max(count, pinnedInCorr.length))
}

// ── Controls ────────────────────────────────────────────────────────────────

// Big, tappable "how many rows?" picker. Preset numbers + All, sized as real
// tap targets so it stays usable even at web-mode zoom on a phone (where the
// old −/+ stepper was ~10px and impossible to hit).
export function InsightRowsControl({
  period, label, className,
}: { period: InsightPeriod; label?: string; className?: string }) {
  const { counts, changeCount } = useInsightsPrefs()
  const value = counts[period] ?? DEFAULT_COUNTS[period]
  const isAll = value >= ALL_VALUE

  const chip = (active: boolean) =>
    cn(
      "min-w-[2.25rem] px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors",
      active
        ? "border-primary bg-primary/15 text-primary"
        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
    )

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {label && <span className="text-[11px] text-muted-foreground w-16 shrink-0">{label}</span>}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESETS.map(n => (
          <button key={n} onClick={() => changeCount(period, n)} className={chip(!isAll && value === n)}>
            {n}
          </button>
        ))}
        <button onClick={() => changeCount(period, ALL_VALUE)} className={chip(isAll)}>All</button>
      </div>
    </div>
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
