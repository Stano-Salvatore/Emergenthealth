import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { activeOn } from "@/lib/med-schedule"
import { isScheduledOn } from "@/lib/habit-schedule"
import { loadEventOccurrences } from "@/lib/app-events"
import { getUserTimezone } from "@/lib/user-timezone"
import { normalizeRepeat, occurrencesBetween } from "@/lib/recurrence"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The calendar showed meetings and nothing else, while the app knew when the
// user's doses were due, which habits they'd set a time for, what they'd
// already done and how they'd felt. A calendar of only other people's
// appointments is the one thing a general calendar app already does better.
//
// This returns the app's own day in the shape the calendar page already
// renders, so the two merge into one timeline. Everything here is derived —
// nothing is stored — which keeps it honest when a schedule changes.

type OverlayItem = {
  id: string
  title: string
  description: string | null
  location: string | null
  start: string
  end: string | null
  isAllDay: boolean
  url: string | null
  color: string
  source: "app"
  kind: "med" | "habit" | "reminder" | "workout" | "checkin" | "moment" | "focus" | "event"
  /** App-owned events only: what the detail panel needs to edit or delete. */
  eventId?: string
  occurrence?: string
  repeat?: string | null
  repeatUntil?: string | null
  alertMinutes?: number | null
  /** Reminders: the row id, so the panel can tick it. */
  reminderId?: string
}

const COLORS = {
  med: "#f472b6",
  habit: "#4ade80",
  reminder: "#fbbf24",
  workout: "#fb923c",
  checkin: "#a78bfa",
  moment: "#38bdf8",
  focus: "#22d3ee",
  event: "#818cf8",
}

