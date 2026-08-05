"use client"

// Vora-style mobile "Today" view: score gauge with four labeled pillars,
// sleep + heart chart cards, an ask-Emergy pill, and the day as one
// chronological timeline. Rendered mobile-only — desktop keeps the card grid.
// Client component so event times format in the user's local timezone.

import Link from "next/link"
import { format, parseISO } from "date-fns"

export interface TodayEventItem {
  id: string
  title: string
  start: string | null
  isAllDay: boolean
  color: string | null
  location?: string | null
}

export interface WeekDayStat {
  date: string
  sleepMin: number | null
  hrv: number | null
  restingHR: number | null
  steps: number | null
}

interface Pillar { label: string; pts: number; max: number }

interface MobileTodayProps {
  score: number
  calYear: number
  calMonth: number
  calToday: number
  monthDots: Record<string, (string | null)[]>
  nextEvents: TodayEventItem[]
  pillars: Pillar[]
  pillarValues: string[]
  week: WeekDayStat[]
  sleepMin: number | null
  sleepScore: number | null
  hasCheckedInToday: boolean
  checkinStreak: number
  events: TodayEventItem[]
  habitsDone: number
  habitsTotal: number
  habitsRemaining: string[]
  waterMl: number
  coffeeMl: number
  medTags: string[]
  focusMin: number
  remindersOverdue: number
  remindersDueToday: number
}

const PILLAR_COLORS = ["#818cf8", "#f472b6", "#34d399", "#fbbf24"]

function hexOrNull(c: string | null | undefined): string | null {
  if (!c) return null
  const s = c.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`
  return null
}

function scoreColor(s: number) {
  if (s >= 85) return "#34d399"
  if (s >= 70) return "#a3e635"
  if (s >= 50) return "#fbbf24"
  return "#f87171"
}

// 270° arc gauge, Vora-style: score centered, sweep starts bottom-left.
function ScoreGauge({ score }: { score: number }) {
  const r = 34
  const circ = 2 * Math.PI * r
  const arc = circ * 0.75
  const pct = Math.min(1, Math.max(0, score / 100))
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 84 84" className="h-24 w-24 rotate-[135deg]">
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
          className="stroke-secondary" strokeDasharray={`${arc} ${circ}`} />
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
          stroke={scoreColor(score)} strokeDasharray={`${arc * pct} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black tabular-nums leading-none">{score}</span>
        <span className="text-[8px] font-bold tracking-[0.2em] text-muted-foreground mt-0.5">TODAY</span>
      </div>
    </div>
  )
}

function PillarBar({ label, pts, max, value, color }: Pillar & { value: string; color: string }) {
  const pct = max > 0 ? Math.min(1, pts / max) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: color }} />
      </div>
      <span className="text-[11px] font-bold tabular-nums w-10 text-right shrink-0" style={{ color }}>{value}</span>
    </div>
  )
}

