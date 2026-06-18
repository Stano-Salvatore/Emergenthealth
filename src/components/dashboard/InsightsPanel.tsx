"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { RefreshCw, ChevronRight } from "lucide-react"

type Period = "today" | "week" | "month" | "overall"

const TABS: { key: Period; label: string }[] = [
  { key: "today",   label: "Today" },
  { key: "week",    label: "This Week" },
  { key: "month",   label: "Last 30d" },
  { key: "overall", label: "Overall" },
]

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

function PeriodTab({
  period,
  data,
  onRegenerate,
  regenerating,
}: {
  period: Exclude<Period, "today">
  data: PeriodData
  onRegenerate: () => void
  regenerating: boolean
}) {
  if (!data.loaded) return <SkeletonRows count={4} />

  const bullets = data.insight?.bullets ?? []
  const corr = data.correlations.slice(0, 3)
  const hasInsight = bullets.length > 0
  const hasCorr = corr.length > 0
  const showLocation = period === "month" || period === "overall"
  const locWithData = data.locationPatterns.filter(l => l.n >= 6 && l.delta != null)

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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">📊 top patterns</p>
            <Link href="/dashboard/insights" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
              See all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-1.5">
            {corr.map(item => (
              <div key={item.id} className="flex items-center gap-2">
                <span className="text-sm shrink-0">{item.emoji}</span>
                <p className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{item.finding}</p>
                <span className={`text-[10px] font-bold shrink-0 tabular-nums ${item.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                  {item.delta > 0 ? "+" : ""}{item.delta.toFixed(0)}%
                </span>
              </div>
            ))}
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
              {locWithData.slice(0, 3).map(loc => (
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
  const [activeTab, setActiveTab] = useState<Period>("today")
  const [regenerating, setRegenerating] = useState<Exclude<Period, "today"> | null>(null)

  const periodData = useRef<Partial<Record<Exclude<Period, "today">, PeriodData>>>({})
  const [, forceUpdate] = useState(0)

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

  useEffect(() => {
    if (activeTab !== "today") loadPeriod(activeTab as Exclude<Period, "today">)
  }, [activeTab, loadPeriod])

  // Pre-load "week" tab in background
  useEffect(() => { loadPeriod("week") }, [loadPeriod])

  return (
    <div className="rounded-xl border border-border/50 bg-background/50 backdrop-blur px-4 py-3 space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors ${
              activeTab === tab.key
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground/50 hover:text-muted-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === "today" ? (
          <TodayTab />
        ) : (
          <PeriodTab
            period={activeTab}
            data={periodData.current[activeTab] ?? { insight: null, correlations: [], locationPatterns: [], loaded: false }}
            onRegenerate={() => regenerate(activeTab)}
            regenerating={regenerating === activeTab}
          />
        )}
      </div>
    </div>
  )
}
