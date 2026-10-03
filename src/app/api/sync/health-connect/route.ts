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

// The phone posts its last 30 days every hour. Twice that is room for a
// catch-up, and anything past it is not a phone — only the newest days are
// kept. Writes go a few at a time: the pool is shared by every user.
const MAX_DAYS = 62
const WRITE_BATCH = 10

/** A finite number within [min, max], rounded where the column is an integer; otherwise undefined, and the field isn't written. */
function inRange(v: unknown, min: number, max: number, int = true): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return undefined
  return int ? Math.round(v) : v
}

function instant(v: unknown): Date | undefined {
  if (typeof v !== "string") return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function isCalendarDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + "T00:00:00.000Z")
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
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

  // One entry per day — the last one sent wins, as it did when each was written in turn — newest days first.
  const byDay = new Map<string, DayPayload>()
  for (const d of days) if (d && typeof d === "object" && isCalendarDay(d.date)) byDay.set(d.date, d)
  const valid = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_DAYS)

  // The ring wins where it speaks (lib/health-precedence). This route is the
  // hourly writer, and it used to replace 30 days of ring values each time.
  const existingRows = await prisma.healthLog.findMany({
    where: { userId, date: { in: valid.map(d => new Date(d.date + "T00:00:00.000Z")) } },
    select: { date: true, ...PRECEDENCE_SELECT },
  })
  const existingByDay = new Map(existingRows.map(r => [r.date.toISOString().slice(0, 10), r]))

  const writes = valid
    .flatMap(d => {
      const date = new Date(d.date + "T00:00:00.000Z")
      const v = {
        steps: inRange(d.steps, 0, 200_000),
        sleepDuration: inRange(d.sleepDurationMin, 0, 1440),
        deepSleep: inRange(d.deepSleepMin, 0, 1440),
        remSleep: inRange(d.remSleepMin, 0, 1440),
        lightSleep: inRange(d.lightSleepMin, 0, 1440),
        sleepStart: instant(d.sleepStart),
        sleepEnd: instant(d.sleepEnd),
        // Plausibility, not just presence: a device that reports a reading
        // with no value has had it turned into 0 upstream more than once.
        restingHR: plausibleHeartRate(typeof d.restingHR === "number" ? d.restingHR : null) ?? undefined,
        hrv: plausibleHrv(typeof d.hrv === "number" ? d.hrv : null) ?? undefined,
        spo2: plausibleSpo2(typeof d.spo2 === "number" ? d.spo2 : null) ?? undefined,
        weight: inRange(d.weight, 20, 400, false),
        caloriesBurned: inRange(d.caloriesBurned, 0, 20_000),
        totalCalories: inRange(d.totalCalories, 0, 30_000),
        activeMinutes: inRange(d.activeMinutes, 0, 1440),
      }
      const fields = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<typeof v>
      if (fields.restingHR !== undefined) fields.restingHR = Math.round(fields.restingHR)
      // Absent is not zero, and nothing is not a day: a day with no value
      // left to write makes no row.
      if (Object.keys(fields).length === 0) return []
      const allowed = phoneFieldsRespectingRing(existingByDay.get(d.date) ?? null, fields)
      const syncedAt = new Date()
      return [() => prisma.healthLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...fields, syncedAt },
        update: { ...allowed, syncedAt },
      })]
    })

  for (let i = 0; i < writes.length; i += WRITE_BATCH) {
    await Promise.all(writes.slice(i, i + WRITE_BATCH).map(w => w()))
  }

  // Record last sync timestamp
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: "health_connect_last_sync" } },
    create: { userId, key: "health_connect_last_sync", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  }).catch(() => {})

  return NextResponse.json({ success: true, synced: writes.length })
}
