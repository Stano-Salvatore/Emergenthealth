"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react"

interface DowStat {
  day: string
  avgSleep: number | null
  avgSteps: number | null
  avgReadiness: number | null
}

interface FocusDowStat {
  day: string
  avgFocusMin: number | null
}

interface StatsData {
  dowStats: DowStat[]
  focusDowStats: FocusDowStat[]
  trendData: {
    sleep: { current: number | null; prev: number | null }
    steps: { current: number | null; prev: number | null }
    readiness: { current: number | null; prev: number | null }
    hrv: { current: number | null; prev: number | null }
  }
  bestSleepDay: { date: string; sleepH: string } | null
  bestStepsDay: { date: string; steps: string } | null
  waterStreak: number
  totalFocusMin30: number
}

function trend(current: number | null, prev: number | null, higherIsBetter = true) {
  if (!current || !prev) return null
  const diff = ((current - prev) / prev) * 100
  const up = diff > 0
  const good = higherIsBetter ? up : !up
  return { pct: Math.abs(diff).toFixed(1), up, good }
}

function TrendBadge({ current, prev, higherIsBetter = true }: { current: number | null; prev: number | null; higherIsBetter?: boolean }) {
  const t = trend(current, prev, higherIsBetter)
  if (!t) return <span className="text-xs text-muted-foreground">no data</span>
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${t.good ? "text-green-400" : "text-red-400"}`}>
      {t.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {t.pct}%
    </span>
  )
}

function MiniBar({ value, max, color }: { value: number | null; max: number; color: string }) {
  const pct = value != null ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex-1 h-5 bg-secondary rounded-sm overflow-hidden flex items-end">
      <div className={`w-full rounded-sm transition-all ${color}`} style={{ height: `${Math.max(4, pct)}%` }} />
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
      {[...Array(3)].map((_,i) => <div key={i} className="h-40 bg-secondary rounded-xl animate-pulse" />)}
    </div>
  )

  if (!data) return <p className="text-muted-foreground">Failed to load stats.</p>

  const { dowStats, focusDowStats, trendData, bestSleepDay, bestStepsDay, waterStreak, totalFocusMin30 } = data

  const maxSleep = Math.max(...dowStats.map(d => d.avgSleep ?? 0), 9)
  const maxSteps = Math.max(...dowStats.map(d => d.avgSteps ?? 0), 8000)
  const maxReadiness = 100
  const maxFocus = Math.max(...focusDowStats.map(d => d.avgFocusMin ?? 0), 60)

  const today = new Date().getDay()

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" /> Insights
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">Patterns and trends from the last 30 days</p>
      </div>

      {/* week-over-week trends */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <TrendCard label="Sleep" unit="h"
          current={trendData.sleep.current} prev={trendData.sleep.prev}
          fmt={v => v.toFixed(1)} higherIsBetter />
        <TrendCard label="Steps" unit=""
          current={trendData.steps.current} prev={trendData.steps.prev}
          fmt={v => Math.round(v).toLocaleString()} higherIsBetter />
        <TrendCard label="Readiness" unit=""
          current={trendData.readiness.current} prev={trendData.readiness.prev}
          fmt={v => Math.round(v).toString()} higherIsBetter />
        <TrendCard label="HRV" unit="ms"
          current={trendData.hrv.current} prev={trendData.hrv.prev}
          fmt={v => Math.round(v).toString()} higherIsBetter />
      </div>

      {/* day-of-week patterns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sleep by day of week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {dowStats.map((d, i) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <MiniBar value={d.avgSleep} max={maxSleep} color={i === today ? "bg-indigo-400" : "bg-indigo-500/50"} />
                  <span className={`text-[9px] ${i === today ? "text-indigo-400 font-bold" : "text-muted-foreground"}`}>{d.day}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>avg hours per day</span>
              <span>best: {dowStats.reduce((b,d) => (d.avgSleep ?? 0) > (b.avgSleep ?? 0) ? d : b).day}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Steps by day of week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {dowStats.map((d, i) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <MiniBar value={d.avgSteps} max={maxSteps} color={i === today ? "bg-green-400" : "bg-green-500/50"} />
                  <span className={`text-[9px] ${i === today ? "text-green-400 font-bold" : "text-muted-foreground"}`}>{d.day}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>avg steps per day</span>
              <span>best: {dowStats.reduce((b,d) => (d.avgSteps ?? 0) > (b.avgSteps ?? 0) ? d : b).day}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Readiness by day of week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {dowStats.map((d, i) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <MiniBar value={d.avgReadiness} max={maxReadiness}
                    color={(d.avgReadiness ?? 0) >= 70 ? (i === today ? "bg-emerald-400" : "bg-emerald-500/50") : (i === today ? "bg-amber-400" : "bg-amber-500/50")} />
                  <span className={`text-[9px] ${i === today ? "font-bold text-emerald-400" : "text-muted-foreground"}`}>{d.day}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>avg readiness score</span>
              <span>best: {dowStats.reduce((b,d) => (d.avgReadiness ?? 0) > (b.avgReadiness ?? 0) ? d : b).day}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Focus sessions by day</CardTitle>
          </CardHeader>
          <CardContent>
            {focusDowStats.every(d => !d.avgFocusMin) ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No focus sessions logged yet</p>
            ) : (
              <>
                <div className="flex items-end gap-1 h-24">
                  {focusDowStats.map((d, i) => (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                      <MiniBar value={d.avgFocusMin} max={maxFocus} color={i === today ? "bg-indigo-400" : "bg-indigo-500/50"} />
                      <span className={`text-[9px] ${i === today ? "text-indigo-400 font-bold" : "text-muted-foreground"}`}>{d.day}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                  <span>avg focus minutes</span>
                  <span>most: {focusDowStats.reduce((b,d) => (d.avgFocusMin ?? 0) > (b.avgFocusMin ?? 0) ? d : b).day}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* personal records / highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {bestSleepDay && (
          <HighlightCard emoji="🏆" label="Best sleep" value={`${bestSleepDay.sleepH}h`} sub={bestSleepDay.date} />
        )}
        {bestStepsDay && (
          <HighlightCard emoji="🦶" label="Most steps" value={bestStepsDay.steps} sub={bestStepsDay.date} />
        )}
        <HighlightCard emoji="💧" label="Water streak"
          value={`${waterStreak}d`} sub={waterStreak >= 3 ? "great!" : "keep going"} />
        <HighlightCard emoji="🧠" label="Focus (30d)"
          value={totalFocusMin30 >= 60 ? `${(totalFocusMin30/60).toFixed(1)}h` : `${totalFocusMin30}m`}
          sub="deep work" />
      </div>
    </div>
  )
}

function TrendCard({ label, unit, current, prev, fmt, higherIsBetter }: {
  label: string; unit: string; current: number | null; prev: number | null;
  fmt: (v: number) => string; higherIsBetter: boolean
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-xl font-black">
          {current != null ? `${fmt(current)}${unit}` : "—"}
        </p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[10px] text-muted-foreground">vs prev week</p>
          <TrendBadge current={current} prev={prev} higherIsBetter={higherIsBetter} />
        </div>
      </CardContent>
    </Card>
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