/** Local-time ISO for a YYYY-MM-DD day at HH:MM, so it lands where the user sees it. */
function at(day: string, hhmm: string): string | null {
  const [h, m] = hhmm.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  const [y, mo, d] = day.split("-").map(Number)
  return new Date(y, mo - 1, d, h, m).toISOString()
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = []
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  // A month view is ~6 weeks; the cap stops a malformed range building a year.
  while (cur <= to && days.length < 70) {
    const pad = (n: number) => String(n).padStart(2, "0")
    days.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`)
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const fromRaw = req.nextUrl.searchParams.get("from")
  const toRaw = req.nextUrl.searchParams.get("to")
  const from = fromRaw ? new Date(fromRaw) : new Date()
  const to = toRaw ? new Date(toRaw) : new Date(Date.now() + 7 * 86400_000)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return NextResponse.json({ error: "bad range" }, { status: 400 })
  }

  const timezone = await getUserTimezone(userId)
  const [meds, habits, reminders, workouts, checkins, moments, focus, appEvents] = await Promise.all([
    prisma.medSchedule.findMany({ where: { userId, active: true, remind: true } }).catch(() => []),
    prisma.habit.findMany({
      where: { userId, isArchived: false, reminderTime: { not: null } },
      select: { id: true, name: true, reminderTime: true, scheduleDays: true, timesPerWeek: true },
    }).catch(() => [] as { id: string; name: string; reminderTime: string | null; scheduleDays: number[]; timesPerWeek: number | null }[]),
    // A repeating reminder sits on its next due date; its later occurrences
    // inside the window are drawn too, so a "weekly bins" reminder shows on
    // every Tuesday of the month rather than only the next one.
    prisma.reminder.findMany({
      where: { userId, isCompleted: false, OR: [{ dueDate: { gte: from, lte: to } }, { repeat: { not: null }, dueDate: { lte: to } }] },
      select: { id: true, title: true, description: true, dueDate: true, reminderTime: true, repeat: true, repeatUntil: true },
    }).catch(() => [] as { id: string; title: string; description: string | null; dueDate: Date | null; reminderTime: string | null; repeat: string | null; repeatUntil: Date | null }[]),
    prisma.stravaActivity.findMany({
      where: { userId, startDate: { gte: from, lte: to } },
      select: { id: true, name: true, type: true, distanceM: true, movingTimeSec: true, startDate: true },
    }).catch(() => [] as { id: string; name: string | null; type: string; distanceM: number | null; movingTimeSec: number; startDate: Date }[]),
    prisma.checkIn.findMany({
      where: { userId, checkedAt: { gte: from, lte: to } },
      select: { id: true, checkedAt: true, place: true, emoji: true },
    }).catch(() => [] as { id: string; checkedAt: Date; place: string; emoji: string }[]),
    prisma.timelineEvent.findMany({
      where: { userId, occurredAt: { gte: from, lte: to } },
      select: { id: true, emoji: true, label: true, note: true, occurredAt: true },
    }).catch(() => [] as { id: string; emoji: string; label: string; note: string | null; occurredAt: Date }[]),
    prisma.focusSession.findMany({
      where: { userId, startedAt: { gte: from, lte: to }, type: "focus" },
      select: { id: true, label: true, durationMin: true, startedAt: true },
    }).catch(() => [] as { id: string; label: string | null; durationMin: number; startedAt: Date }[]),
    loadEventOccurrences(userId, from, to, timezone).catch(() => []),
  ])

  const items: OverlayItem[] = []
  const days = eachDay(from, to)

  // Doses and habit reminders are schedules, not records: they exist on every
  // day the schedule covers, which is why they're expanded per day here rather
  // than read from a table.
  for (const day of days) {
    for (const med of meds) {
      if (!activeOn({
        id: med.id, name: med.name, times: med.times, daysOfWeek: med.daysOfWeek,
        active: med.active, startDate: med.startDate, endDate: med.endDate,
      }, day)) continue
      med.times.forEach((time, i) => {
        const start = at(day, time)
        if (!start) return
        items.push({
          id: `med-${med.id}-${day}-${i}`, title: `💊 ${med.name}`,
          description: med.dose ?? null, location: null, start, end: null,
          isAllDay: false, url: "/dashboard/medications", color: COLORS.med,
          source: "app", kind: "med",
        })
      })
    }
    for (const habit of habits) {
      if (!isScheduledOn({ scheduleDays: habit.scheduleDays, timesPerWeek: habit.timesPerWeek }, day)) continue
      const start = habit.reminderTime ? at(day, habit.reminderTime) : null
      if (!start) continue
      items.push({
        id: `habit-${habit.id}-${day}`, title: `✅ ${habit.name}`,
        description: null, location: null, start, end: null,
        isAllDay: false, url: "/dashboard/habits", color: COLORS.habit,
        source: "app", kind: "habit",
      })
    }
  }

  for (const r of reminders) {
    if (!r.dueDate) continue
    const dueDay = r.dueDate.toISOString().slice(0, 10)
    const repeat = normalizeRepeat(r.repeat)
    const reminderDays = repeat
      ? occurrencesBetween(dueDay, repeat, days[0] ?? dueDay, days[days.length - 1] ?? dueDay, { until: r.repeatUntil ? r.repeatUntil.toISOString().slice(0, 10) : null })
      : [dueDay]
    for (const day of reminderDays) {
      // Reminders store the date at UTC midnight and the time the user picked
      // separately — the same pairing the notification scheduler uses.
      const start = at(day, r.reminderTime || "09:00") ?? new Date(day + "T00:00:00Z").toISOString()
      items.push({
        id: `rem-${r.id}-${day}`, title: `🔔 ${r.title}`, description: r.description ?? null,
        location: null, start, end: null, isAllDay: !r.reminderTime,
        url: "/dashboard/reminders", color: COLORS.reminder, source: "app", kind: "reminder",
        reminderId: r.id, repeat: r.repeat ?? null,
      })
    }
  }

  // The app's own events, already expanded into occurrences.
  for (const e of appEvents) {
    items.push({
      id: `event-${e.id}`, title: e.title, description: e.description, location: e.location,
      start: e.start, end: e.end, isAllDay: e.isAllDay, url: null,
      color: e.color ?? COLORS.event, source: "app", kind: "event",
      eventId: e.eventId, occurrence: e.occurrence, repeat: e.repeat, repeatUntil: e.repeatUntil, alertMinutes: e.alertMinutes,
    })
  }

  for (const w of workouts) {
    const km = w.distanceM ? (w.distanceM / 1000).toFixed(1) : null
    items.push({
      id: `strava-${w.id}`, title: `🏃 ${w.name ?? w.type}`,
      description: [km ? `${km}km` : null, w.type].filter(Boolean).join(" · ") || null,
      location: null, start: w.startDate.toISOString(),
      end: w.movingTimeSec ? new Date(w.startDate.getTime() + w.movingTimeSec * 1000).toISOString() : null,
      isAllDay: false, url: "/dashboard/strava", color: COLORS.workout, source: "app", kind: "workout",
    })
  }

  for (const c of checkins) {
    items.push({
      id: `checkin-${c.id}`, title: `${c.emoji || "📍"} ${c.place}`,
      description: null, location: null, start: c.checkedAt.toISOString(), end: null,
      isAllDay: false, url: "/dashboard/location", color: COLORS.checkin, source: "app", kind: "checkin",
    })
  }

  for (const m of moments) {
    items.push({
      id: `moment-${m.id}`, title: `${m.emoji} ${m.label}`, description: m.note ?? null,
      location: null, start: m.occurredAt.toISOString(), end: null, isAllDay: false,
      url: "/dashboard/timeline", color: COLORS.moment, source: "app", kind: "moment",
    })
  }

  for (const f of focus) {
    items.push({
      id: `focus-${f.id}`, title: `🎯 ${f.label ?? "Focus"}`,
      description: `${f.durationMin}min`, location: null,
      start: f.startedAt.toISOString(),
      end: new Date(f.startedAt.getTime() + f.durationMin * 60_000).toISOString(),
      isAllDay: false, url: "/dashboard/focus", color: COLORS.focus, source: "app", kind: "focus",
    })
  }

  return NextResponse.json(items, { headers: { "Cache-Control": "no-store" } })
}
