"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { StravaActivityRow, WeeklyStats } from "@/app/api/strava/activities/route"

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtDistance(m: number | null): string {
  if (m == null) return "—"
  return (m / 1000).toFixed(2) + " km"
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtDate(date: Date | string): string {
  const d = new Date(date)
  return d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" })
}

function activityEmoji(type: string): string {
  switch (type) {
    case "Run":           return "🏃"
    case "Ride":          return "🚴"
    case "Swim":          return "🏊"
    case "WeightTraining":return "🧗"
    case "Walk":          return "🚶"
    case "Yoga":          return "🧘"
    case "Hike":          return "🥾"
    case "Rowing":        return "🚣"
    case "Skiing":        return "⛷️"
    case "Soccer":        return "⚽"
    case "Tennis":        return "🎾"
    case "Workout":       return "💪"
    default:              return "💪"
  }
}

// ── page ──────────────────────────────────────────────────────────────────────

interface ApiData {
  connected: boolean
  activities: StravaActivityRow[]
  weeklyStats: WeeklyStats[]
}

export default function StravaPage() {
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/strava/activities")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // ── loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader connected={null} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="rounded-2xl border-border bg-card">
              <CardContent className="pt-5 pb-4">
                <div className="h-4 w-16 bg-muted rounded animate-pulse mb-2" />
                <div className="h-7 w-20 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // ── error ──
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader connected={null} />
        <Card className="rounded-2xl border-border bg-card">
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            Failed to load activities: {error}
          </CardContent>
        </Card>
      </div>
    )
  }

  const { connected, activities, weeklyStats } = data!

  // ── not connected ──
  if (!connected) {
    return (
      <div className="space-y-6">
        <PageHeader connected={false} />
        <Card className="rounded-2xl border-dashed border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-20 gap-5 text-center">
            <span className="text-5xl">🚴</span>
            <div>
              <p className="font-semibold text-lg">No Strava connection</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                Connect your Strava account to see your workouts, weekly distance, and heart rate data.
              </p>
            </div>
            <Button asChild>
              <a href="/api/strava/auth">Connect Strava</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── summary stats ──
  const totalActivities = activities.length
  const totalDistanceKm = activities.reduce((s, a) => s + (a.distanceM ?? 0) / 1000, 0)
  const totalHours = activities.reduce((s, a) => s + a.movingTimeSec, 0) / 3600
  const hrActivities = activities.filter(a => a.avgHR != null)
  const avgHR = hrActivities.length
    ? Math.round(hrActivities.reduce((s, a) => s + a.avgHR!, 0) / hrActivities.length)
    : null

  // ── activity type breakdown ──
  const typeCounts: Record<string, number> = {}
  for (const a of activities) {
    typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1
  }
  const typeEntries = Object.entries(typeCounts).sort(([, a], [, b]) => b - a)

  // ── weekly chart — last 8 weeks ──
  const chartWeeks = weeklyStats.slice(-8)
  const maxKm = Math.max(...chartWeeks.map(w => w.distanceKm), 1)

  return (
    <div className="space-y-6">
      <PageHeader connected={true} />

      {/* ── summary stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total activities" value={String(totalActivities)} emoji="📊" />
        <StatCard label="Total distance" value={`${totalDistanceKm.toFixed(1)} km`} emoji="📍" />
        <StatCard label="Total time" value={`${totalHours.toFixed(1)}h`} emoji="⏱️" />
        <StatCard label="Avg heart rate" value={avgHR != null ? `${avgHR} bpm` : "—"} emoji="❤️" />
      </div>

      {/* ── activity type breakdown ── */}
      {typeEntries.length > 0 && (
        <Card className="rounded-2xl border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Activity types</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {typeEntries.map(([type, count]) => (
              <div
                key={type}
                className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2"
              >
                <span className="text-lg leading-none">{activityEmoji(type)}</span>
                <div>
                  <p className="text-sm font-semibold">{count}</p>
                  <p className="text-[10px] text-muted-foreground leading-none mt-0.5">{type}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── weekly km bar chart ── */}
      {chartWeeks.length > 0 && (
        <Card className="rounded-2xl border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Weekly distance — last 8 weeks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1.5 h-28">
              {chartWeeks.map((w, i) => {
                const pct = maxKm > 0 ? (w.distanceKm / maxKm) * 100 : 0
                const hasActivity = w.distanceKm > 0
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    {/* bar */}
                    <div className="w-full flex items-end" style={{ height: "88px" }}>
                      <div
                        className={[
                          "w-full rounded-t-md transition-all",
                          hasActivity
                            ? "bg-orange-500/80 hover:bg-orange-500"
                            : "bg-muted/40",
                        ].join(" ")}
                        style={{ height: `${Math.max(pct, hasActivity ? 4 : 2)}%` }}
                        title={`${w.week}: ${w.distanceKm} km, ${w.count} activities, ${w.durationMin} min`}
                      />
                    </div>
                    {/* label */}
                    <p className="text-[9px] text-muted-foreground truncate w-full text-center leading-none">
                      {w.week}
                    </p>
                    {/* km */}
                    <p className={`text-[10px] font-medium ${hasActivity ? "text-foreground" : "text-muted-foreground/40"} leading-none`}>
                      {hasActivity ? `${w.distanceKm}` : "—"}
                    </p>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-right">km per week</p>
          </CardContent>
        </Card>
      )}

      {/* ── activities list ── */}
      <Card className="rounded-2xl border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Recent activities
            <span className="text-muted-foreground font-normal ml-1.5">({activities.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activities.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No activities found</div>
          ) : (
            <div className="divide-y divide-border">
              {activities.map(activity => (
                <ActivityRow key={activity.id} activity={activity} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── sub-components ─────────────────────────────────────────────────────────────

function PageHeader({ connected }: { connected: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span>🚴</span> Strava Activities
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Your workout history and training trends
        </p>
      </div>
      {connected === false && (
        <Button asChild size="sm" className="shrink-0">
          <a href="/api/strava/auth">Connect Strava</a>
        </Button>
      )}
      {connected === true && (
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <a href="/api/strava/auth">Reconnect</a>
        </Button>
      )}
    </div>
  )
}

function StatCard({ label, value, emoji }: { label: string; value: string; emoji: string }) {
  return (
    <Card className="rounded-2xl border-border bg-card">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <span>{emoji}</span>
          <span>{label}</span>
        </div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

function ActivityRow({ activity }: { activity: StravaActivityRow }) {
  const emoji = activityEmoji(activity.type)
  const distKm = activity.distanceM != null ? (activity.distanceM / 1000).toFixed(2) + " km" : null
  const duration = fmtDuration(activity.movingTimeSec)
  const date = fmtDate(activity.startDate)

  return (
    <div className="flex items-center gap-3 px-5 py-3 min-w-0 hover:bg-muted/20 transition-colors">
      {/* emoji + type */}
      <div className="flex flex-col items-center gap-0.5 shrink-0 w-9">
        <span className="text-xl leading-none">{emoji}</span>
        <span className="text-[9px] text-muted-foreground/60 leading-none">{activity.type}</span>
      </div>

      {/* name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{activity.name ?? activity.type}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{date}</p>
      </div>

      {/* stats */}
      <div className="flex items-center gap-4 shrink-0 text-sm">
        {distKm && (
          <div className="text-right hidden sm:block">
            <p className="font-semibold tabular-nums">{distKm}</p>
            <p className="text-[10px] text-muted-foreground">distance</p>
          </div>
        )}
        <div className="text-right">
          <p className="font-semibold tabular-nums">{duration}</p>
          <p className="text-[10px] text-muted-foreground">duration</p>
        </div>
        {activity.avgHR != null && (
          <div className="text-right hidden md:block">
            <p className="font-semibold tabular-nums text-red-400">{activity.avgHR} bpm</p>
            <p className="text-[10px] text-muted-foreground">avg HR</p>
          </div>
        )}
      </div>
    </div>
  )
}
