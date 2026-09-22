"use client"

import { useEffect, useState } from "react"
import { weatherEmoji, weatherLabel } from "@/lib/weather-codes"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Moon, Target, ChevronRight, Sun, Sunset, CloudSun, Gauge, CalendarDays, Sunrise, LayoutDashboard, ListChecks, HeartPulse } from "lucide-react"
import { DailyBriefing } from "@/components/dashboard/DailyBriefing"

type Period = "morning" | "afternoon" | "evening"

interface DayOutlook { date: string; max: number; min: number; code: number; rainPct: number }
interface Targets {
  steps: { value: number | null; goal: number }
  hydrationMl: { value: number; goal: number }
  habits: { done: number; due: number }
  lastSyncedAt: string | null
}
interface TodayData {
  calendar: { id: string; title: string; start: string; end: string }[]
  tomorrow?: { id: string; title: string; start: string; end: string; isAllDay: boolean }[]
  sleep: { hours: number | null; sleepScore: number | null; readiness: number | null; adequate: boolean | null }
  weather: { current: { temp: number; code: number }; hourly: { hour: string; temp: number; code: number; rainPct: number }[] } | null
  daily?: { today: DayOutlook; tomorrow: DayOutlook } | null
  outfit: string
  targets?: Targets | null
}

/**
 * One target as a ring. Identity hue per target, never a verdict colour: a
 * red ring under 4,395 steps of a 1,500 goal would be the picture
 * concluding what the number did not (see the chart rule in the handoff).
 */
