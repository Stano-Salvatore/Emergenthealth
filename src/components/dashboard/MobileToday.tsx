"use client"

// Vora-style mobile "Today" view: four pillar rings, an ask-Emergy pill, and
// the day as one chronological timeline (sleep → check-in → calendar → habits
// → intake → reminders). Rendered mobile-only — desktop keeps the card grid.
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

interface Pillar { label: string; pts: number; max: number }

interface MobileTodayProps {
  pillars: Pillar[]
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

function hexOrNull(c: string | null | undefined): string | null {
  if (!c) return null
  const s = c.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`
  return null
}

function PillarRing({ label, pts, max }: Pillar) {
  const pct = max > 0 ? Math.min(1, pts / max) : 0
  const r = 15.5
  const circ = 2 * Math.PI * r
  const color = pct >= 0.8 ? "#34d399" : pct >= 0.5 ? "#a3e635" : pct >= 0.25 ? "#fbbf24" : "#f87171"
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className="relative h-11 w-11">
        <svg viewBox="0 0 38 38" className="h-11 w-11 -rotate-90">
          <circle cx="19" cy="19" r={r} fill="none" strokeWidth="4" className="stroke-secondary" />
          <circle
            cx="19" cy="19" r={r} fill="none" strokeWidth="4" strokeLinecap="round"
            stroke={color} strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums">
          {Math.round(pct * 100)}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
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

  return (
    <div className="lg:hidden space-y-3">
      {/* Four pillars */}
      <div className="rounded-2xl border border-border bg-card px-3 py-3 flex">
        {p.pillars.map(pl => <PillarRing key={pl.label} {...pl} />)}
      </div>

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

          {sleepH && (
            <TimelineRow dot="#818cf8">
              <p className="text-sm">
                🛏️ Slept <span className="font-semibold">{sleepH}h</span>
                {p.sleepScore != null && <span className="text-muted-foreground text-xs"> · score {p.sleepScore}</span>}
              </p>
            </TimelineRow>
          )}

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
