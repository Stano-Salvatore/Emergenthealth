import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserTimezone, localDateStr } from "@/lib/local-date"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Today at a glance, for the home-screen widget. Same key mechanism as the
// other widget endpoints: a `widget_api_key` preference row, so the widget
// never holds a session and revoking the key kills it everywhere at once.
//
// Every field can be null. A ring that wasn't worn has no readiness, and the
// widget prints a dash — an absent reading is not a zero, and this is the one
// surface where a fabricated number would be believed without question.

async function resolveUserByApiKey(apiKey: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "UserPreference"
    WHERE "key" = 'widget_api_key' AND "value" = ${apiKey}
    LIMIT 1
  `.catch(() => [] as { userId: string }[])
  return rows[0]?.userId ?? null
}

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-widget-key") ?? new URL(req.url).searchParams.get("key") ?? ""
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401 })

  const userId = await resolveUserByApiKey(apiKey)
  if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })

  const tz = await getUserTimezone(userId)
  const todayStr = localDateStr(tz)
  const todayStart = new Date(todayStr + "T00:00:00Z")
  const yesterdayStart = new Date(todayStart.getTime() - 86400_000)

  const [today, lastNight, habitsTotal, habitsDone, nextDose] = await Promise.all([
    prisma.healthLog.findFirst({
      where: { userId, date: { gte: todayStart } },
      orderBy: { date: "desc" },
      select: { steps: true, readinessScore: true, hrv: true },
    }).catch(() => null),

    // Sleep is recorded against the day it ended, so "last night" is today's
    // row when the ring has synced and yesterday's when it hasn't.
    prisma.healthLog.findFirst({
      where: { userId, date: { gte: yesterdayStart } },
      orderBy: { date: "desc" },
      select: { sleepDuration: true, sleepScore: true, date: true },
    }).catch(() => null),

    prisma.habit.count({ where: { userId, isArchived: false } }).catch(() => 0),
    prisma.habitCompletion.count({ where: { userId, date: { gte: todayStart } } }).catch(() => 0),

    prisma.medSchedule.findMany({
      where: { userId, active: true, remind: true },
      select: { name: true, times: true, daysOfWeek: true, startDate: true, endDate: true, id: true, active: true },
    }).catch(() => []),
  ])

  // The next dose still ahead today, in the user's own clock.
  const nowHhmm = new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
  const dow = new Date(todayStr + "T12:00:00Z").getUTCDay()
  let upcoming: { name: string; time: string } | null = null
  for (const med of nextDose) {
    if (med.daysOfWeek.length > 0 && !med.daysOfWeek.includes(dow)) continue
    if (med.startDate && todayStr < med.startDate) continue
    if (med.endDate && todayStr > med.endDate) continue
    for (const time of med.times) {
      if (time <= nowHhmm) continue
      if (!upcoming || time < upcoming.time) upcoming = { name: med.name, time }
    }
  }

  return NextResponse.json({
    date: todayStr,
    readiness: today?.readinessScore ?? null,
    hrv: today?.hrv != null ? Math.round(today.hrv) : null,
    steps: today?.steps ?? null,
    sleepHours: lastNight?.sleepDuration != null ? Math.round((lastNight.sleepDuration / 60) * 10) / 10 : null,
    sleepScore: lastNight?.sleepScore ?? null,
    habitsDone,
    habitsTotal,
    nextDose: upcoming,
  }, { headers: { "Cache-Control": "no-store" } })
}