function Ring({ value, goal, hue, label, display }: { value: number | null; goal: number; hue: string; label: string; display: string }) {
  const r = 22
  const c = 2 * Math.PI * r
  const frac = value == null || goal <= 0 ? 0 : Math.min(1, value / goal)
  return (
    <div className="flex items-center gap-3 min-w-0">
      <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${label}: ${display}`} className="shrink-0">
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-secondary" />
        <circle
          cx="28" cy="28" r={r} fill="none" stroke={hue} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c * (1 - frac)}`} transform="rotate(-90 28 28)"
        />
      </svg>
      <div className="min-w-0">
        <p className="text-lg font-bold tabular-nums font-display leading-tight">{display}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function syncedLabel(iso: string | null): string {
  if (!iso) return "Not synced yet today"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const sameDay = d.toDateString() === new Date().toDateString()
  return `Last synced ${sameDay ? "" : d.toLocaleDateString([], { day: "numeric", month: "short" }) + " "}${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}
interface CheckIn { energy: number; mood: number; intention: string | null; waterGoalMl: number }

const MOODS = ["", "😞 Low", "😟 Meh", "😐 Neutral", "🙂 Good", "😄 Great"]
const ENERGY = ["", "😴 Exhausted", "😪 Tired", "😐 OK", "😊 Good", "⚡ Amazing"]

function periodFor(h: number): Period {
  if (h < 12) return "morning"
  if (h < 17) return "afternoon"
  return "evening"
}

// Times arrive as ISO strings. Formatting them in the browser's own locale and
// zone is right by construction; slicing "HH:MM" out of the raw text only
// happened to work because Google sends an offset with every timestamp.
function eventTime(iso: string): string {
  if (!iso.includes("T")) return "All day"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// An event still counts as ahead of you until it ends (or, with no end time,
// until it starts).
function isUpcoming(e: { start: string; end: string }, now: number): boolean {
  if (e.start && !e.start.includes("T")) return true // all-day: runs all day
  const ref = e.end && e.end.includes("T") ? e.end : e.start
  const t = new Date(ref).getTime()
  return Number.isNaN(t) ? false : t >= now
}

export function BriefView({ name }: { name: string }) {
  // Snapshot of "now" for filtering out events that have already finished —
  // it only needs to be right at render, not tick.
  const [renderedAt] = useState(() => Date.now())
  const [period, setPeriod] = useState<Period>("morning")
  const [today, setToday] = useState<TodayData | null>(null)
  const [checkin, setCheckin] = useState<CheckIn | null>(null)
  const [loading, setLoading] = useState(true)

  // The page changes shape in the evening, so the period can't be decided once
  // at mount — a brief left open from the afternoon would still be greeting you
  // with "Good afternoon" and showing the morning layout hours later.
  useEffect(() => {
    const sync = () => setPeriod(periodFor(new Date().getHours()))
    sync()
    const t = setInterval(sync, 60000)
    const onVisible = () => { if (document.visibilityState === "visible") sync() }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  useEffect(() => {
    const d = new Date()
    const localDate = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-")
    // The AI brief itself is DailyBriefing's job — one component, both pages.
    Promise.allSettled([
      fetch("/api/today").then(r => r.json()),
      fetch(`/api/morning-checkin?date=${localDate}`).then(r => r.json()),
    ]).then(([t, c]) => {
      if (t.status === "fulfilled") setToday(t.value)
      if (c.status === "fulfilled" && c.value?.checkin) setCheckin(c.value.checkin)
      setLoading(false)
    })
  }, [])

  const greeting = period === "morning" ? "Good morning" : period === "afternoon" ? "Good afternoon" : "Good evening"
  const PeriodIcon = period === "morning" ? Sun : period === "afternoon" ? CloudSun : Sunset
  const isEvening = period === "evening"
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })

  // The evening reads like the phone's own night brief: one line about
  // tonight, the two-day outlook, tomorrow's calendar, and how today's
  // targets ended — each drawn from its own source and absent, not
  // invented, when that source has nothing.
  const daily = today?.daily ?? null
  const tonightLine = daily
    ? `${weatherLabel(daily.tomorrow.code)} tomorrow. Low ${Math.min(daily.today.min, daily.tomorrow.min)}°.`
    : null
  const tomorrowEvents = today?.tomorrow ?? []
  const targets = today?.targets ?? null

  // Identity, not status: the figures take the sleep domain hue (hours and
  // score both belong to Sleep — see design/handoff/README.md). This card
  // used to paint them green/amber by verdict, which is exactly the
  // status-on-a-figure collision the palette rule exists to prevent.

  // The evening card used to show calendar[0] — the day's *first* event — and
  // label it "still on your calendar", so at 21:00 it announced the 09:00
  // standup. Only events that haven't finished yet qualify.
  const nextEvent = today?.calendar?.find(e => isUpcoming(e, renderedAt)) ?? null

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <PeriodIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{isEvening ? "Tonight's brief" : `${greeting}, ${name}`}</h1>
          <p className="text-muted-foreground text-sm">{isEvening ? `Time to wrap up the day, ${name}. ${dateLabel}.` : dateLabel}</p>
        </div>
      </div>
      {isEvening && tonightLine && !loading && (
        <p className="text-base text-foreground/90">{tonightLine}</p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-xl bg-secondary/40 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Emergy's brief — the shared component, same as the dashboard */}
          <DailyBriefing />

          {/* Sleep / readiness — the anchor of both briefs */}
          {(today?.sleep.hours != null || today?.sleep.readiness != null) && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Moon className="h-3.5 w-3.5" /> {isEvening ? "Last night" : "How you slept"}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><Moon className="h-3 w-3" /> Sleep</p>
                    {today?.sleep.hours != null ? (
                      <p className="text-2xl font-bold tabular-nums font-display text-sleep">
                        {today.sleep.hours.toFixed(1)}<span className="text-sm font-normal text-muted-foreground ml-1">hrs</span>
                      </p>
                    ) : <p className="text-sm text-muted-foreground">No data</p>}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1"><Gauge className="h-3 w-3" /> Readiness</p>
                    {today?.sleep.readiness != null ? (
                      <p className="text-2xl font-bold tabular-nums font-display text-sleep">
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
                    <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3">
                      <Sunrise className="h-5 w-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Start your day with a check-in</p>
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
              {today?.weather && daily && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl leading-none">{weatherEmoji(today.weather.current.code)}</span>
                        <div>
                          <p className="text-2xl font-bold tabular-nums font-display leading-tight">{today.weather.current.temp}°</p>
                          <p className="text-xs text-muted-foreground">{weatherLabel(today.weather.current.code)} now</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground text-right">↑{daily.today.max}° / ↓{daily.today.min}°</p>
                    </div>
                    <div className="border-t border-border/50 mt-3 pt-2 space-y-1.5">
                      {([["Today", daily.today], ["Tomorrow", daily.tomorrow]] as const).map(([label, d]) => (
                        <div key={label} className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium w-20">{label}</span>
                          <span className="text-xs text-muted-foreground tabular-nums w-12">💧 {d.rainPct}%</span>
                          <span className="text-base leading-none">{weatherEmoji(d.code)}</span>
                          <span className="tabular-nums w-16 text-right"><span className="font-semibold">{d.max}°</span> <span className="text-muted-foreground">{d.min}°</span></span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {tomorrowEvents.length > 0 && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-sm mb-2">
                      You have <span className="text-primary font-medium">{tomorrowEvents.length} {tomorrowEvents.length === 1 ? "event" : "events"}</span> tomorrow.
                    </p>
                    <div className="space-y-1.5">
                      {tomorrowEvents.slice(0, 4).map(e => (
                        <div key={e.id} className="flex items-center gap-2 text-sm rounded-lg bg-secondary/40 px-3 py-2">
                          <span className="h-4 w-1 rounded-full bg-primary shrink-0" aria-hidden />
                          <span className="text-muted-foreground tabular-nums shrink-0">{e.isAllDay ? "All day" : eventTime(e.start)}</span>
                          <span className="truncate">{e.title}</span>
                        </div>
                      ))}
                      {tomorrowEvents.length > 4 && (
                        <p className="text-[11px] text-muted-foreground">and {tomorrowEvents.length - 4} more</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {targets && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-sm mb-3">
                      {(() => {
                        const met = [
                          targets.steps.value != null && targets.steps.value >= targets.steps.goal,
                          targets.hydrationMl.value >= targets.hydrationMl.goal,
                          targets.habits.due > 0 && targets.habits.done >= targets.habits.due,
                        ].filter(Boolean).length
                        const total = targets.habits.due > 0 ? 3 : 2
                        return met === total
                          ? `All ${total} of today's targets reached.`
                          : `${met} of ${total} daily targets reached. ${total - met === 1 ? "One" : "The rest"} can wait for tomorrow.`
                      })()}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Ring
                        value={targets.steps.value} goal={targets.steps.goal} hue="var(--activity, #34d399)" label={`of ${targets.steps.goal.toLocaleString()} steps`}
                        display={targets.steps.value != null ? targets.steps.value.toLocaleString() : "—"}
                      />
                      <Ring
                        value={targets.hydrationMl.value} goal={targets.hydrationMl.goal} hue="#60a5fa" label={`of ${(targets.hydrationMl.goal / 1000).toFixed(1)} L`}
                        display={`${(targets.hydrationMl.value / 1000).toFixed(1)} L`}
                      />
                      {targets.habits.due > 0 && (
                        <Ring
                          value={targets.habits.done} goal={targets.habits.due} hue="#a78bfa" label={`of ${targets.habits.due} habits`}
                          display={`${targets.habits.done}`}
                        />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground text-right mt-3">{syncedLabel(targets.lastSyncedAt)}</p>
                  </CardContent>
                </Card>
              )}

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
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" /> Still on your calendar
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground tabular-nums mr-2">{eventTime(nextEvent.start)}</span>
                      {nextEvent.title}
                    </p>
                  </CardContent>
                </Card>
              )}

              <Link href="/dashboard/journal" className="block">
                <Card className="border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors">
                  <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3">
                    <Moon className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Wind down with a reflection</p>
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
            <Link href="/dashboard" className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-medium hover:bg-secondary/60 transition-colors">
              <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" /> Dashboard
            </Link>
            <Link href="/dashboard/habits" className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-medium hover:bg-secondary/60 transition-colors">
              <ListChecks className="h-3.5 w-3.5 text-muted-foreground" /> Habits
            </Link>
            <Link href="/dashboard/health" className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-medium hover:bg-secondary/60 transition-colors">
              <HeartPulse className="h-3.5 w-3.5 text-heart" /> Health
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
