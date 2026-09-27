import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { phoneFieldsRespectingRing, PRECEDENCE_SELECT } from "@/lib/health-precedence"

export const maxDuration = 60 // Health Connect batches

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const {
    date,
    sleepHours,
    // No wakeTime here: HealthLog has awakeTime (minutes spent awake), which is
    // a different quantity. Destructuring a wake *time* only made the endpoint
    // look like it stored one.
    deepSleepMin,
    remMin,
    lightSleepMin,
    steps,
    caloriesBurned,
    activeMinutes,
    restingHR,
    workouts,
  } = body

  if (!date) return NextResponse.json({ error: "date is required" }, { status: 400 })

  const dateObj = new Date(date)
  dateObj.setUTCHours(0, 0, 0, 0)

  const sleepDuration =
    sleepHours != null
      ? Math.round(Number(sleepHours) * 60)
      : deepSleepMin != null || remMin != null || lightSleepMin != null
      ? (Number(deepSleepMin ?? 0) + Number(remMin ?? 0) + Number(lightSleepMin ?? 0))
      : undefined

  const incoming = {
    sleepDuration,
    deepSleep: deepSleepMin != null ? Number(deepSleepMin) : undefined,
    remSleep: remMin != null ? Number(remMin) : undefined,
    lightSleep: lightSleepMin != null ? Number(lightSleepMin) : undefined,
    steps: steps != null ? Number(steps) : undefined,
    caloriesBurned: caloriesBurned != null ? Number(caloriesBurned) : undefined,
    activeMinutes: activeMinutes != null ? Number(activeMinutes) : undefined,
    restingHR: restingHR != null ? Number(restingHR) : undefined,
  }

  // The ring wins where it speaks (lib/health-precedence) — even over a typed
  // value, because the next Oura sync would put the ring's back within the
  // hour and the correction would have been a save that did not last.
  const existing = await prisma.healthLog.findUnique({
    where: { userId_date: { userId: session.user.id, date: dateObj } },
    select: PRECEDENCE_SELECT,
  }).catch(() => null)
  const allowed = phoneFieldsRespectingRing(existing, incoming)
  // The form reports these, so it never closes as if a refused field saved.
  const sent = (Object.keys(incoming) as (keyof typeof incoming)[]).filter(k => incoming[k] !== undefined)
  const written = sent.filter(k => k in allowed)
  const kept = sent.filter(k => !(k in allowed))

  const log = await prisma.healthLog.upsert({
    where: { userId_date: { userId: session.user.id, date: dateObj } },
    create: {
      userId: session.user.id,
      date: dateObj,
      ...incoming,
      workouts: workouts ?? undefined,
    },
    update: {
      ...allowed,
      workouts: workouts ?? undefined,
      syncedAt: new Date(),
    },
  })

  return NextResponse.json({ success: true, log, written, kept })
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = Number(searchParams.get("days") ?? 7)

  const logs = await prisma.healthLog.findMany({
    where: { userId: session.user.id },
    orderBy: { date: "desc" },
    take: Math.min(days, 90),
    select: {
      id: true, date: true, sleepDuration: true, deepSleep: true,
      remSleep: true, lightSleep: true, steps: true, restingHR: true,
      weight: true, activeMinutes: true, caloriesBurned: true, syncedAt: true,
    },
  })

  return NextResponse.json(logs)
}
