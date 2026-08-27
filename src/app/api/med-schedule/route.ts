import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { localDateStr, localTimeStr, addDaysISO } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import {
  activeOn, adherenceOver, dosesForDay, matchKey, minutesOfDay, sortedTimes,
  type ScheduleLike,
} from "@/lib/med-schedule"

export const dynamic = "force-dynamic"

/** Complete days used for the adherence figure — today is still in progress. */
const ADHERENCE_DAYS = 14

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/

function normalizeTimes(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const t of input) {
    if (typeof t !== "string") continue
    const trimmed = t.trim()
    if (!TIME_RE.test(trimmed)) continue
    // "8:00" and "08:00" are the same dose, not two.
    const [h, m] = trimmed.split(":")
    seen.add(`${h.padStart(2, "0")}:${m}`)
  }
  return [...seen].sort((a, b) => minutesOfDay(a) - minutesOfDay(b)).slice(0, 6)
}

function normalizeDays(input: unknown): number[] {
  if (!Array.isArray(input)) return []
  const set = new Set<number>()
  for (const d of input) {
    const n = Number(d)
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n)
  }
  // Every day is expressed as "no restriction", so the two can't disagree.
  return set.size === 7 ? [] : [...set].sort()
}

function asDateStr(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const tz = await getUserTimezone(userId)
  const today = localDateStr(tz)
  const nowMinutes = minutesOfDay(localTimeStr(tz))
  const windowStart = addDaysISO(today, -ADHERENCE_DAYS)

  const schedules = await prisma.medSchedule.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  })

  // Every dose logged in the window, from the one table doses live in —
  // ring tags and manual taps alike.
  const doseRows = await prisma.$queryRaw<{ day: string; tagName: string | null; text: string | null }[]>`
    SELECT "day", "tagName", "text" FROM "OuraTag"
    WHERE "userId" = ${userId} AND "day" >= ${windowStart}
  `.catch(() => [] as { day: string; tagName: string | null; text: string | null }[])

  const doses = doseRows
    .map(r => ({ day: r.day, name: (r.tagName ?? r.text ?? "").trim() }))
    .filter(d => d.name.length > 0)

  const days: string[] = []
  for (let i = ADHERENCE_DAYS; i >= 1; i--) days.push(addDaysISO(today, -i))

  const shaped: ScheduleLike[] = schedules.map(s => ({
    id: s.id, name: s.name, times: s.times, daysOfWeek: s.daysOfWeek,
    active: s.active, startDate: s.startDate, endDate: s.endDate,
  }))

  const adherence = new Map(adherenceOver(shaped, doses, days).map(a => [a.scheduleId, a]))

  const takenTodayByKey = new Map<string, number>()
  for (const d of doses) {
    if (d.day !== today) continue
    const k = matchKey(d.name)
    takenTodayByKey.set(k, (takenTodayByKey.get(k) ?? 0) + 1)
  }

  const items = schedules.map(s => {
    const shape = shaped.find(x => x.id === s.id)!
    const runsToday = activeOn(shape, today)
    const takenToday = takenTodayByKey.get(matchKey(s.name)) ?? 0
    return {
      id: s.id,
      name: s.name,
      dose: s.dose,
      times: sortedTimes(shape),
      daysOfWeek: s.daysOfWeek,
      active: s.active,
      remind: s.remind,
      note: s.note,
      startDate: s.startDate,
      endDate: s.endDate,
      runsToday,
      today: runsToday ? dosesForDay(shape, takenToday, nowMinutes) : [],
      adherence: adherence.get(s.id) ?? null,
    }
  })

  return NextResponse.json({ items, today, windowDays: ADHERENCE_DAYS })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : ""
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 })

  const times = normalizeTimes(body?.times)
  if (times.length === 0) return NextResponse.json({ error: "at least one valid time required" }, { status: 400 })

  const created = await prisma.medSchedule.create({
    data: {
      userId: session.user.id,
      name,
      dose: typeof body?.dose === "string" && body.dose.trim() ? body.dose.trim().slice(0, 40) : null,
      times,
      daysOfWeek: normalizeDays(body?.daysOfWeek),
      remind: body?.remind !== false,
      note: typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null,
      startDate: asDateStr(body?.startDate),
      endDate: asDateStr(body?.endDate),
    },
  })

  return NextResponse.json({ ok: true, id: created.id })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const id = typeof body?.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const existing = await prisma.medSchedule.findFirst({ where: { id, userId: session.user.id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 60)
  if (body?.dose !== undefined) data.dose = typeof body.dose === "string" && body.dose.trim() ? body.dose.trim().slice(0, 40) : null
  if (body?.times !== undefined) {
    const times = normalizeTimes(body.times)
    if (times.length === 0) return NextResponse.json({ error: "at least one valid time required" }, { status: 400 })
    data.times = times
  }
  if (body?.daysOfWeek !== undefined) data.daysOfWeek = normalizeDays(body.daysOfWeek)
  if (typeof body?.active === "boolean") data.active = body.active
  if (typeof body?.remind === "boolean") data.remind = body.remind
  if (body?.note !== undefined) data.note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null
  if (body?.startDate !== undefined) data.startDate = asDateStr(body.startDate)
  if (body?.endDate !== undefined) data.endDate = asDateStr(body.endDate)

  await prisma.medSchedule.update({ where: { id }, data })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = new URL(req.url).searchParams.get("id") ?? ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  // Deleting the plan never touches the dose log — the history of what was
  // actually taken outlives any schedule.
  await prisma.medSchedule.deleteMany({ where: { id, userId: session.user.id } })
  return NextResponse.json({ ok: true })
}
