"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { WatchedPatterns } from "@/components/dashboard/WatchedPatterns"

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = "sleep" | "stress" | "habits" | "caffeine" | "recovery" | "screen" | "tags" | "calendar" | "food" | "supplements" | "interactions" | "fitness" | "music" | "money" | "focus" | "fasting"

interface InsightResult {
  id: string
  category: Category
  emoji: string
  title: string
  finding: string
  delta: number
  highGroupLabel: string
  lowGroupLabel: string
  highGroupAvg: number
  lowGroupAvg: number
  highGroupN: number
  lowGroupN: number
  confident: boolean
  pValue?: number
  tier?: "strong" | "suggestive" | "noise"
  weekendDriven?: boolean
}

interface CorrelationsData {
  insights: InsightResult[]
  dataRange: { days: number }
  computedAt?: string
  cached?: boolean
}

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<Category, { label: string; emoji: string; color: string }> = {
  sleep:       { label: "Sleep",    emoji: "🌙", color: "text-indigo-400" },
  recovery:    { label: "Recovery", emoji: "❤️", color: "text-rose-400" },
  stress:      { label: "Stress",   emoji: "😤", color: "text-orange-400" },
  food:        { label: "Food & Hydration", emoji: "🍽️", color: "text-orange-400" },
  supplements: { label: "Supplements", emoji: "💊", color: "text-violet-400" },
  interactions:{ label: "Combinations", emoji: "🔀", color: "text-fuchsia-400" },
  fitness:     { label: "Workouts", emoji: "🏃", color: "text-emerald-400" },
  fasting:     { label: "Fasting",  emoji: "⏳", color: "text-yellow-400" },
  habits:      { label: "Habits",   emoji: "✅", color: "text-green-400" },
  focus:       { label: "Focus",    emoji: "🎯", color: "text-red-400" },
  caffeine:    { label: "Caffeine", emoji: "☕", color: "text-amber-400" },
  screen:      { label: "Screen Time", emoji: "📱", color: "text-cyan-400" },
  music:       { label: "Music",    emoji: "🎵", color: "text-pink-400" },
  money:       { label: "Money",    emoji: "💸", color: "text-teal-400" },
  calendar:    { label: "Calendar", emoji: "🗓️", color: "text-blue-400" },
  tags:        { label: "Tags",     emoji: "🏷️", color: "text-primary" },
}

const CATEGORY_ORDER: Category[] = ["sleep", "recovery", "stress", "food", "supplements", "interactions", "fitness", "fasting", "habits", "focus", "caffeine", "screen", "music", "money", "calendar", "tags"]

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function InsightSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded bg-secondary" />
            <div className="h-4 w-40 rounded bg-secondary" />
            <div className="ml-auto h-5 w-14 rounded-full bg-secondary" />
          </div>
          <div className="h-4 w-full rounded bg-secondary" />
          <div className="h-4 w-3/4 rounded bg-secondary" />
          <div className="flex gap-2">
            <div className="h-8 flex-1 rounded-lg bg-secondary" />
            <div className="h-8 flex-1 rounded-lg bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Delta Pill ───────────────────────────────────────────────────────────────

function DeltaPill({ delta }: { delta: number }) {
  const positive = delta >= 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        positive
          ? "bg-green-500/15 text-green-400"
          : "bg-red-500/15 text-red-400",
      )}
    >
      {positive ? "+" : ""}{delta.toFixed(1)}%
    </span>
  )
}

