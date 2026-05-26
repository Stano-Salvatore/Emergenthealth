"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown, Minus, BarChart3, Moon, Footprints, Activity, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

interface Correlation {
  key: string
  label: string
  r: number | null
  n: number
  emoji: string
  insight: string
  strength: "strong" | "moderate" | "weak" | "insufficient"
  direction: "positive" | "negative" | null
  isCustom?: boolean
}

interface StatsData {
  dowStats: { day: string; avgSleep: number | null; avgSteps: number | null; avgReadiness: number | null }[]
  focusDowStats: { day: string; avgFocusMin: number | null }[]
  trendData: {
    sleep: { current: number | null; prev: number | null }
    steps: { current: number | null; prev: number | null }
    readiness: { current: number | null; prev: number | null }
    hrv: { current: number | null; prev: number | null }
  }
  bestSleepDay: { date: string; sleepH: string } | null
  bestStepsDay: { date: string; steps: string } | null
  bestReadinessDay: { date: string; score: number } | null
  bestHrvDay: { date: string; hrv: number } | null
  waterStreak: number
  totalFocusMin30: number
  stepStreak: number
  sleepStreak: number
  hrvTrend: "improving" | "declining" | "stable"
  hrvAvg7: number | null
  sleepConsistency: "consistent" | "moderate" | "irregular" | null
  avgBedtime: string | null
  bedtimeStdDevMin: number | null
  correlations: Correlation[]
  customCorrelations: Correlation[]
  dataPoints: number
}

function MiniBar({ value, max, color }: { value: number | null; max: number; color: string }) {
  const pct = value != null ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex-1 h-5 bg-secondary rounded-sm overflow-hidden flex items-end">
      <div className={`w-full rounded-sm transition-all ${color}`} style={{ height: `${Math.max(4, pct)}%` }} />
    </div>
  )
}

function TrendBadge({ current, prev, higherIsBetter = true }: { current: number | null; prev: number | null; higherIsBetter?: boolean }) {
  if (!current || !prev) return <span className="text-xs text-muted-foreground">—</span>
  const pct = ((current - prev) / prev) * 100
  const up = pct > 1
  const down = pct < -1
  const good = higherIsBetter ? up : down
  if (!up && !down) return <Minus className="h-3 w-3 text-muted-foreground" />
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${good ? "text-green-400" : "text-red-400"}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function CorrelationBar({ r }: { r: number | null }) {
  if (r == null) return <div className="h-1.5 rounded-full bg-secondary w-full" />
  const pct = Math.abs(r) * 100
  const color = r > 0 ? "bg-green-400" : "bg-red-400"
  return (
    <div className="relative h-1.5 rounded-full bg-secondary w-full overflow-hidden">
      {r >= 0 ? (
        <div className={`absolute left-0 top-0 h-full rounded-full ${color}`} style={{ width: `${pct / 2}%`, marginLeft: "50%" }} />
      ) : (
        <div className={`absolute top-0 h-full rounded-full ${color}`} style={{ width: `${pct / 2}%`, right: "50%" }} />
      )}
      <div className="absolute top-0 bottom-0 w-px bg-border/60" style={{ left: "50%" }} />
    </div>
  )
}

function CorrRow({ c }: { c: Correlation }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base leading-none">{c.emoji}</span>
        <span className="text-xs font-medium flex-1">{c.label}</span>
        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0",
          c.strength === "strong" ? "bg-green-500/15 text-green-400"
          : c.strength === "moderate" ? "bg-amber-500/15 text-amber-400"
          : c.strength === "weak" ? "bg-secondary text-muted-foreground"
          : "bg-secondary text-muted-foreground/50"
        )}>
          {c.strength === "insufficient"
            ? `need ${Math.max(0, 7 - c.n)} more days`
            : `r=${c.r?.toFixed(2)}`}
        </span>
      </div>
      <CorrelationBar r={c.r} />
      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{c.insight}</p>
    </div>
  )
}

