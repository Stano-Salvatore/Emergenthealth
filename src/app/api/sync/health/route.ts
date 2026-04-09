import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const {
    date,
    sleepHours,
    wakeTime,
    deepSleepMin,
    remMin,
    lightSleepMin,
    steps,
    caloriesBurned,
    activeMinutes,
    restingHR,
    workouts,
    coffee,
    water,
    mood,
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

  const log = await prisma.healthLog.upsert({
    where: { userId_date: { userId: session.user.id, date: dateObj } },
    create: {
      userId: session.user.id,
      date: dateObj,
      sleepDuration,
      deepSleep: deepSleepMin != null ? Number(deepSleepMin) : undefined,
      remSleep: remMin != null ? Number(remMin) : undefined,
      lightSleep: lightSleepMin != null ? Number(lightSleepMin) : undefined,
      steps: steps != null ? Number(steps) : undefined,
      caloriesBurned: caloriesBurned != null ? Number(caloriesBurned) : undefined,
      activeMinutes: activeMinutes != null ? Number(activeMinutes) : undefined,
      restingHR: restingHR != null ? Number(restingHR) : undefined,
      workouts: workouts ?? undefined,
      ...(coffee != null && { coffee: Number(coffee) }),
      ...(water  != null && { water:  Number(water)  }),
      ...(mood   != null && { mood:   Number(mood)   }),
    },
    update: {
      sleepDuration,
      deepSleep: deepSleepMin != null ? Number(deepSleepMin) : undefined,
      remSleep: remMin != null ? Number(remMin) : undefined,
      lightSleep: lightSleepMin != null ? Number(lightSleepMin) : undefined,
      steps: steps != null ? Number(steps) : undefined,
      caloriesBurned: caloriesBurned != null ? Number(caloriesBurned) : undefined,
      activeMinutes: activeMinutes != null ? Number(activeMinutes) : undefined,
      restingHR: restingHR != null ? Number(restingHR) : undefined,
      workouts: workouts ?? undefined,
      ...(coffee != null && { coffee: Number(coffee) }),
      ...(water  != null && { water:  Number(water)  }),
      ...(mood   != null && { mood:   Number(mood)   }),
      syncedAt: new Date(),
    },
  })

  return NextResponse.json({ success: true, log })
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