function Spark({ values, color }: { values: (number | null)[]; color: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => v != null) as [number, number][]
  if (pts.length < 2) return <div className="h-5" />
  const min = Math.min(...pts.map(p => p[1]))
  const max = Math.max(...pts.map(p => p[1]))
  const span = max - min || 1
  const n = values.length - 1 || 1
  const path = pts.map(([i, v]) => `${(i / n) * 60},${18 - ((v - min) / span) * 16}`).join(" ")
  return (
    <svg viewBox="0 0 60 20" className="h-5 w-full" preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MiniMonth({
  year, month, todayDate, dots,
}: { year: number; month: number; todayDate: number; dots: Record<string, (string | null)[]> }) {
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const mm = String(month + 1).padStart(2, "0")
  return (
    <div className="shrink-0 select-none">
      <div className="grid grid-cols-7">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} className={`w-7 text-center text-[9px] font-semibold pb-1 ${i === 6 ? "text-red-400/70" : "text-muted-foreground"}`}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="w-7 h-7" />
          const isCurrentDay = day === todayDate
          const isSunday = i % 7 === 6
          const colors = (dots[`${year}-${mm}-${String(day).padStart(2, "0")}`] ?? []).slice(0, 3)
          return (
            <div key={i} className="w-7 h-7 flex flex-col items-center justify-center relative">
              <span className={[
                "text-[11px] leading-none flex items-center justify-center",
                isCurrentDay ? "bg-foreground text-background rounded-full h-5 w-5 font-bold" : isSunday ? "text-red-400" : "text-foreground/80",
              ].join(" ")}>{day}</span>
              {colors.length > 0 && (
                <div className="absolute bottom-0 flex gap-[2px]">
                  {colors.map((c, j) => {
                    const hex = hexOrNull(c)
                    return (
                      <div key={j}
                        className={`h-[3px] w-[3px] rounded-full ${hex ? "" : isCurrentDay ? "bg-background" : "bg-primary"}`}
                        style={hex ? { backgroundColor: hex } : undefined}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimelineRow({
  dot, dim, children,
}: { dot?: string | null; dim?: boolean; children: React.ReactNode }) {
  const hex = hexOrNull(dot)
  return (
    <div className={`relative pl-6 pb-3 last:pb-0 ${dim ? "opacity-50" : ""}`}>
      <div
        className={`absolute left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${hex ? "" : "bg-primary/70"}`}
        style={hex ? { backgroundColor: hex } : undefined}
      />
      {children}
    </div>
  )
}

export function MobileToday(p: MobileTodayProps) {
  const now = new Date()
  const timed = p.events
    .filter(e => e.start && !e.isAllDay)
    .sort((a, b) => (a.start! < b.start! ? -1 : 1))
  const allDay = p.events.filter(e => e.isAllDay)
  const sleepH = p.sleepMin != null ? (p.sleepMin / 60).toFixed(1) : null
  const latest = p.week[p.week.length - 1]

  return (
    // sm:hidden matches DashboardGrid's isMobile boundary (<640px) so no
    // viewport ever renders both this view and the grid's copies of it.
    <div className="sm:hidden space-y-3">
      {/* Score gauge + pillar bars */}
      <div className="rounded-2xl border border-border bg-card px-4 py-4 flex items-center gap-4">
        <ScoreGauge score={p.score} />
        <div className="flex-1 min-w-0 space-y-2">
          {p.pillars.map((pl, i) => (
            <PillarBar key={pl.label} {...pl} value={p.pillarValues[i] ?? ""} color={PILLAR_COLORS[i % PILLAR_COLORS.length]} />
          ))}
        </div>
      </div>

      {/* Sleep + Heart chart cards */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/dashboard/health" className="rounded-2xl border border-border bg-card px-3.5 py-3 block">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">🌙 Sleep</p>
          <p className="text-xl font-black leading-none">
            {sleepH ?? "–"}<span className="text-xs font-semibold text-muted-foreground"> h</span>
            {p.sleepScore != null && <span className="text-[10px] font-semibold text-muted-foreground"> · score {p.sleepScore}</span>}
          </p>
          <div className="flex items-end gap-0.5 h-7 mt-2">
            {p.week.map(d => {
              const hrs = d.sleepMin != null ? d.sleepMin / 60 : 0
              return (
                <div key={d.date}
                  className={`flex-1 rounded-sm ${hrs >= 7 ? "bg-indigo-400" : "bg-indigo-400/35"}`}
                  style={{ height: `${Math.max(8, Math.min(100, (hrs / 10) * 100))}%` }}
                />
              )
            })}
          </div>
        </Link>
        <Link href="/dashboard/health" className="rounded-2xl border border-border bg-card px-3.5 py-3 block">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">❤️ Heart</p>
          <div className="space-y-1.5">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] text-muted-foreground">HRV</span>
                <span className="text-sm font-bold tabular-nums">{latest?.hrv != null ? `${Math.round(latest.hrv)}` : "–"}<span className="text-[9px] text-muted-foreground"> ms</span></span>
              </div>
              <Spark values={p.week.map(d => d.hrv)} color="#f472b6" />
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] text-muted-foreground">RHR</span>
                <span className="text-sm font-bold tabular-nums">{latest?.restingHR ?? "–"}<span className="text-[9px] text-muted-foreground"> bpm</span></span>
              </div>
              <Spark values={p.week.map(d => d.restingHR)} color="#818cf8" />
            </div>
          </div>
        </Link>
      </div>

      {/* Calendar — mini month with per-event colours + what's next */}
      <Link href="/dashboard/calendar" className="rounded-2xl border border-border bg-card px-4 py-3.5 flex gap-4 block">
        <MiniMonth year={p.calYear} month={p.calMonth} todayDate={p.calToday} dots={p.monthDots} />
        <div className="flex-1 min-w-0 border-l border-border pl-3.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Up next</p>
          {p.nextEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing coming up 🌿</p>
          ) : (
            <div className="space-y-1.5">
              {p.nextEvents.slice(0, 4).map(e => {
                const hex = hexOrNull(e.color)
                const d = e.start ? parseISO(e.isAllDay ? e.start.slice(0, 10) + "T12:00:00" : e.start) : null
                return (
                  <div key={e.id} className="flex gap-1.5 items-start">
                    <div
                      className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${hex ? "" : "bg-primary"}`}
                      style={hex ? { backgroundColor: hex } : undefined}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">{e.title}</p>
                      {d && (
                        <p className="text-[10px] text-muted-foreground">
                          {format(d, "EEE d MMM")}{!e.isAllDay ? ` · ${format(d, "HH:mm")}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Link>

      {/* Ask Emergy */}
      <Link
        href="/dashboard/chat"
        className="flex items-center gap-2.5 rounded-2xl border border-green-900/40 bg-[#14210f] px-4 py-3 hover:bg-[#1a2a14] transition-colors"
      >
        <span className="text-lg leading-none">🌱</span>
        <span className="text-sm text-muted-foreground flex-1">Ask Emergy anything…</span>
        <span className="text-green-400 text-xs font-semibold">Chat →</span>
      </Link>

      {/* Day timeline */}
      <div className="rounded-2xl border border-border bg-card px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Your day
        </p>
        <div className="relative">
          <div className="absolute left-[9.5px] top-1.5 bottom-1.5 w-px bg-border" />

          <TimelineRow dot={p.hasCheckedInToday ? "#34d399" : null} dim={false}>
            {p.hasCheckedInToday ? (
              <p className="text-sm">🌅 Checked in{p.checkinStreak > 1 ? <span className="text-muted-foreground text-xs"> · 🔥 {p.checkinStreak} days</span> : null}</p>
            ) : (
              <Link href="/dashboard/checkin" className="text-sm text-primary font-medium">
                🌅 Morning check-in →
              </Link>
            )}
          </TimelineRow>

          {allDay.map(e => (
            <TimelineRow key={e.id} dot={e.color}>
              <p className="text-sm">{e.title} <span className="text-muted-foreground text-xs">all day</span></p>
            </TimelineRow>
          ))}

          {timed.map(e => {
            const start = parseISO(e.start!)
            return (
              <TimelineRow key={e.id} dot={e.color} dim={start < now}>
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">{format(start, "HH:mm")}</span>{" "}
                  {e.title}
                </p>
                {e.location && <p className="text-[11px] text-muted-foreground truncate">📍 {e.location}</p>}
              </TimelineRow>
            )
          })}

          {(p.remindersOverdue > 0 || p.remindersDueToday > 0) && (
            <TimelineRow dot={p.remindersOverdue > 0 ? "#f87171" : null}>
              <Link href="/dashboard/reminders" className="text-sm">
                🔔 {p.remindersOverdue > 0 ? <span className="text-red-400 font-medium">{p.remindersOverdue} overdue</span> : null}
                {p.remindersOverdue > 0 && p.remindersDueToday > 0 ? " · " : null}
                {p.remindersDueToday > 0 ? `${p.remindersDueToday} due today` : null}
              </Link>
            </TimelineRow>
          )}

          <TimelineRow dot={p.habitsTotal > 0 && p.habitsDone === p.habitsTotal ? "#34d399" : null}>
            <Link href="/dashboard/habits" className="text-sm">
              ✅ Habits <span className="font-semibold">{p.habitsDone}/{p.habitsTotal}</span>
              {p.habitsRemaining.length > 0 && (
                <span className="text-muted-foreground text-xs"> · next: {p.habitsRemaining.slice(0, 2).join(", ")}{p.habitsRemaining.length > 2 ? "…" : ""}</span>
              )}
            </Link>
          </TimelineRow>

          <TimelineRow>
            <Link href="/dashboard/intake" className="text-sm">
              💧 <span className="font-semibold">{p.waterMl >= 1000 ? `${(p.waterMl / 1000).toFixed(1)}L` : `${p.waterMl}ml`}</span>
              {p.coffeeMl > 0 && <> · ☕ <span className="font-semibold">{p.coffeeMl}ml</span></>}
            </Link>
          </TimelineRow>

          {p.medTags.length > 0 && (
            <TimelineRow dot="#34d399">
              <p className="text-sm">💊 {p.medTags.slice(0, 3).join(", ")}{p.medTags.length > 3 ? ` +${p.medTags.length - 3}` : ""}</p>
            </TimelineRow>
          )}

          {p.focusMin > 0 && (
            <TimelineRow>
              <p className="text-sm">🎯 <span className="font-semibold">{p.focusMin >= 60 ? `${(p.focusMin / 60).toFixed(1)}h` : `${p.focusMin}m`}</span> deep work</p>
            </TimelineRow>
          )}
        </div>
      </div>
    </div>
  )
}
