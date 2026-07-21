"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { RefreshCw, ChevronRight, Star, Minus, Plus } from "lucide-react"

type Period = "today" | "week" | "month" | "overall"

// Stacked periods, shown one after another (not tabs).
const PERIODS: { key: Exclude<Period, "today">; label: string }[] = [
  { key: "week",    label: "Last 7 days" },
  { key: "month",   label: "Last 30 days" },
  { key: "overall", label: "Overall" },
]

// Default number of correlation rows shown per period — the user can change
// these (persisted) so the dashboard isn't flooded. Fewer for the noisier short
// window, more for the well-evidenced overall view.
const DEFAULT_COUNTS: Record<Exclude<Period, "today">, number> = { week: 3, month: 6, overall: 10 }
const MIN_COUNT = 1
const MAX_COUNT = 10

// ── Today tab ─────────────────────────────────────────────────────────────────

type MetricSnapshot = {
  label: string
  key: string
  today: number | null
  baseline: number | null
  unit: string
  higherIsBetter: boolean
}

type TodayData = {
  date: string
  baselineDays: number
  snapshots: MetricSnapshot[]
}

function deltaPct(today: number, baseline: number): number {
  if (baseline === 0) return 0
  return ((today - baseline) / Math.abs(baseline)) * 100
}

