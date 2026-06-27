"use client"

import { useCallback, useEffect, useState } from "react"
import { format, parseISO, subDays, addDays } from "date-fns"
import { ChevronLeft, ChevronRight, Moon, Footprints, Heart, Shield, Zap, RefreshCw, X, Plus, Camera } from "lucide-react"
import { capturePhoto } from "@/lib/native/camera"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────────

interface HealthLog {
  sleepDuration: number | null; deepSleep: number | null; remSleep: number | null
  lightSleep: number | null; awakeTime: number | null; timeInBed: number | null
  sleepEfficiency: number | null; steps: number | null; activeMinutes: number | null
  activityScore: number | null; caloriesBurned: number | null; distanceKm: number | null
  readinessScore: number | null; hrv: number | null; restingHR: number | null
  spo2: number | null; sleepScore: number | null; weight: number | null
  sleepStart: string | null; sleepEnd: string | null; stressHigh: number | null
  recoveryHigh: number | null; breathingRate: number | null; skinTemp: number | null
}
interface HabitItem { name: string; color: string; emoji: string | null; completed: boolean }
interface IntakeItem { type: string; amountMl: number; loggedAt: string; note: string | null }
interface FocusItem { label: string | null; durationMin: number; startedAt: string; endedAt: string; type: string }
interface TagItem { tagName: string | null; text: string | null; timestamp: string }
interface CustomEvent { id: string; emoji: string; label: string; note: string | null; imageData: string | null; occurredAt: string }
interface CheckInData { energy: number; mood: number; intention: string | null; waterGoalMl: number }
interface DayData {
  date: string
  healthLog: HealthLog | null
  mood: { mood: number; note: string | null } | null
  habits: HabitItem[]
  intake: IntakeItem[]
  focusSessions: FocusItem[]
  dailyNote: { content: string } | null
  checkin: CheckInData | null
  tags: TagItem[]
  customEvents: CustomEvent[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MOOD_LABEL: Record<number, string> = { 1:"😩 Awful", 2:"😕 Bad", 3:"😐 OK", 4:"🙂 Good", 5:"😄 Great" }
const MOOD_COLOR: Record<number, string> = { 1:"text-red-400", 2:"text-orange-400", 3:"text-yellow-400", 4:"text-green-400", 5:"text-emerald-400" }

const INTAKE_EMOJI: Record<string, string> = {
  water:"💧", coffee:"☕", tea:"🍵", alcohol:"🍺", other:"🥤",
}

function fmtSec(s: number | null): string {
  if (!s) return "—"
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtMin(m: number | null): string {
  if (m == null) return "—"
  return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`
}

function timeLabel(iso: string | null): string {
  if (!iso) return ""
  try { return format(parseISO(iso), "HH:mm") } catch { return "" }
}

/** Convert ISO timestamp → fractional hour (e.g. 08:30 → 8.5) */
function isoToHour(iso: string): number {
  try {
    const d = parseISO(iso)
    return d.getHours() + d.getMinutes() / 60
  } catch { return 0 }
}

/** Clamp a fractional hour to 0–24 range then scale to % */
function hourToPct(h: number, startH: number, totalH: number): number {
  return Math.max(0, Math.min(100, ((h - startH) / totalH) * 100))
}

// ── Day summary strip ──────────────────────────────────────────────────────────

function SummaryStrip({ log, mood }: { log: HealthLog | null; mood: { mood: number; note: string | null } | null }) {
  const chips = [
    log?.readinessScore != null && { icon: <Shield className="h-3 w-3" />, label: `${log.readinessScore}`, sub: "readiness", color: "text-blue-400" },
    log?.sleepDuration   != null && { icon: <Moon className="h-3 w-3" />,  label: fmtSec(log.sleepDuration), sub: "sleep", color: "text-primary" },
    log?.steps           != null && { icon: <Footprints className="h-3 w-3" />, label: log.steps.toLocaleString(), sub: "steps", color: "text-amber-400" },
    log?.hrv             != null && { icon: <Heart className="h-3 w-3" />,  label: `${Math.round(log.hrv)}ms`, sub: "HRV", color: "text-rose-400" },
    log?.activityScore   != null && { icon: <Zap className="h-3 w-3" />,   label: `${log.activityScore}`, sub: "activity", color: "text-green-400" },
    mood != null && { icon: <span className="text-xs">{MOOD_LABEL[mood.mood]?.slice(0,2)}</span>, label: MOOD_LABEL[mood.mood]?.slice(3) ?? "", sub: "mood", color: MOOD_COLOR[mood.mood] },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; sub: string; color: string }[]

  if (!chips.length) return <p className="text-sm text-muted-foreground text-center py-4">No data for this day</p>

  return (
    <div className="flex gap-3 flex-wrap">
      {chips.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5 bg-secondary/50 rounded-xl px-3 py-2 border border-border/40">
          <span className={c.color}>{c.icon}</span>
          <div>
            <p className={cn("text-sm font-bold leading-tight", c.color)}>{c.label}</p>
            <p className="text-[10px] text-muted-foreground/60">{c.sub}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Sleep block ────────────────────────────────────────────────────────────────

function SleepBlock({ log }: { log: HealthLog }) {
  if (!log.sleepDuration) return null
  const deep  = log.deepSleep  ?? 0
  const rem   = log.remSleep   ?? 0
  const light = log.lightSleep ?? 0
  const awake = log.awakeTime  ?? 0
  const total = deep + rem + light + awake || log.sleepDuration

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground/70">
          {timeLabel(log.sleepStart)} → {timeLabel(log.sleepEnd)}
        </span>
        {log.sleepScore != null && (
          <span className="text-primary font-medium">Score {log.sleepScore}</span>
        )}
      </div>
      {/* Stage bar */}
      {total > 0 && (
        <div className="h-3 rounded-full overflow-hidden flex">
          {deep  > 0 && <div title={`Deep ${fmtSec(deep)}`}   style={{ width: `${(deep/total)*100}%`  }} className="bg-indigo-600" />}
          {rem   > 0 && <div title={`REM ${fmtSec(rem)}`}    style={{ width: `${(rem/total)*100}%`   }} className="bg-violet-500" />}
          {light > 0 && <div title={`Light ${fmtSec(light)}`} style={{ width: `${(light/total)*100}%` }} className="bg-blue-400/60" />}
          {awake > 0 && <div title={`Awake ${fmtSec(awake)}`} style={{ width: `${(awake/total)*100}%` }} className="bg-secondary" />}
        </div>
      )}
      <div className="flex gap-3 text-[10px] flex-wrap">
        {deep  > 0 && <span className="text-indigo-400">■ Deep {fmtSec(deep)}</span>}
        {rem   > 0 && <span className="text-violet-400">■ REM {fmtSec(rem)}</span>}
        {light > 0 && <span className="text-blue-400">■ Light {fmtSec(light)}</span>}
        {awake > 0 && <span className="text-muted-foreground">■ Awake {fmtSec(awake)}</span>}
        {log.sleepEfficiency != null && <span className="text-muted-foreground/60 ml-auto">{log.sleepEfficiency}% efficiency</span>}
      </div>
    </div>
  )
}

// ── Timeline event dot ─────────────────────────────────────────────────────────

interface TLEvent {
  hour: number
  color: string
  emoji: string
  label: string
  sub?: string
  pill?: string
  eventId?: string  // present only for user-created custom events (deletable)
  imageUrl?: string // optional attached photo (custom events)
}

function EventRow({ ev, onDelete }: { ev: TLEvent; onDelete?: (id: string) => void }) {
  return (
    <div className="flex items-start gap-3 group">
      <div className="w-10 text-right text-[10px] text-muted-foreground/50 pt-0.5 shrink-0 tabular-nums">
        {String(Math.floor(ev.hour)).padStart(2,"0")}:{String(Math.round((ev.hour%1)*60)).padStart(2,"0")}
      </div>
      <div className="flex flex-col items-center shrink-0">
        <div className="w-2 h-2 rounded-full mt-1" style={{ background: ev.color }} />
        <div className="w-px flex-1 bg-border/30 mt-0.5" />
      </div>
      <div className="pb-3 min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm leading-none">{ev.emoji}</span>
          <span className="text-sm font-medium leading-snug">{ev.label}</span>
          {ev.pill && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary border border-border/40 text-muted-foreground">
              {ev.pill}
            </span>
          )}
          {ev.eventId && onDelete && (
            <button
              onClick={() => onDelete(ev.eventId!)}
              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-red-400 shrink-0"
              aria-label="Delete event"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {ev.sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{ev.sub}</p>}
        {ev.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ev.imageUrl}
            alt={ev.label}
            className="mt-1.5 rounded-lg border border-border/40 max-h-44 w-auto object-cover"
          />
        )}
      </div>
    </div>
  )
}

// ── Main timeline ──────────────────────────────────────────────────────────────

function Timeline({ data, onDelete }: { data: DayData; onDelete?: (id: string) => void }) {
  const events: TLEvent[] = []

  // Focus sessions
  for (const s of data.focusSessions) {
    if (s.type !== "focus") continue
    events.push({
      hour: isoToHour(s.startedAt),
      color: "var(--primary)",
      emoji: "🎯",
      label: s.label ?? "Focus session",
      pill: fmtMin(s.durationMin),
    })
  }

  // Intake
  for (const i of data.intake) {
    events.push({
      hour: isoToHour(i.loggedAt),
      color: i.type === "coffee" ? "#a16207" : i.type === "alcohol" ? "#7c3aed" : "#0ea5e9",
      emoji: INTAKE_EMOJI[i.type] ?? "🥤",
      label: i.type.charAt(0).toUpperCase() + i.type.slice(1),
      pill: `${i.amountMl}ml`,
      sub: i.note ?? undefined,
    })
  }

  // Oura tags
  for (const t of data.tags) {
    const name = t.tagName ?? t.text ?? "Tag"
    events.push({
      hour: isoToHour(t.timestamp),
      color: "#10b981",
      emoji: "🏷️",
      label: name,
    })
  }

  // Custom events (user-created, deletable)
  for (const c of data.customEvents ?? []) {
    events.push({
      hour: isoToHour(c.occurredAt),
      color: "#f59e0b",
      emoji: c.emoji,
      label: c.label,
      sub: c.note ?? undefined,
      eventId: c.id,
      imageUrl: c.imageData ?? undefined,
    })
  }

  events.sort((a, b) => a.hour - b.hour)

  if (!events.length && !data.healthLog?.sleepDuration) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No timed events recorded for this day.
      </p>
    )
  }

  return (
    <div className="relative pt-1">
      {/* Sleep block at top if it exists */}
      {data.healthLog?.sleepDuration && (
        <div className="mb-4 pl-13">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 shrink-0" />
            <div className="flex flex-col items-center shrink-0">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <div className="w-px h-2 bg-border/30 mt-0.5" />
            </div>
            <p className="text-xs font-semibold text-primary flex items-center gap-1">
              <Moon className="h-3 w-3" /> Sleep · {fmtSec(data.healthLog.sleepDuration)}
            </p>
          </div>
          <div className="ml-[52px] bg-primary/5 border border-primary/15 rounded-xl p-3">
            <SleepBlock log={data.healthLog} />
          </div>
          <div className="ml-[58px] w-px h-3 bg-border/30" />
        </div>
      )}

      {events.map((ev, i) => <EventRow key={ev.eventId ?? i} ev={ev} onDelete={onDelete} />)}

      {/* End cap */}
      <div className="flex items-start gap-3 opacity-30">
        <div className="w-10 text-right text-[10px] text-muted-foreground/50 pt-0.5 shrink-0" />
        <div className="w-2 h-2 rounded-full bg-border mt-0.5 shrink-0" />
      </div>
    </div>
  )
}

// ── Habits section ─────────────────────────────────────────────────────────────

function HabitsSection({ habits }: { habits: HabitItem[] }) {
  if (!habits.length) return null
  const done = habits.filter(h => h.completed)
  const pct  = Math.round((done.length / habits.length) * 100)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground/60">Habits</span>
        <span className="font-medium" style={{ color: pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444" }}>
          {done.length}/{habits.length} · {pct}%
        </span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60 transition-all"
          style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {habits.map((h, i) => (
          <span key={i} className={cn(
            "text-xs px-2.5 py-1 rounded-full border transition-all",
            h.completed
              ? "border-transparent text-white"
              : "border-border text-muted-foreground/60 line-through"
          )} style={h.completed ? { background: h.color } : {}}>
            {h.emoji && <span className="mr-1">{h.emoji}</span>}
            {h.name}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Additional stats ───────────────────────────────────────────────────────────

function StatGrid({ log }: { log: HealthLog }) {
  const rows = [
    log.weight        != null && ["Weight",        `${log.weight} kg`,                    "⚖️"],
    log.caloriesBurned!= null && ["Active cals",   `${log.caloriesBurned} kcal`,           "🔥"],
    log.distanceKm    != null && ["Distance",       `${log.distanceKm.toFixed(1)} km`,      "📍"],
    log.activeMinutes != null && ["Active",         fmtMin(log.activeMinutes),              "⚡"],
    log.restingHR     != null && ["Resting HR",     `${log.restingHR} bpm`,                "❤️"],
    log.spo2          != null && ["SpO₂",           `${log.spo2.toFixed(1)}%`,             "🫁"],
    log.breathingRate != null && ["Breath rate",    `${log.breathingRate.toFixed(1)}/min`,  "💨"],
    log.skinTemp      != null && ["Skin temp",      `${log.skinTemp > 0 ? "+" : ""}${log.skinTemp.toFixed(1)}°`,  "🌡️"],
    log.stressHigh    != null && ["Stress",         fmtSec(log.stressHigh * 60),           "😤"],
    log.recoveryHigh  != null && ["Recovery",       fmtSec(log.recoveryHigh * 60),         "🛡️"],
  ].filter(Boolean) as [string, string, string][]

  if (!rows.length) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {rows.map(([label, value, emoji]) => (
        <div key={label} className="bg-secondary/40 rounded-lg px-3 py-2 border border-border/30">
          <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
            <span>{emoji}</span>{label}
          </p>
          <p className="text-sm font-semibold tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const QUICK_EMOJI = ["📌", "🍺", "🍷", "🍔", "💊", "🏋️", "🚗", "💼", "😴", "🤕", "❤️", "🎉"]

export default function TimelinePage() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [data, setData] = useState<DayData | null>(null)
  const [loading, setLoading] = useState(true)

  // Quick-add custom event form
  const [adding, setAdding] = useState(false)
  const [evEmoji, setEvEmoji] = useState("📌")
  const [evLabel, setEvLabel] = useState("")
  const [evTime, setEvTime] = useState(format(new Date(), "HH:mm"))
  const [evPhoto, setEvPhoto] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (d = date) => {
    setLoading(true)
    setData(null)
    try {
      const res = await fetch(`/api/timeline?date=${d}`)
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  function go(delta: number) {
    const next = format(delta > 0 ? addDays(parseISO(date), 1) : subDays(parseISO(date), 1), "yyyy-MM-dd")
    setDate(next)
    load(next)
  }

  function openAdd() {
    setEvEmoji("📌")
    setEvLabel("")
    setEvTime(format(new Date(), "HH:mm"))
    setEvPhoto(null)
    setAdding(true)
  }

  async function takePhoto() {
    const photo = await capturePhoto()
    if (photo) setEvPhoto(photo)
  }

  async function addEvent() {
    const label = evLabel.trim()
    if (!label || saving) return
    setSaving(true)
    try {
      // Combine the viewed date with the chosen time (local) into an ISO timestamp
      const occurredAt = new Date(`${date}T${evTime || "12:00"}:00`).toISOString()
      await fetch("/api/timeline-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: evEmoji, label, occurredAt, imageData: evPhoto }),
      })
      setAdding(false)
      setEvLabel("")
      setEvPhoto(null)
      await load(date)
    } finally {
      setSaving(false)
    }
  }

  async function deleteEvent(id: string) {
    await fetch(`/api/timeline-events?id=${id}`, { method: "DELETE" })
    await load(date)
  }

  const isToday = date === format(new Date(), "yyyy-MM-dd")

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      {/* Date nav */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            📅 Day Timeline
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Everything that happened in one day</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => go(-1)}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-secondary/50 hover:bg-accent transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={format(new Date(), "yyyy-MM-dd")}
            onChange={e => { setDate(e.target.value); load(e.target.value) }}
            className="h-8 px-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button onClick={() => go(1)} disabled={isToday}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-secondary/50 hover:bg-accent transition-colors disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={() => load()} disabled={loading}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-secondary/50 hover:bg-accent transition-colors disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Date heading */}
      <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest">
        {loading ? "Loading…" : format(parseISO(date), "EEEE, MMMM d, yyyy")}
        {isToday && <span className="ml-2 text-primary normal-case tracking-normal font-normal">Today</span>}
      </p>

      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="flex gap-3 flex-wrap">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 w-24 rounded-xl bg-secondary/50 border border-border/40" />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 w-10 rounded bg-border shrink-0" />
                <div className="w-2 h-2 rounded-full bg-border shrink-0" />
                <div className="h-3 rounded bg-border flex-1" style={{ width: `${60 + i * 8}%`, maxWidth: "100%" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary chips */}
          <SummaryStrip log={data.healthLog} mood={data.mood} />

          {/* Habit row */}
          {data.habits.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <HabitsSection habits={data.habits} />
              </CardContent>
            </Card>
          )}

          {/* Morning check-in */}
          {data.checkin && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest mb-3">🌅 Morning Check-in</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Energy", value: `${["","😴","😪","😐","😊","⚡"][data.checkin.energy]} ${data.checkin.energy}/5` },
                    { label: "Mood", value: `${["","😞","😟","😐","🙂","😄"][data.checkin.mood]} ${data.checkin.mood}/5` },
                    { label: "Water Goal", value: data.checkin.waterGoalMl >= 1000 ? `${data.checkin.waterGoalMl / 1000}L` : `${data.checkin.waterGoalMl}ml` },
                    ...(data.checkin.intention ? [{ label: "Intention", value: data.checkin.intention }] : []),
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl bg-background/60 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-0.5">{label}</p>
                      <p className="text-sm font-medium truncate">{value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest">Timeline</p>
                {!adding && (
                  <button
                    onClick={openAdd}
                    className="flex items-center gap-1 text-xs text-primary/80 hover:text-primary transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add event
                  </button>
                )}
              </div>

              {adding && (
                <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_EMOJI.map(e => (
                      <button
                        key={e}
                        onClick={() => setEvEmoji(e)}
                        className={cn(
                          "h-8 w-8 rounded-lg text-base flex items-center justify-center transition-all",
                          evEmoji === e ? "bg-primary/20 ring-1 ring-primary/40 scale-105" : "bg-secondary/50 hover:bg-secondary"
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={evLabel}
                      onChange={e => setEvLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addEvent() }}
                      placeholder="What happened? e.g. Beers with mates"
                      maxLength={120}
                      className="flex-1 min-w-0 h-9 px-3 text-sm rounded-lg border border-border bg-background/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <input
                      type="time"
                      value={evTime}
                      onChange={e => setEvTime(e.target.value)}
                      className="h-9 px-2 text-sm rounded-lg border border-border bg-background/60 focus:outline-none focus:ring-1 focus:ring-primary/50 shrink-0"
                    />
                  </div>
                  {evPhoto ? (
                    <div className="relative inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={evPhoto} alt="attached" className="rounded-lg border border-border/40 max-h-32 w-auto" />
                      <button
                        onClick={() => setEvPhoto(null)}
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-red-400"
                        aria-label="Remove photo"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={takePhoto}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg px-3 py-2 transition-colors"
                    >
                      <Camera className="h-3.5 w-3.5" /> Add photo
                    </button>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setAdding(false)}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addEvent}
                      disabled={!evLabel.trim() || saving}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                    >
                      {saving ? "Adding…" : "Add to timeline"}
                    </button>
                  </div>
                </div>
              )}

              <Timeline data={data} onDelete={deleteEvent} />
            </CardContent>
          </Card>

          {/* Additional metrics */}
          {data.healthLog && (
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest">Stats</p>
                <StatGrid log={data.healthLog} />
              </CardContent>
            </Card>
          )}

          {/* Journal note */}
          {data.dailyNote?.content && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2">📝 Journal</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {data.dailyNote.content}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Mood note */}
          {data.mood?.note && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2">
                  {MOOD_LABEL[data.mood.mood]} · Mood note
                </p>
                <p className="text-sm text-muted-foreground">{data.mood.note}</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
