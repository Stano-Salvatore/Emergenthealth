import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { addDaysISO, localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { toDose, type DoseRow } from "@/lib/med-schedule"
import { planTook, type TookItem } from "@/lib/med-took"
import { recordDose } from "@/lib/dose-write"
import { parseDose } from "@/lib/dose"

export const dynamic = "force-dynamic"

// "✓ Took it" on a web-push dose notification (public/sw.js). The Android
// app's own notifications post to /api/medications from the page instead;
// a service worker has no page, so it sends the schedule and the time and
// this decides the rest.

const MAX_ITEMS = 10

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { doses?: unknown } | null
  const items: TookItem[] = (Array.isArray(body?.doses) ? body.doses : [])
    .filter((d): d is Record<string, unknown> => d != null && typeof d === "object")
    .filter(d => typeof d.scheduleId === "string" && typeof d.time === "string")
    .slice(0, MAX_ITEMS)
    .map(d => ({ scheduleId: String(d.scheduleId), time: String(d.time), atScheduled: d.atScheduled === true }))
  if (items.length === 0) return NextResponse.json({ error: "doses required" }, { status: 400 })

  const tz = await getUserTimezone(userId)
  const today = localDateStr(tz)
  const [schedules, rows] = await Promise.all([
    prisma.medSchedule.findMany({
      where: { userId, id: { in: items.map(i => i.scheduleId) } },
      select: { id: true, name: true, dose: true, times: true, daysOfWeek: true, active: true, startDate: true, endDate: true, packOnDays: true, packOffDays: true, packStart: true },
    }),
    // Since yesterday: dosesByDay may file a 00:30 dose on the night before.
    prisma.$queryRaw<DoseRow[]>`
      SELECT "id","day","timestamp","tagName","text" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "day" >= ${addDaysISO(today, -1)}
    `,
  ])

  const plan = planTook(items, schedules, rows.flatMap(r => toDose(r, tz) ?? []), today, tz, new Date())
  const logged: string[] = []
  for (const w of plan.write) {
    // The schedule's dose, as the Medications page's "took it" records it.
    const dose = (w.dose ? parseDose(w.dose) : null) ?? parseDose(w.name)
    if (await recordDose({ userId, timezone: tz, name: w.name, dose, at: w.at })) logged.push(w.name)
  }
  if (logged.length < plan.write.length) {
    return NextResponse.json({ ok: false, logged, already: plan.already }, { status: 500 })
  }
  return NextResponse.json({ ok: true, logged, already: plan.already })
}
