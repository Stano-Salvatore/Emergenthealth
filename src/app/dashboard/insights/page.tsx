"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { WatchedPatterns } from "@/components/dashboard/WatchedPatterns"
import PlaceCorrelations from "@/components/location/PlaceCorrelations"
import { BaselineAlerts } from "@/components/dashboard/BaselineAlerts"
import { DailyScoreCard } from "@/components/dashboard/DailyScoreCard"
import { experimentSuggestion } from "@/lib/experiment-suggest"

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = "sleep" | "stress" | "habits" | "caffeine" | "recovery" | "screen" | "tags" | "calendar" | "food" | "supplements" | "interactions" | "symptoms" | "fitness" | "music" | "money" | "focus" | "fasting" | "custom" | "places" | "work" | "heart" | "week" | "consistency" | "streaks" | "absence" | "body"

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
  weekdayDelta?: number
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
  heart:       { label: "Blood Pressure", emoji: "🩺", color: "text-red-400" },
  week:        { label: "Weekend Rhythm", emoji: "📆", color: "text-amber-400" },
  places:      { label: "Places & Travel", emoji: "🧳", color: "text-sky-400" },
  work:        { label: "Work", emoji: "💼", color: "text-slate-400" },
  stress:      { label: "Stress",   emoji: "😤", color: "text-orange-400" },
  food:        { label: "Food & Hydration", emoji: "🍽️", color: "text-orange-400" },
  supplements: { label: "Supplements", emoji: "💊", color: "text-violet-400" },
  interactions:{ label: "Combinations", emoji: "🔀", color: "text-fuchsia-400" },
  symptoms:    { label: "Symptoms", emoji: "🩹", color: "text-red-400" },
  fitness:     { label: "Workouts", emoji: "🏃", color: "text-emerald-400" },
  fasting:     { label: "Fasting",  emoji: "⏳", color: "text-yellow-400" },
  habits:      { label: "Habits",   emoji: "✅", color: "text-green-400" },
  custom:      { label: "Your trackers", emoji: "📐", color: "text-lime-400" },
  focus:       { label: "Focus",    emoji: "🎯", color: "text-red-400" },
  caffeine:    { label: "Caffeine", emoji: "☕", color: "text-amber-400" },
  screen:      { label: "Screen Time", emoji: "📱", color: "text-cyan-400" },
  music:       { label: "Music",    emoji: "🎵", color: "text-pink-400" },
  money:       { label: "Money",    emoji: "💸", color: "text-teal-400" },
  calendar:    { label: "Calendar", emoji: "🗓️", color: "text-blue-400" },
  tags:        { label: "Tags",     emoji: "🏷️", color: "text-primary" },
  consistency: { label: "Regularity", emoji: "🎚️", color: "text-teal-300" },
  streaks:     { label: "Streaks",  emoji: "🔁", color: "text-purple-400" },
  absence:     { label: "Missing lately", emoji: "🕳️", color: "text-slate-400" },
  body:        { label: "Body Measurements", emoji: "⚖️", color: "text-orange-300" },
}

const CATEGORY_ORDER: Category[] = ["absence", "sleep", "consistency", "streaks", "recovery", "heart", "body", "stress", "food", "symptoms", "supplements", "interactions", "fitness", "places", "week", "fasting", "habits", "custom", "focus", "caffeine", "screen", "work", "music", "money", "calendar", "tags"]

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
  // An association the user can act on gets a way to test it properly.
  const suggestion = experimentSuggestion(insight)
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
              // Not just suspicion — say how much survives without weekends,
              // so "the weekend did most of this" is a number, not a vibe.
              <Badge variant="secondary" className="text-[10px] font-semibold px-1.5 text-sky-400">
                Weekend pattern?
                {insight.weekdayDelta != null &&
                  ` · weekdays only ${insight.weekdayDelta >= 0 ? "+" : ""}${insight.weekdayDelta.toFixed(1)}%`}
              </Badge>
            )}
          </div>
        </div>

        {/* Finding text */}
        <p className="text-sm text-muted-foreground leading-relaxed">{insight.finding}</p>
        {suggestion && (
          <Link
            href={`/dashboard/experiments?${new URLSearchParams({ name: suggestion.name, action: suggestion.action, outcome: suggestion.outcome })}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline underline-offset-2"
          >
            🧪 Test this properly
          </Link>
        )}

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
  // A quarter cannot see a season. Imported history goes back years, so the
  // question a year of data exists for — "am I worse in winter" — is finally
  // askable. It is the slowest to compute and deliberately not the default.
  { key: "year", label: "1 year" },
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
  // Weak patterns are hidden by default. The engine already tiers them with a
  // permutation test and false-discovery control, but listing a "Could be
  // chance" card between two solid ones lets a five-day fluke read as a
  // finding — "your morning mood averages 3 vs 3" is not news. They stay one
  // tap away rather than being deleted, because "nothing found" and "nothing
  // survived the filter" are different answers and the user deserves both.
  const [showWeak, setShowWeak] = useState(false)

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

  const allInsights = data?.insights ?? []
  const weakCount = allInsights.filter(i => i.tier === "noise").length
  const visible = showWeak ? allInsights : allInsights.filter(i => i.tier !== "noise")

  // Group insights by category (preserving sort order within each group)
  const grouped: Partial<Record<Category, InsightResult[]>> = {}
  for (const insight of visible) {
    if (!grouped[insight.category]) grouped[insight.category] = []
    grouped[insight.category]!.push(insight)
  }

  const hasAnyInsights = visible.length > 0

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
            {weakCount > 0 && (
              <button
                onClick={() => setShowWeak(v => !v)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showWeak ? `Hide ${weakCount} weak` : `Show ${weakCount} weak`}
              </button>
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

      {/* ── Today vs your own baseline ── */}
      <DailyScoreCard />
      <BaselineAlerts />

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
        weakCount > 0 ? (
          // Not the same as having no data: patterns were found, none of them
          // beat their own null distribution. Saying so is more useful — and
          // more honest — than an empty page implying nothing happened.
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
              <p className="text-sm text-muted-foreground">
                Nothing solid this period. {weakCount} pattern{weakCount === 1 ? "" : "s"} turned up
                that could just as easily be chance.
              </p>
              <button onClick={() => setShowWeak(true)} className="text-xs text-primary hover:underline">
                Show them anyway
              </button>
            </CardContent>
          </Card>
        ) : (
          <EmptyState />
        )
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
          {!grouped.custom?.length && (
            <p className="text-xs text-muted-foreground/50">
              📐 Custom trackers join once one has ~10 logged days ·{" "}
              <Link href="/dashboard/custom" className="underline underline-offset-2 hover:text-muted-foreground">
                Trackers
              </Link>
            </p>
          )}
        </div>
      )}

      {/* ── By place — visit-night deltas per saved place, from the retired
          Place patterns page. Below the battery deliberately: these carry a
          simpler confidence label, and the footnote inside says so. ── */}
      <section>
        <CardHeader className="px-0 pb-3 pt-0">
          <CardTitle className="text-sm font-semibold uppercase tracking-widest flex items-center gap-2 text-sky-400">
            <span role="img">📍</span>
            By place
          </CardTitle>
        </CardHeader>
        <PlaceCorrelations />
      </section>
    </div>
  )
}
