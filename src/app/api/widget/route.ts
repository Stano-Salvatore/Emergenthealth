import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

async function resolveUser(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? ""
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim()
    const key = await prisma.mcpApiKey.findUnique({ where: { token } })
    return key?.userId ?? null
  }
  return null
}

export async function GET(req: NextRequest) {
  const userId = await resolveUser(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split("T")[0]
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  const [healthToday, healthYesterday, moodToday, habitsCompleted, habitsTotal, weather, checkin] = await Promise.all([
    prisma.healthLog.findFirst({
      where: { userId, date: { gte: today } },
      orderBy: { date: "desc" },
      select: { steps: true, readinessScore: true, hrv: true },
    }).catch(() => null),

    prisma.healthLog.findFirst({
      where: { userId, date: { gte: yesterday, lt: today } },
      orderBy: { date: "desc" },
      select: { sleepDuration: true, sleepScore: true },
    }).catch(() => null),

    prisma.moodLog.findFirst({
      where: { userId, date: { gte: today } },
      orderBy: { date: "desc" },
      select: { mood: true },
    }).catch(() => null),

    prisma.habitCompletion.count({
      where: { userId, date: { gte: today } },
    }).catch(() => 0),

    prisma.habit.count({
      where: { userId, isArchived: false },
    }).catch(() => 0),

    prisma.$queryRaw<{ tempMax: number; weatherCode: number; precipSum: number }[]>`
      SELECT "tempMax", "weatherCode", "precipSum"
      FROM "WeatherLog"
      WHERE "userId" = ${userId} AND date = ${todayStr}
      LIMIT 1
    `.catch(() => [] as { tempMax: number; weatherCode: number; precipSum: number }[]),

    prisma.$queryRaw<{ energy: number; mood: number; intention: string | null }[]>`
      SELECT energy, mood, intention
      FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND date = ${todayStr}
      LIMIT 1
    `.catch(() => [] as { energy: number; mood: number; intention: string | null }[]),
  ])

  const weatherRow = (weather as { tempMax: number; weatherCode: number; precipSum: number }[])[0] ?? null
  const checkinRow = (checkin as { energy: number; mood: number; intention: string | null }[])[0] ?? null

  const STEP_GOAL = 8000
  const SLEEP_GOAL_H = 7
  const sleepH = healthYesterday?.sleepDuration ? +(healthYesterday.sleepDuration / 60).toFixed(1) : null

  function weatherEmoji(code: number): string {
    if (code === 0) return "☀️"
    if (code <= 2) return "⛅"
    if (code <= 48) return "🌫️"
    if (code <= 67) return "🌧️"
    if (code <= 77) return "❄️"
    if (code <= 82) return "🌦️"
    return "⛈️"
  }

  return NextResponse.json({
    date: todayStr,
    steps: healthToday?.steps ?? null,
    stepsGoal: STEP_GOAL,
    stepsPercent: healthToday?.steps ? Math.min(100, Math.round((healthToday.steps / STEP_GOAL) * 100)) : null,
    sleepHours: sleepH,
    sleepScore: healthYesterday?.sleepScore ?? null,
    sleepGoalH: SLEEP_GOAL_H,
    readiness: healthToday?.readinessScore ?? null,
    hrv: healthToday?.hrv ?? null,
    mood: moodToday?.mood ?? checkinRow?.mood ?? null,
    energy: checkinRow?.energy ?? null,
    intention: checkinRow?.intention ?? null,
    habitsCompleted,
    habitsTotal,
    habitsPercent: habitsTotal > 0 ? Math.round((habitsCompleted / habitsTotal) * 100) : null,
    weather: weatherRow ? {
      temp: Math.round(weatherRow.tempMax),
      code: weatherRow.weatherCode,
      emoji: weatherEmoji(weatherRow.weatherCode),
      rainy: weatherRow.precipSum > 1,
    } : null,
  })
}