function TodayTab() {
  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/insight/today")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SkeletonRows count={5} />

  const visible = data?.snapshots.filter(s => s.today != null || s.baseline != null) ?? []
  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        No data logged yet today. Check back after syncing your Oura ring.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-semibold mb-1">
        vs your {data?.baselineDays ?? 30}-day average
      </p>
      {visible.map(s => {
        const hasToday = s.today != null
        const hasBaseline = s.baseline != null
        const pct = hasToday && hasBaseline ? deltaPct(s.today!, s.baseline!) : null
        const good = pct == null ? null : s.higherIsBetter ? pct >= 0 : pct <= 0
        const fmt = (v: number | null, unit: string) => {
          if (v == null) return "—"
          if (unit === "h") return `${v.toFixed(1)}h`
          if (unit === "") return v.toLocaleString()
          return `${v}${unit}`
        }
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">{s.label}</span>
            <span className="text-xs font-medium tabular-nums w-14 shrink-0">
              {hasToday ? fmt(s.today, s.unit) : <span className="text-muted-foreground/40">—</span>}
            </span>
            {pct != null && (
              <span className={`text-[10px] font-bold tabular-nums shrink-0 ${good ? "text-green-400" : "text-red-400"}`}>
                {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
              </span>
            )}
            {hasBaseline && (
              <span className="text-[10px] text-muted-foreground/40 shrink-0 ml-auto">
                avg {fmt(s.baseline, s.unit)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Insight + Correlations tabs ────────────────────────────────────────────────

type InsightData = {
  bullets: string[]
  generatedAt: string
  error?: string
} | null

type CorrelationItem = {
  id: string
  emoji: string
  finding: string
  delta: number
  confident?: boolean
  highGroupN?: number
  lowGroupN?: number
}

type LocationPattern = {
  locationKey: string
  label: string
  emoji: string
  n: number
  delta: number | null
  confidence: string
}

type PeriodData = {
  insight: InsightData
  correlations: CorrelationItem[]
  locationPatterns: LocationPattern[]
  loaded: boolean
}

function SkeletonRows({ count }: { count: number }) {
  const widths = [85, 70, 78, 65, 80]
  return (
    <div className="space-y-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-3 bg-secondary/50 rounded animate-pulse" style={{ width: `${widths[i % widths.length]}%` }} />
      ))}
    </div>
  )
}

const CONFIDENCE_COLORS: Record<string, string> = {
  insufficient: "text-muted-foreground/30",
  low: "text-yellow-500/70",
  moderate: "text-blue-400/80",
  good: "text-green-400",
}

// Compact −/+ stepper for choosing how many correlation rows to show.
function CountStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background/40 px-0.5">
      <button
        onClick={() => onChange(Math.max(MIN_COUNT, value - 1))}
        disabled={value <= MIN_COUNT}
        className="p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Show fewer"
      >
        <Minus className="h-2.5 w-2.5" />
      </button>
      <span className="text-[10px] font-bold tabular-nums w-3 text-center text-muted-foreground">{value}</span>
      <button
        onClick={() => onChange(Math.min(MAX_COUNT, value + 1))}
        disabled={value >= MAX_COUNT}
        className="p-0.5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Show more"
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
    </span>
  )
}

function PeriodTab({
  period,
  data,
  count,
  pinned,
  onCountChange,
  onTogglePin,
  onRegenerate,
  regenerating,
}: {
  period: Exclude<Period, "today">
  data: PeriodData
  count: number
  pinned: Set<string>
  onCountChange: (n: number) => void
  onTogglePin: (id: string) => void
  onRegenerate: () => void
  regenerating: boolean
}) {
  if (!data.loaded) return <SkeletonRows count={4} />

  const bullets = data.insight?.bullets ?? []
  const corr = data.correlations
  const hasInsight = bullets.length > 0
  const hasCorr = corr.length > 0
  const showLocation = period === "month" || period === "overall"
  const locWithData = data.locationPatterns.filter(l => l.n >= 6 && l.delta != null)

  // Pinned (watched) correlations always show; the rest fill up to `count`.
  const pinnedInCorr = corr.filter(c => pinned.has(c.id))
  const rest = corr.filter(c => !pinned.has(c.id))
  const visibleCorr = [...pinnedInCorr, ...rest].slice(0, Math.max(count, pinnedInCorr.length))

  if (!hasInsight && !hasCorr) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Not enough data for this period yet — keep logging!
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {hasInsight && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/60">✨ AI insights</p>
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors p-0.5 disabled:cursor-not-allowed"
              title="Regenerate"
            >
              <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="space-y-1">
            {bullets.map((b, i) => (
              <p key={i} className="text-xs text-muted-foreground leading-relaxed">{b}</p>
            ))}
          </div>
        </div>
      )}

      {hasCorr && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                📊 patterns <span className="text-muted-foreground/50">({visibleCorr.length}/{corr.length})</span>
              </p>
              <CountStepper value={count} onChange={onCountChange} />
            </div>
            <Link href="/dashboard/insights" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
              Full view <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-1.5">
            {visibleCorr.map(item => {
              const isPinned = pinned.has(item.id)
              return (
                <div key={item.id} className="flex items-start gap-2 group">
                  <button
                    onClick={() => onTogglePin(item.id)}
                    className={`shrink-0 mt-0.5 transition-colors ${
                      isPinned ? "text-amber-400" : "text-muted-foreground/25 hover:text-muted-foreground/60"
                    }`}
                    title={isPinned ? "Unwatch this correlation" : "Watch this correlation — get alerted when it changes"}
                    aria-pressed={isPinned}
                  >
                    <Star className={`h-3 w-3 ${isPinned ? "fill-current" : ""}`} />
                  </button>
                  <span className="text-sm shrink-0 leading-relaxed">{item.emoji}</span>
                  <p className="text-xs text-muted-foreground flex-1 min-w-0 leading-relaxed">{item.finding}</p>
                  {item.confident === false && (
                    <span className="text-[9px] font-semibold shrink-0 text-muted-foreground/40 uppercase tracking-wide mt-0.5">early</span>
                  )}
                  <span className={`text-[10px] font-bold shrink-0 tabular-nums mt-0.5 ${item.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                    {item.delta > 0 ? "+" : ""}{item.delta.toFixed(0)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showLocation && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">🗺️ by location (HRV)</p>
            <Link href="/dashboard/location-insights" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
              Full view <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {locWithData.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50">
              Import your Google Timeline in Settings to see location patterns.
            </p>
          ) : (
            <div className="space-y-1.5">
              {locWithData.map(loc => (
                <div key={loc.locationKey} className="flex items-center gap-2">
                  <span className="text-sm shrink-0">{loc.emoji}</span>
                  <p className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{loc.label}</p>
                  <span className={`text-[10px] shrink-0 tabular-nums ${CONFIDENCE_COLORS[loc.confidence]}`}>
                    n={loc.n}
                  </span>
                  {loc.delta != null && (
                    <span className={`text-[10px] font-bold shrink-0 tabular-nums ${loc.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                      {loc.delta > 0 ? "+" : ""}{loc.delta.toFixed(1)}ms
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function InsightsPanel() {
  const [regenerating, setRegenerating] = useState<Exclude<Period, "today"> | null>(null)

  const periodData = useRef<Partial<Record<Exclude<Period, "today">, PeriodData>>>({})
  const [, forceUpdate] = useState(0)

  // User prefs: per-period visible count + pinned/watched correlation ids.
  const [counts, setCounts] = useState<Record<Exclude<Period, "today">, number>>(DEFAULT_COUNTS)
  const [pinned, setPinned] = useState<Set<string>>(new Set())

  const loadPeriod = useCallback(async (period: Exclude<Period, "today">) => {
    if (periodData.current[period]) return
    periodData.current[period] = { insight: null, correlations: [], locationPatterns: [], loaded: false }
    forceUpdate(n => n + 1)

    const fetchLoc = period === "month" || period === "overall"
    const [insightRes, corrRes, locRes] = await Promise.allSettled([
      fetch(`/api/insight?period=${period}`).then(r => r.json()),
      fetch(`/api/insights/correlations?period=${period}`).then(r => r.json()),
      fetchLoc
        ? fetch("/api/location-correlations?metric=hrv").then(r => r.json())
        : Promise.resolve([]),
    ])

    periodData.current[period] = {
      insight: insightRes.status === "fulfilled" ? insightRes.value : null,
      correlations: corrRes.status === "fulfilled" ? (corrRes.value.insights ?? []) : [],
      locationPatterns: locRes.status === "fulfilled" && Array.isArray(locRes.value) ? locRes.value : [],
      loaded: true,
    }
    forceUpdate(n => n + 1)
  }, [])

  const regenerate = useCallback(async (period: Exclude<Period, "today">) => {
    setRegenerating(period)
    try {
      const res = await fetch(`/api/insight?period=${period}`, { method: "POST" })
      const data = await res.json()
      if (periodData.current[period]) {
        periodData.current[period]!.insight = data
        forceUpdate(n => n + 1)
      }
    } catch {
      // ignore
    } finally {
      setRegenerating(null)
    }
  }, [])

  // Load every period up-front so all sections render stacked, plus saved prefs.
  useEffect(() => {
    PERIODS.forEach(p => loadPeriod(p.key))
    fetch("/api/preferences/insights")
      .then(r => (r.ok ? r.json() : null))
      .then((d: { counts?: Record<string, number>; pinned?: string[] } | null) => {
        if (!d) return
        if (d.counts) setCounts(c => ({ ...c, ...d.counts }))
        if (Array.isArray(d.pinned)) setPinned(new Set(d.pinned))
      })
      .catch(() => {})
  }, [loadPeriod])

  const persist = useCallback((body: { counts?: Record<string, number>; pinned?: string[] }) => {
    fetch("/api/preferences/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {})
  }, [])

  const changeCount = useCallback((period: Exclude<Period, "today">, n: number) => {
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

  return (
    <div className="rounded-xl border border-border/50 bg-background/50 backdrop-blur px-4 py-3 space-y-4">
      {/* Today snapshot */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/70 mb-2">Today</p>
        <TodayTab />
      </div>

      {/* Trends, one period after another */}
      {PERIODS.map(p => (
        <div key={p.key} className="pt-3 border-t border-border/40">
          <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/70 mb-2">{p.label}</p>
          <PeriodTab
            period={p.key}
            data={periodData.current[p.key] ?? { insight: null, correlations: [], locationPatterns: [], loaded: false }}
            count={counts[p.key] ?? DEFAULT_COUNTS[p.key]}
            pinned={pinned}
            onCountChange={n => changeCount(p.key, n)}
            onTogglePin={togglePin}
            onRegenerate={() => regenerate(p.key)}
            regenerating={regenerating === p.key}
          />
        </div>
      ))}
    </div>
  )
}
