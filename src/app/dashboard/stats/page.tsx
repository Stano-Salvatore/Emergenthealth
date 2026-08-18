"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown, Minus, BarChart3, Moon, Footprints, Activity, Zap } from "lucide-react"

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

  if (!data) return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 px-8 py-20 text-center max-w-3xl">
      <div className="mb-3 text-5xl leading-none select-none">📊</div>
      <h3 className="text-base font-semibold text-foreground">Could not load trends</h3>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Something went wrong fetching your stats. Try refreshing the page.
      </p>
    </div>
  )

  const { dowStats, focusDowStats, trendData, bestSleepDay, bestStepsDay, bestReadinessDay, bestHrvDay,
    waterStreak, totalFocusMin30, stepStreak, sleepStreak, hrvTrend, hrvAvg7,
    sleepConsistency, avgBedtime, bedtimeStdDevMin, dataPoints } = data

  const maxSleep = Math.max(...dowStats.map(d => d.avgSleep ?? 0), 9)
  const maxSteps = Math.max(...dowStats.map(d => d.avgSteps ?? 0), 8000)
  const maxFocus = Math.max(...focusDowStats.map(d => d.avgFocusMin ?? 0), 60)
  const today = new Date().getDay()

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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary shrink-0" /> Trends
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            How you&apos;re doing — {dataPoints} days of data · last 90 days
          </p>
        </div>
        {needsMoreData && (
          <div className="text-xs text-muted-foreground bg-secondary/60 rounded-lg px-3 py-2 max-w-[180px] text-right shrink-0">
            Trends improve with 14+ days of data
          </div>
        )}
      </div>

      {dataPoints === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 px-8 py-20 text-center">
          <div className="mb-3 text-5xl leading-none select-none">📈</div>
          <h3 className="text-base font-semibold text-foreground">No trends yet</h3>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
            Trends appear once you have at least 7 days of health data. Log your sleep, steps, and readiness to unlock them.
          </p>
          <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground text-left">
            <span className="flex items-start gap-2">
              <span className="text-primary shrink-0">•</span>
              <span>
                Connect Oura Ring in{" "}
                <a href="/dashboard/settings" className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">
                  Settings → Integrations
                </a>
              </span>
            </span>
            <span className="flex items-start gap-2">
              <span className="text-primary shrink-0">•</span>
              <span>
                Or log manually on the{" "}
                <a href="/dashboard/health" className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">
                  Health page
                </a>
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ── Pattern findings live on Insights now ── */}
      <a
        href="/dashboard/insights"
        className="block rounded-xl border border-primary/20 bg-primary/5 p-4 hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">What predicts what → Insights</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Correlations moved to the Insights page — one place, every finding tested against chance before it&apos;s shown.
            </p>
          </div>
          <span className="text-primary text-lg shrink-0" aria-hidden>→</span>
        </div>
      </a>

      {/* ── Week-over-week trends ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Sleep", icon: <Moon className="h-3.5 w-3.5 text-primary" />, ...trendData.sleep, fmt: (v: number) => `${v.toFixed(1)}h` },
          { label: "Steps", icon: <Footprints className="h-3.5 w-3.5 text-green-400" />, ...trendData.steps, fmt: (v: number) => Math.round(v).toLocaleString() },
          { label: "Readiness", icon: <Zap className="h-3.5 w-3.5 text-emerald-400" />, ...trendData.readiness, fmt: (v: number) => Math.round(v).toString() },
          { label: "HRV", icon: <Activity className="h-3.5 w-3.5 text-primary" />, ...trendData.hrv, fmt: (v: number) => `${Math.round(v)}ms` },
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
        <Card className={sleepStreak >= 3 ? "border-primary/20" : ""}>
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
          { label: "Sleep by day", data: dowStats.map(d => ({ day: d.day, val: d.avgSleep })), max: maxSleep, color: "bg-primary/30", activeColor: "bg-primary" },
          { label: "Steps by day", data: dowStats.map(d => ({ day: d.day, val: d.avgSteps })), max: maxSteps, color: "bg-green-500/50", activeColor: "bg-green-400" },
          { label: "Readiness by day", data: dowStats.map(d => ({ day: d.day, val: d.avgReadiness })), max: 100, color: "bg-emerald-500/50", activeColor: "bg-emerald-400" },
          { label: "Focus by day", data: focusDowStats.map(d => ({ day: d.day, val: d.avgFocusMin })), max: maxFocus, color: "bg-primary/30", activeColor: "bg-primary" },
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