export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/stats").then(r => r.json()).then(setData).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="space-y-4">
      <div className="h-8 bg-secondary rounded animate-pulse w-48" />
      {[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-secondary rounded-xl animate-pulse" />)}
    </div>
  )

  if (!data) return <p className="text-muted-foreground">Failed to load stats.</p>

  const { dowStats, focusDowStats, trendData, bestSleepDay, bestStepsDay, bestReadinessDay, bestHrvDay,
    waterStreak, totalFocusMin30, stepStreak, sleepStreak, hrvTrend, hrvAvg7,
    sleepConsistency, avgBedtime, bedtimeStdDevMin, correlations, customCorrelations, dataPoints } = data

  const maxSleep = Math.max(...dowStats.map(d => d.avgSleep ?? 0), 9)
  const maxSteps = Math.max(...dowStats.map(d => d.avgSteps ?? 0), 8000)
  const maxFocus = Math.max(...focusDowStats.map(d => d.avgFocusMin ?? 0), 60)
  const today = new Date().getDay()

  const strongCorrelations = [...correlations, ...(customCorrelations ?? [])].filter(c => c.strength === "strong" || c.strength === "moderate")
  const needsMoreData = dataPoints < 7

  const consistencyColor = sleepConsistency === "consistent" ? "text-green-400"
    : sleepConsistency === "moderate" ? "text-amber-400"
    : sleepConsistency === "irregular" ? "text-red-400"
    : "text-muted-foreground"

  const hrvTrendColor = hrvTrend === "improving" ? "text-green-400"
    : hrvTrend === "declining" ? "text-red-400"
    : "text-amber-400"

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> Insights
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Patterns from {dataPoints} days of data · last 90 days
          </p>
        </div>
        {needsMoreData && (
          <div className="text-xs text-muted-foreground bg-secondary/60 rounded-lg px-3 py-2 max-w-[180px] text-right">
            Correlations improve with 14+ days of data
          </div>
        )}
      </div>

      {/* ── Correlations ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Correlations</CardTitle>
          <p className="text-xs text-muted-foreground">How your habits and metrics relate to each other</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {correlations.map(c => (
            <CorrRow key={c.key} c={c} />
          ))}

          {/* Custom metric correlations */}
          {customCorrelations.length > 0 && (
            <>
              <div className="pt-2 border-t border-border/40">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">
                  📐 Your trackers
                </p>
                <div className="space-y-4">
                  {customCorrelations.map(c => <CorrRow key={c.key} c={c} />)}
                </div>
              </div>
            </>
          )}

          {customCorrelations.length === 0 && (
            <p className="text-xs text-muted-foreground/40 border-t border-border/30 pt-3 mt-2">
              Create custom trackers and log 7+ days to unlock tracker correlations →{" "}
              <a href="/dashboard/custom" className="underline underline-offset-2 hover:text-muted-foreground">Trackers</a>
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Top insights strip (strong/moderate only) ── */}
      {strongCorrelations.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Key findings</p>
          <div className="space-y-2">
            {strongCorrelations.slice(0, 3).map(c => (
              <div key={c.key} className="flex items-start gap-2">
                <span className="text-sm shrink-0">{c.emoji}</span>
                <p className="text-sm leading-snug">{c.insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Week-over-week trends ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Sleep", icon: <Moon className="h-3.5 w-3.5 text-indigo-400" />, ...trendData.sleep, fmt: (v: number) => `${v.toFixed(1)}h` },
          { label: "Steps", icon: <Footprints className="h-3.5 w-3.5 text-green-400" />, ...trendData.steps, fmt: (v: number) => Math.round(v).toLocaleString() },
          { label: "Readiness", icon: <Zap className="h-3.5 w-3.5 text-emerald-400" />, ...trendData.readiness, fmt: (v: number) => Math.round(v).toString() },
          { label: "HRV", icon: <Activity className="h-3.5 w-3.5 text-violet-400" />, ...trendData.hrv, fmt: (v: number) => `${Math.round(v)}ms` },
        ].map(({ label, icon, current, prev, fmt }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                {icon}{label}
              </div>
              <p className="text-xl font-black">{current != null ? fmt(current) : "—"}</p>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground">vs prev 7d</p>
                <TrendBadge current={current} prev={prev} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Streaks + consistency row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className={stepStreak >= 3 ? "border-green-500/20" : ""}>
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-2xl mb-0.5">🦶</p>
            <p className="text-[10px] text-muted-foreground">Step goal streak</p>
            <p className="text-xl font-black mt-0.5">{stepStreak}d</p>
            <p className="text-[10px] text-muted-foreground/70">8,000 steps/day</p>
          </CardContent>
        </Card>
        <Card className={sleepStreak >= 3 ? "border-indigo-500/20" : ""}>
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-2xl mb-0.5">🌙</p>
            <p className="text-[10px] text-muted-foreground">Sleep goal streak</p>
            <p className="text-xl font-black mt-0.5">{sleepStreak}d</p>
            <p className="text-[10px] text-muted-foreground/70">7h+ per night</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-2xl mb-0.5">
              {hrvTrend === "improving" ? "📈" : hrvTrend === "declining" ? "📉" : "➡️"}
            </p>
            <p className="text-[10px] text-muted-foreground">HRV 30d trend</p>
            <p className={`text-base font-black mt-0.5 ${hrvTrendColor}`}>{hrvTrend}</p>
            {hrvAvg7 != null && <p className="text-[10px] text-muted-foreground/70">avg {Math.round(hrvAvg7)}ms (7d)</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-2xl mb-0.5">
              {sleepConsistency === "consistent" ? "🎯" : sleepConsistency === "moderate" ? "〜" : sleepConsistency === "irregular" ? "⚠️" : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Bedtime regularity</p>
            <p className={`text-base font-black mt-0.5 ${consistencyColor}`}>
              {sleepConsistency ?? "no data"}
            </p>
            {avgBedtime && <p className="text-[10px] text-muted-foreground/70">avg {avgBedtime}{bedtimeStdDevMin != null ? ` ±${bedtimeStdDevMin}m` : ""}</p>}
          </CardContent>
        </Card>
      </div>

      {/* ── Day-of-week patterns ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { label: "Sleep by day", data: dowStats.map(d => ({ day: d.day, val: d.avgSleep })), max: maxSleep, color: "bg-indigo-500/50", activeColor: "bg-indigo-400" },
          { label: "Steps by day", data: dowStats.map(d => ({ day: d.day, val: d.avgSteps })), max: maxSteps, color: "bg-green-500/50", activeColor: "bg-green-400" },
          { label: "Readiness by day", data: dowStats.map(d => ({ day: d.day, val: d.avgReadiness })), max: 100, color: "bg-emerald-500/50", activeColor: "bg-emerald-400" },
          { label: "Focus by day", data: focusDowStats.map(d => ({ day: d.day, val: d.avgFocusMin })), max: maxFocus, color: "bg-indigo-500/50", activeColor: "bg-violet-400" },
        ].map(({ label, data, max, color, activeColor }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.every(d => !d.val) ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No data yet</p>
              ) : (
                <>
                  <div className="flex items-end gap-1 h-24">
                    {data.map((d, i) => (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                        <MiniBar value={d.val} max={max} color={i === today ? activeColor : color} />
                        <span className={`text-[9px] ${i === today ? `${activeColor.replace("bg-", "text-")} font-bold` : "text-muted-foreground"}`}>{d.day}</span>
                      </div>
                    ))}
                  </div>
                  {data.some(d => d.val != null) && (
                    <p className="mt-2 text-[10px] text-muted-foreground text-right">
                      best: {data.reduce((b, d) => (d.val ?? 0) > (b.val ?? 0) ? d : b).day}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Personal records ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {bestSleepDay && <HighlightCard emoji="🏆" label="Best sleep" value={`${bestSleepDay.sleepH}h`} sub={bestSleepDay.date} />}
        {bestStepsDay && <HighlightCard emoji="🦶" label="Most steps" value={bestStepsDay.steps} sub={bestStepsDay.date} />}
        {bestReadinessDay && <HighlightCard emoji="⚡" label="Peak readiness" value={String(bestReadinessDay.score)} sub={bestReadinessDay.date} />}
        {bestHrvDay && <HighlightCard emoji="💜" label="Peak HRV" value={`${bestHrvDay.hrv}ms`} sub={bestHrvDay.date} />}
        <HighlightCard emoji="💧" label="Water streak" value={`${waterStreak}d`} sub={waterStreak >= 3 ? "great!" : "keep going"} />
        <HighlightCard emoji="🧠" label="Focus (30d)"
          value={totalFocusMin30 >= 60 ? `${(totalFocusMin30 / 60).toFixed(1)}h` : `${totalFocusMin30}m`}
          sub="deep work" />
      </div>
    </div>
  )
}

function HighlightCard({ emoji, label, value, sub }: { emoji: string; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3 text-center">
        <p className="text-2xl mb-0.5">{emoji}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-base font-black mt-0.5">{value}</p>
        <p className="text-[10px] text-muted-foreground/70">{sub}</p>
      </CardContent>
    </Card>
  )
}
