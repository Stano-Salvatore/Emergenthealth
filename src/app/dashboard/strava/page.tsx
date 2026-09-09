"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import type { StravaActivityRow, WeeklyStats } from "@/app/api/strava/activities/route"
import type { TrainingLoad, ReadinessSuggestion } from "@/lib/training-load"

// ── helpers ────────────────────────────────────────────────────────────────────

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

interface LoadData {
  today: string
  load: TrainingLoad
  readiness: number | null
  suggestion: ReadinessSuggestion
  types: { value: string; label: string }[]
}

export default function StravaPage() {
  const [data, setData] = useState<ApiData | null>(null)
  const [loadData, setLoadData] = useState<LoadData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([
        fetch("/api/strava/activities").then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ApiData> }),
        fetch("/api/workouts").then(r => r.ok ? r.json() as Promise<LoadData> : null).catch(() => null),
      ])
      setData(a)
      setLoadData(l)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  async function removeSession(id: string) {
    if (!confirm("Delete this session?")) return
    await fetch(`/api/workouts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)
    void reload()
  }

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
      <PageHeader connected={connected} />

      {/* ── log a session + today's read ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <LogSessionCard types={loadData?.types ?? DEFAULT_TYPES} onLogged={reload} />
        </div>
        <div className="lg:col-span-2">
          <LoadCard data={loadData} />
        </div>
      </div>

      {/* ── connect Strava, as an offer rather than a wall ── */}
      {!connected && (
        <Card className="rounded-2xl border-dashed border-border bg-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl">🚴</span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Runs and rides can come in on their own</p>
                <p className="text-xs text-muted-foreground">Connect Strava and synced activities join the sessions you log here.</p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href="/api/strava/auth">Connect Strava</a>
            </Button>
          </CardContent>
        </Card>
      )}

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
      {chartWeeks.length > 0 && chartWeeks.some(w => w.distanceKm > 0) && (
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
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nothing yet. Log a session above and it lands here.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {activities.map(activity => (
                <ActivityRow key={activity.id} activity={activity} onDelete={activity.source === "manual" ? () => removeSession(activity.id) : undefined} />
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
          <span>🏃</span> Training
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Sessions you log, sessions Strava sends, and what your body says about today
        </p>
      </div>
      {/* When disconnected the offer card below carries the Connect CTA, so
          the header doesn't repeat it. Only the connected state needs its own
          (Reconnect) action here. */}
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

function ActivityRow({ activity, onDelete }: { activity: StravaActivityRow; onDelete?: () => void }) {
  const emoji = activityEmoji(activity.type)
  const distKm = activity.distanceM != null && activity.distanceM > 0 ? (activity.distanceM / 1000).toFixed(2) + " km" : null
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
        <p className="text-sm font-medium truncate">
          {activity.name ?? activity.type}
          {activity.rpe != null && (
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">effort {activity.rpe}/10</span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {date}{activity.note ? ` · ${activity.note}` : ""}
        </p>
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
            <p className="font-semibold tabular-nums text-heart">{activity.avgHR} bpm</p>
            <p className="text-[10px] text-muted-foreground">avg HR</p>
          </div>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-muted-foreground/40 hover:text-status-off transition-colors p-1 -m-1"
            title="Delete session"
            aria-label="Delete session"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── logging ───────────────────────────────────────────────────────────────────

const DEFAULT_TYPES = [
  { value: "WeightTraining", label: "Strength" },
  { value: "Run", label: "Run" },
  { value: "Ride", label: "Cycling" },
  { value: "Walk", label: "Walk" },
  { value: "Swim", label: "Swim" },
  { value: "Yoga", label: "Yoga / mobility" },
  { value: "Hike", label: "Hike" },
  { value: "Workout", label: "Other" },
]

const MINUTE_PRESETS = [20, 30, 45, 60, 90]

/** Local "YYYY-MM-DDTHH:MM" for a datetime-local input. */
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function LogSessionCard({ types, onLogged }: { types: { value: string; label: string }[]; onLogged: () => void }) {
  const [type, setType] = useState("WeightTraining")
  const [minutes, setMinutes] = useState(45)
  const [rpe, setRpe] = useState<number | null>(null)
  const [note, setNote] = useState("")
  const [when, setWhen] = useState<"now" | "earlier">("now")
  const [startedAt, setStartedAt] = useState(() => localInputValue(new Date(Date.now() - 60 * 60_000)))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const showDistance = type === "Run" || type === "Ride" || type === "Walk" || type === "Hike" || type === "Swim"
  const [distanceKm, setDistanceKm] = useState("")

  async function submit() {
    setSaving(true)
    setMessage(null)
    const body: Record<string, unknown> = { type, minutes, rpe, note: note || undefined }
    if (when === "earlier") body.startedAt = startedAt
    if (showDistance && distanceKm) body.distanceKm = distanceKm
    const res = await fetch("/api/workouts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null)
    setSaving(false)
    if (!res || !res.ok) {
      const err = await res?.json().catch(() => null) as { error?: string } | null
      setMessage(err?.error ?? "Could not save the session.")
      return
    }
    setMessage("Logged.")
    setNote("")
    setRpe(null)
    setDistanceKm("")
    onLogged()
    setTimeout(() => setMessage(null), 2500)
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? "border-move bg-move/15 text-move" : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
    }`

  return (
    <Card className="rounded-2xl border-border bg-card h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Log a session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {types.map(t => (
            <button key={t.value} type="button" onClick={() => setType(t.value)} className={chip(type === t.value)}>
              <span className="mr-1">{activityEmoji(t.value)}</span>{t.label}
            </button>
          ))}
        </div>

        <div>
          <p className="text-[11px] text-muted-foreground mb-1.5">Duration</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {MINUTE_PRESETS.map(m => (
              <button key={m} type="button" onClick={() => setMinutes(m)} className={chip(minutes === m)}>{m} min</button>
            ))}
            <input
              type="number" min={1} max={1440} value={minutes}
              onChange={e => setMinutes(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))}
              className="w-20 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs tabular-nums"
              aria-label="Minutes"
            />
          </div>
        </div>

        <div>
          <p className="text-[11px] text-muted-foreground mb-1.5">
            Effort <span className="text-muted-foreground/60">· 1 easy, 10 all-out</span>
          </p>
          <div className="grid grid-cols-10 gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button
                key={n} type="button" onClick={() => setRpe(rpe === n ? null : n)}
                className={`rounded-lg border py-1.5 text-xs font-medium tabular-nums transition-colors ${
                  rpe === n
                    ? n >= 8 ? "border-status-off/60 bg-status-off/15 text-status-off" : n >= 5 ? "border-status-watch/60 bg-status-watch/15 text-status-watch" : "border-status-on/60 bg-status-on/15 text-status-on"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {showDistance && (
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-muted-foreground">Distance</p>
            <input
              type="number" min={0} step={0.1} value={distanceKm} placeholder="km"
              onChange={e => setDistanceKm(e.target.value)}
              className="w-24 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs tabular-nums"
              aria-label="Distance in km"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setWhen("now")} className={chip(when === "now")}>Just finished</button>
          <button type="button" onClick={() => setWhen("earlier")} className={chip(when === "earlier")}>Earlier</button>
          {when === "earlier" && (
            <input
              type="datetime-local" value={startedAt} max={localInputValue(new Date())}
              onChange={e => setStartedAt(e.target.value)}
              className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs"
              aria-label="Started at"
            />
          )}
        </div>

        <input
          value={note} onChange={e => setNote(e.target.value)} maxLength={500}
          placeholder="Note — what you did, how it felt (optional)"
          className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground min-h-[1rem]">{message}</p>
          <Button onClick={submit} disabled={saving} size="sm">{saving ? "Saving…" : "Save session"}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

const TREND_LABEL: Record<TrainingLoad["trend"], string> = {
  resting: "Resting", easing: "Easing off", steady: "Steady", building: "Building", spiking: "Spiking",
}
const TREND_TONE: Record<TrainingLoad["trend"], string> = {
  resting: "text-muted-foreground", easing: "text-fuel", steady: "text-status-on", building: "text-status-watch", spiking: "text-status-off",
}
const SUGGESTION_LABEL: Record<ReadinessSuggestion["suggestion"], string> = {
  hard: "Go hard", moderate: "Normal session", easy: "Keep it easy", rest: "Rest day",
}
const SUGGESTION_TONE: Record<ReadinessSuggestion["suggestion"], string> = {
  hard: "border-status-on/50 bg-status-on/10 text-status-on", moderate: "border-move/50 bg-move/10 text-move",
  easy: "border-status-watch/50 bg-status-watch/10 text-status-watch", rest: "border-status-off/50 bg-status-off/10 text-status-off",
}

function LoadCard({ data }: { data: LoadData | null }) {
  if (!data) {
    return (
      <Card className="rounded-2xl border-border bg-card h-full">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Today</CardTitle></CardHeader>
        <CardContent><div className="h-16 rounded bg-muted/50 animate-pulse" /></CardContent>
      </Card>
    )
  }
  const { load, suggestion, readiness } = data
  return (
    <Card className="rounded-2xl border-border bg-card h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
          <span>Today</span>
          {readiness != null && (
            <span className="text-[11px] font-normal text-muted-foreground">readiness <span className="font-display text-sleep text-sm">{readiness}</span></span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${SUGGESTION_TONE[suggestion.suggestion]}`}>
            {SUGGESTION_LABEL[suggestion.suggestion]}
          </span>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{suggestion.reason}</p>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">Training load</p>
            <p className={`text-xs font-semibold ${TREND_TONE[load.trend]}`}>{TREND_LABEL[load.trend]}</p>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="font-display text-lg leading-none text-move">{load.sessions7d}</p>
              <p className="text-[10px] text-muted-foreground mt-1">sessions · 7d</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none text-move">{load.minutes7d}</p>
              <p className="text-[10px] text-muted-foreground mt-1">min · 7d</p>
            </div>
            <div>
              <p className="font-display text-lg leading-none text-move">{load.ratio != null ? load.ratio.toFixed(2) : "—"}</p>
              <p className="text-[10px] text-muted-foreground mt-1">vs 4-wk avg</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{load.summary}</p>
        </div>
      </CardContent>
    </Card>
  )
}
