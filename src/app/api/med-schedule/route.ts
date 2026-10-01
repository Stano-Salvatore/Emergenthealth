import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { localDateStr, localTimeStr, addDaysISO } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import {
  activeOn, adherenceOver, dosesByDay, dosesForDay, minutesOfDay, packOf, sortedTimes, toDose,
  type DoseRow, type ScheduleLike,
} from "@/lib/med-schedule"
import { normalizeDays, normalizePack, normalizeTimes } from "@/lib/med-schedule-edit"

export const dynamic = "force-dynamic"

/** Complete days used for the adherence figure — today is still in progress. */
const ADHERENCE_DAYS = 14

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
  const doseRows = await prisma.$queryRaw<DoseRow[]>`
    SELECT "id", "day", "timestamp", "tagName", "text" FROM "OuraTag"
    WHERE "userId" = ${userId} AND "day" >= ${windowStart}
  `.catch(() => [] as DoseRow[])

  const doses = doseRows.flatMap(r => toDose(r, tz) ?? [])

  const days: string[] = []
  for (let i = ADHERENCE_DAYS; i >= 1; i--) days.push(addDaysISO(today, -i))

  const shaped: ScheduleLike[] = schedules.map(s => ({
    id: s.id, name: s.name, times: s.times, daysOfWeek: s.daysOfWeek,
    active: s.active, startDate: s.startDate, endDate: s.endDate,
    createdDay: localDateStr(tz, s.createdAt), ...packOf(s),
  }))

  const adherence = new Map(adherenceOver(shaped, doses, days).map(a => [a.scheduleId, a]))

  const items = schedules.map(s => {
    const shape = shaped.find(x => x.id === s.id)!
    const runsToday = activeOn(shape, today)
    const takenToday = dosesByDay(shape, doses).get(today) ?? 0
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
      // The phone's alarms apply the same pack rule (lib/native/notifications).
      ...packOf(s),
      runsToday,
      // The phone's dose alarms skip today's first `takenToday` slots; without
      // it a dose taken early still rang at its scheduled time.
      takenToday,
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
      ...(normalizePack(body) ?? {}),
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
  // All three or none: a pack is cleared by sending packOnDays: null.
  if (body?.packOnDays !== undefined) Object.assign(data, normalizePack(body) ?? { packOnDays: null, packOffDays: null, packStart: null })

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
