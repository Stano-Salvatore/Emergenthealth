"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Sparkles, Moon, Target, ChevronRight, Sun, Sunset, CloudSun } from "lucide-react"

function weatherEmoji(code: number): string {
  if (code <= 2) return "☀️"
  if (code === 3) return "⛅"
  if (code <= 48) return "🌫️"
  if (code <= 67) return "🌧️"
  if (code <= 77) return "❄️"
  if (code <= 82) return "🌦️"
  return "⛈️"
}

type Period = "morning" | "afternoon" | "evening"

interface TodayData {
  calendar: { id: string; title: string; start: string; end: string }[]
  sleep: { hours: number | null; sleepScore: number | null; readiness: number | null; adequate: boolean | null }
  weather: { current: { temp: number; code: number }; hourly: { hour: string; temp: number; code: number; rainPct: number }[] } | null
  outfit: string
}
interface CheckIn { energy: number; mood: number; intention: string | null; waterGoalMl: number }

const MOODS = ["", "😞 Low", "😟 Meh", "😐 Neutral", "🙂 Good", "😄 Great"]
const ENERGY = ["", "😴 Exhausted", "😪 Tired", "😐 OK", "😊 Good", "⚡ Amazing"]

function periodFor(h: number): Period {
  if (h < 12) return "morning"
  if (h < 17) return "afternoon"
  return "evening"
}

export function BriefView({ name }: { name: string }) {
  const [period, setPeriod] = useState<Period>("morning")
  const [today, setToday] = useState<TodayData | null>(null)
  const [briefing, setBriefing] = useState<string | null>(null)
  const [checkin, setCheckin] = useState<CheckIn | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setPeriod(periodFor(new Date().getHours()))
    const d = new Date()
    const localDate = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-")
    Promise.allSettled([
      fetch("/api/today").then(r => r.json()),
      fetch("/api/briefing").then(r => r.json()),
      fetch(`/api/morning-checkin?date=${localDate}`).then(r => r.json()),
    ]).then(([t, b, c]) => {
      if (t.status === "fulfilled") setToday(t.value)
      if (b.status === "fulfilled" && b.value?.briefing) setBriefing(b.value.briefing)
      if (c.status === "fulfilled" && c.value?.checkin) setCheckin(c.value.checkin)
      setLoading(false)
    })
  }, [])

  const greeting = period === "morning" ? "Good morning" : period === "afternoon" ? "Good afternoon" : "Good evening"
  const PeriodIcon = period === "morning" ? Sun : period === "afternoon" ? CloudSun : Sunset
  const isEvening = period === "evening"
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })

  const readinessColor = (r: number | null) =>
    r == null ? "text-muted-foreground" : r >= 85 ? "text-green-400" : r >= 70 ? "text-yellow-400" : "text-red-400"
  const sleepColor = today?.sleep.adequate === true ? "text-green-400"
    : today?.sleep.adequate === false && (today?.sleep.hours ?? 0) >= 6 ? "text-yellow-400" : "text-red-400"

  const nextEvent = today?.calendar?.[0] ?? null

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <PeriodIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{greeting}, {name}</h1>
          <p className="text-muted-foreground text-sm">{dateLabel}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-xl bg-secondary/40 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* AI brief line */}
          {briefing && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-4 pb-4 flex items-start gap-2.5">
                <Sparkles className="h-4 w-4 text-primary/70 mt-0.5 shrink-0" />
                <p className="text-sm text-foreground/90 italic leading-relaxed">{briefing}</p>
              </CardContent>
            </Card>
          )}

          {/* Sleep / readiness — the anchor of both briefs */}
          {(today?.sleep.hours != null || today?.sleep.readiness != null) && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Moon className="h-3.5 w-3.5" /> {isEvening ? "Last night" : "How you slept"}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">😴 Sleep</p>
                    {today?.sleep.hours != null ? (
                      <p className={`text-2xl font-bold tabular-nums ${sleepColor}`}>
                        {today.sleep.hours.toFixed(1)}<span className="text-sm font-normal text-muted-foreground ml-1">hrs</span>
                      </p>
                    ) : <p className="text-sm text-muted-foreground">No data</p>}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">🎯 Readiness</p>
                    {today?.sleep.readiness != null ? (
                      <p className={`text-2xl font-bold tabular-nums ${readinessColor(today.sleep.readiness)}`}>
                        {today.sleep.readiness}<span className="text-sm font-normal text-muted-foreground ml-1">/100</span>
                      </p>
                    ) : <p className="text-sm text-muted-foreground">No data</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── MORNING / DAY: what's ahead ── */}
          {!isEvening && (
            <>
              {today?.weather && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      {weatherEmoji(today.weather.current.code)} Weather · {today.weather.current.temp}°C
                    </p>
                    <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
                      {today.weather.hourly.slice(0, 8).map(h => (
                        <div key={h.hour} className="flex flex-col items-center gap-0.5 shrink-0">
                          <span className="text-[11px] text-muted-foreground">{h.hour}</span>
                          <span className="text-base leading-none">{weatherEmoji(h.code)}</span>
                          <span className="text-xs font-medium">{h.temp}°</span>
                          {h.rainPct > 30 && <span className="text-[10px] text-blue-400">{h.rainPct}%</span>}
                        </div>
                      ))}
                    </div>
                    {today.outfit && <p className="text-xs text-muted-foreground mt-2">👗 {today.outfit}</p>}
                  </CardContent>
                </Card>
              )}

              {checkin?.intention && (
                <Card className="border-primary/20">
                  <CardContent className="pt-4 pb-4 flex items-start gap-2.5">
                    <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Your focus today</p>
                      <p className="text-sm">{checkin.intention}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!checkin && (
                <Link href="/dashboard/checkin" className="block">
                  <Card className="border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors">
                    <CardContent className="pt-4 pb-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">🌅 Start your day with a check-in</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Log energy, mood & focus — 10 seconds</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              )}
            </>
          )}

          {/* ── EVENING: recap + reflect ── */}
          {isEvening && (
            <>
              {checkin && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Today&apos;s check-in</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Energy</p>
                        <p>{ENERGY[checkin.energy] ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Mood</p>
                        <p>{MOODS[checkin.mood] ?? "—"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {nextEvent && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">📅 Still on your calendar</p>
                    <p className="text-sm">
                      <span className="text-muted-foreground tabular-nums mr-2">
                        {nextEvent.start.includes("T") ? nextEvent.start.slice(11, 16) : "All day"}
                      </span>
                      {nextEvent.title}
                    </p>
                  </CardContent>
                </Card>
              )}

              <Link href="/dashboard/journal" className="block">
                <Card className="border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors">
                  <CardContent className="pt-4 pb-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">🌙 Wind down with a reflection</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Jot a line in your journal before bed</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            </>
          )}

          {/* Quick links */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Link href="/dashboard" className="rounded-xl border border-border bg-card px-3 py-2.5 text-center text-xs font-medium hover:bg-secondary/60 transition-colors">🏠 Dashboard</Link>
            <Link href="/dashboard/habits" className="rounded-xl border border-border bg-card px-3 py-2.5 text-center text-xs font-medium hover:bg-secondary/60 transition-colors">✅ Habits</Link>
            <Link href="/dashboard/health" className="rounded-xl border border-border bg-card px-3 py-2.5 text-center text-xs font-medium hover:bg-secondary/60 transition-colors">❤️ Health</Link>
          </div>
        </>
      )}
    </div>
  )
}
