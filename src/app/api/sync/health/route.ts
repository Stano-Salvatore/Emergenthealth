import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { phoneFieldsRespectingRing, PRECEDENCE_SELECT } from "@/lib/health-precedence"

export const maxDuration = 60 // Health Connect batches

// What a typed day can hold. A value outside it is refused by name rather
// than written, or handed to Prisma to fail as a 500 the form never showed.
const RANGES = {
  sleepHours: [0, 24], deepSleepMin: [0, 1440], remMin: [0, 1440], lightSleepMin: [0, 1440],
  steps: [0, 200_000], caloriesBurned: [0, 20_000], activeMinutes: [0, 1440], restingHR: [20, 250],
} as const
const LABEL: Record<keyof typeof RANGES, string> = {
  sleepHours: "sleep hours", deepSleepMin: "deep sleep", remMin: "REM sleep", lightSleepMin: "light sleep",
  steps: "steps", caloriesBurned: "calories burned", activeMinutes: "active minutes", restingHR: "resting heart rate",
}
const MAX_WORKOUTS = 50
const MAX_WORKOUTS_CHARS = 20_000

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
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

  const dateObj = new Date(typeof date === "string" ? date : NaN)
  if (Number.isNaN(dateObj.getTime())) return NextResponse.json({ error: "That date isn't one we can read." }, { status: 400 })
  dateObj.setUTCHours(0, 0, 0, 0)

  const given = { sleepHours, deepSleepMin, remMin, lightSleepMin, steps, caloriesBurned, activeMinutes, restingHR }
  for (const k of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const v = given[k]
    if (v == null) continue
    const [min, max] = RANGES[k]
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      return NextResponse.json({ error: `${LABEL[k][0].toUpperCase()}${LABEL[k].slice(1)} should be between ${min} and ${max}.` }, { status: 400 })
    }
  }
  if (workouts != null && (!Array.isArray(workouts) || workouts.length > MAX_WORKOUTS || JSON.stringify(workouts).length > MAX_WORKOUTS_CHARS)) {
    return NextResponse.json({ error: `workouts must be a list of at most ${MAX_WORKOUTS}.` }, { status: 400 })
  }

  const sleepDuration =
    sleepHours != null
      ? Math.round(Number(sleepHours) * 60)
      : deepSleepMin != null || remMin != null || lightSleepMin != null
      ? Math.round(Number(deepSleepMin ?? 0) + Number(remMin ?? 0) + Number(lightSleepMin ?? 0))
      : undefined

  const incoming = {
    sleepDuration,
    deepSleep: deepSleepMin != null ? Math.round(Number(deepSleepMin)) : undefined,
    remSleep: remMin != null ? Math.round(Number(remMin)) : undefined,
    lightSleep: lightSleepMin != null ? Math.round(Number(lightSleepMin)) : undefined,
    steps: steps != null ? Math.round(Number(steps)) : undefined,
    caloriesBurned: caloriesBurned != null ? Math.round(Number(caloriesBurned)) : undefined,
    activeMinutes: activeMinutes != null ? Math.round(Number(activeMinutes)) : undefined,
    restingHR: restingHR != null ? Math.round(Number(restingHR)) : undefined,
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
