"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = "sleep" | "stress" | "habits" | "caffeine" | "recovery" | "tags"

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
}

interface CorrelationsData {
  insights: InsightResult[]
  dataRange: { days: number }
}

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<Category, { label: string; emoji: string; color: string }> = {
  sleep:    { label: "Sleep",    emoji: "🌙", color: "text-indigo-400" },
  stress:   { label: "Stress",   emoji: "😤", color: "text-orange-400" },
  habits:   { label: "Habits",   emoji: "✅", color: "text-green-400" },
  caffeine: { label: "Caffeine", emoji: "☕", color: "text-amber-400" },
  recovery: { label: "Recovery", emoji: "❤️", color: "text-rose-400" },
  tags:     { label: "Tags",     emoji: "🏷️", color: "text-primary" },
}

const CATEGORY_ORDER: Category[] = ["sleep", "recovery", "stress", "habits", "caffeine", "tags"]

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
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] font-semibold px-1.5",
                insight.confident ? "text-primary" : "text-muted-foreground",
              )}
            >
              {insight.confident ? "Strong" : "Early"}
            </Badge>
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

export default function InsightsPage() {
  const [data, setData] = useState<CorrelationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/insights/correlations")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<CorrelationsData>
      })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

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
      </div>

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
