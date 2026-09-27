import { NextRequest, NextResponse } from "next/server"
import { plausibleHeartRate, plausibleHrv, plausibleSpo2 } from "@/lib/vitals"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { phoneFieldsRespectingRing, PRECEDENCE_SELECT } from "@/lib/health-precedence"

export const runtime = "nodejs"
export const maxDuration = 60

type DayPayload = {
  date: string           // "YYYY-MM-DD"
  steps?: number
  sleepDurationMin?: number
  deepSleepMin?: number
  remSleepMin?: number
  lightSleepMin?: number
  sleepStart?: string    // ISO string
  sleepEnd?: string
  restingHR?: number
  hrv?: number
  spo2?: number
  weight?: number
  caloriesBurned?: number
  totalCalories?: number
  activeMinutes?: number
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  let body: { days: DayPayload[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { days } = body
  if (!Array.isArray(days) || days.length === 0) {
    return NextResponse.json({ error: "No data" }, { status: 400 })
  }

  const valid = days.filter(d => d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date))

  // The ring wins where it speaks (lib/health-precedence). This route is the
  // hourly writer, and it used to replace 30 days of ring values each time.
  const existingRows = await prisma.healthLog.findMany({
    where: { userId, date: { in: valid.map(d => new Date(d.date + "T00:00:00.000Z")) } },
    select: { date: true, ...PRECEDENCE_SELECT },
  })
  const existingByDay = new Map(existingRows.map(r => [r.date.toISOString().slice(0, 10), r]))

  const upserts = valid
    .map(d => {
      const date = new Date(d.date + "T00:00:00.000Z")
      const fields = {
        ...(d.steps != null            && { steps: d.steps }),
        ...(d.sleepDurationMin != null && { sleepDuration: d.sleepDurationMin }),
        ...(d.deepSleepMin != null     && { deepSleep: d.deepSleepMin }),
        ...(d.remSleepMin != null      && { remSleep: d.remSleepMin }),
        ...(d.lightSleepMin != null    && { lightSleep: d.lightSleepMin }),
        ...(d.sleepStart != null       && { sleepStart: new Date(d.sleepStart) }),
        ...(d.sleepEnd != null         && { sleepEnd: new Date(d.sleepEnd) }),
        // Plausibility, not just presence: a device that reports a reading
        // with no value has had it turned into 0 upstream more than once.
        ...(plausibleHeartRate(d.restingHR) != null && { restingHR: d.restingHR }),
        ...(plausibleHrv(d.hrv) != null && { hrv: d.hrv }),
        ...(plausibleSpo2(d.spo2) != null && { spo2: d.spo2 }),
        ...(d.weight != null           && { weight: d.weight }),
        ...(d.caloriesBurned != null   && { caloriesBurned: d.caloriesBurned }),
        ...(d.totalCalories != null    && { totalCalories: d.totalCalories }),
        ...(d.activeMinutes != null    && { activeMinutes: d.activeMinutes }),
      }
      const allowed = phoneFieldsRespectingRing(existingByDay.get(d.date) ?? null, fields)
      const syncedAt = new Date()
      return prisma.healthLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...fields, syncedAt },
        update: { ...allowed, syncedAt },
      })
    })

  await Promise.all(upserts)

  // Record last sync timestamp
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: "health_connect_last_sync" } },
    create: { userId, key: "health_connect_last_sync", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  }).catch(() => {})

  return NextResponse.json({ success: true, synced: upserts.length })
}