// ─── Insight Card ─────────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: InsightResult }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-lg leading-none shrink-0" role="img" aria-label={insight.category}>
            {insight.emoji}
          </span>
          <span className="font-semibold text-sm flex-1 min-w-0 leading-snug pt-0.5">{insight.title}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <DeltaPill delta={insight.delta} />
            {/* Trust tier: permutation test + false-discovery control, not just sample size */}
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] font-semibold px-1.5",
                insight.tier === "strong" ? "text-emerald-400"
                  : insight.tier === "suggestive" ? "text-amber-400"
                  : insight.tier === "noise" ? "text-muted-foreground"
                  : insight.confident ? "text-primary" : "text-muted-foreground",
              )}
            >
              {insight.tier === "strong" ? "Solid"
                : insight.tier === "suggestive" ? "Suggestive"
                : insight.tier === "noise" ? "Could be chance"
                : insight.confident ? "Strong" : "Early"}
            </Badge>
            {insight.weekendDriven && (
              <Badge variant="secondary" className="text-[10px] font-semibold px-1.5 text-sky-400">
                Weekend pattern?
              </Badge>
            )}
          </div>
        </div>

        {/* Finding text */}
        <p className="text-sm text-muted-foreground leading-relaxed">{insight.finding}</p>

        {/* Stat chips */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-secondary/50 px-3 py-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate mb-1">
              {insight.highGroupLabel}
            </p>
            <p className="text-base font-bold text-foreground leading-none">{insight.highGroupAvg}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{insight.highGroupN} days</p>
          </div>
          <div className="rounded-lg bg-secondary/50 px-3 py-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate mb-1">
              {insight.lowGroupLabel}
            </p>
            <p className="text-base font-bold text-foreground leading-none">{insight.lowGroupAvg}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{insight.lowGroupN} days</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 text-5xl leading-none select-none">✨</div>
        <h3 className="text-base font-semibold text-foreground">Not enough data yet</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Log more check-ins, habits, and health data to see personalised patterns. At least 5 days per group are needed.
        </p>
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PERIODS = [
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "overall", label: "90 days" },
] as const
type Period = (typeof PERIODS)[number]["key"]

export default function InsightsPage() {
  // The result is stored together with the period it belongs to, so "loading"
  // is derived rather than a second piece of state the effect has to set
  // synchronously (which cascades a render before the fetch even starts).
  const [entry, setEntry] = useState<{ period: Period; data: CorrelationsData } | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The engine has always supported three windows; nothing ever offered them.
  const [period, setPeriod] = useState<Period>("overall")

  const load = useCallback((p: Period, refresh = false) => {
    return fetch(`/api/insights/correlations?period=${p}${refresh ? "&refresh=1" : ""}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<CorrelationsData>
      })
      .then(d => { setEntry({ period: p, data: d }); setError(null) })
      .catch(e => setError(String(e)))
  }, [])

  useEffect(() => {
    let cancelled = false
    load(period).then(() => { if (cancelled) return })
    return () => { cancelled = true }
  }, [load, period])

  const data = entry?.period === period ? entry.data : null
  const loading = data == null && error == null

  // Group insights by category (preserving sort order within each group)
  const grouped: Partial<Record<Category, InsightResult[]>> = {}
  for (const insight of data?.insights ?? []) {
    if (!grouped[insight.category]) grouped[insight.category] = []
    grouped[insight.category]!.push(insight)
  }

  const hasAnyInsights = (data?.insights.length ?? 0) > 0

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {data ? `Patterns found in your last ${data.dataRange.days} days of data` : "Patterns found in your last 60 days"}
        </p>

        <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "px-3 py-1.5 text-xs transition-colors",
                  period === p.key
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {data?.computedAt && (
              <span className="text-[10px] text-muted-foreground/60">
                computed {new Date(data.computedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            )}
            <button
              onClick={() => { setRecomputing(true); load(period, true).finally(() => setRecomputing(false)) }}
              disabled={recomputing || loading}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {recomputing ? "Recomputing…" : "Recompute"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Watched (pinned) patterns ── */}
      <WatchedPatterns />

      {/* ── Content ── */}
      {loading ? (
        <InsightSkeleton />
      ) : error ? (
        <Card className="border-dashed border-red-500/30">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm text-muted-foreground">Failed to load insights. Please try refreshing.</p>
          </CardContent>
        </Card>
      ) : !hasAnyInsights ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {CATEGORY_ORDER.map(category => {
            const categoryInsights = grouped[category]
            if (!categoryInsights || categoryInsights.length === 0) return null
            const meta = CATEGORY_META[category]

            return (
              <section key={category}>
                <CardHeader className="px-0 pb-3 pt-0">
                  <CardTitle className={cn("text-sm font-semibold uppercase tracking-widest flex items-center gap-2", meta.color)}>
                    <span role="img">{meta.emoji}</span>
                    {meta.label}
                  </CardTitle>
                </CardHeader>
                <div className="space-y-3">
                  {categoryInsights.map(insight => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
