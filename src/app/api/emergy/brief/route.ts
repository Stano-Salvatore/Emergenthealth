import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const WEATHER_CODES: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "foggy", 48: "icy fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow",
  80: "light showers", 81: "showers", 82: "violent showers", 95: "thunderstorm",
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") ?? "morning"
  if (!["morning", "midday", "evening"].includes(type)) {
    return NextResponse.json({ error: "type must be morning|midday|evening" }, { status: 400 })
  }

  const userId = session.user.id
  const firstName = session.user.name?.split(" ")[0] ?? "friend"
  const today = new Date()
  const todayStr = today.toISOString().split("T")[0]
  const dayStart = new Date(todayStr + "T00:00:00Z")

  const dateLabel = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })

  const [intakeToday, habitsAll, completionsToday, recentHealth, moodToday] = await Promise.all([
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: dayStart } },
      select: { type: true, amountMl: true },
    }),
    prisma.habit.findMany({ where: { userId, isArchived: false }, select: { id: true, name: true } }),
    prisma.habitCompletion.findMany({
      where: { userId, completedAt: { gte: dayStart } },
      select: { habitId: true },
    }).catch(() => [] as { habitId: string }[]),
    prisma.healthLog.findFirst({
      where: { userId, date: { lte: new Date(todayStr) } },
      orderBy: { date: "desc" },
      select: { readinessScore: true, sleepDuration: true, steps: true },
    }),
    prisma.moodLog.findFirst({
      where: { userId, date: new Date(todayStr) },
      select: { mood: true },
    }),
  ])

  const waterMl = intakeToday.filter(i => i.type === "water").reduce((s, i) => s + i.amountMl, 0)
  const completedHabitIds = new Set(completionsToday.map(c => c.habitId))
  const habitsCompletedCount = completedHabitIds.size
  const habitsTotalCount = habitsAll.length

  let weatherDesc = ""
  try {
    const weatherRes = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=48.1486&longitude=17.1077&current=temperature_2m,weathercode&timezone=auto",
      { signal: AbortSignal.timeout(3000) }
    ).catch(() => null)
    if (weatherRes?.ok) {
      const wd = await weatherRes.json()
      const temp = Math.round(wd.current?.temperature_2m ?? 0)
      const code = wd.current?.weathercode ?? 0
      const desc = WEATHER_CODES[code] ?? "unknown"
      weatherDesc = `${temp}°C, ${desc}`
    }
  } catch {}

  let contextLines: string[] = []

  if (type === "morning") {
    const sleepHrs = recentHealth?.sleepDuration ? (recentHealth.sleepDuration / 60).toFixed(1) : null
    const readiness = recentHealth?.readinessScore
    contextLines = [
      `Today is ${dateLabel}.`,
      weatherDesc ? `Weather: ${weatherDesc}.` : "",
      sleepHrs ? `Last night's sleep: ${sleepHrs} hours.` : "",
      readiness != null ? `Readiness score: ${readiness}/100.` : "",
      habitsTotalCount > 0 ? `Today's habits: ${habitsAll.map(h => h.name).join(", ")}.` : "",
    ]
  } else if (type === "midday") {
    contextLines = [
      `It's midday on ${dateLabel}.`,
      `Water intake so far: ${waterMl}ml.`,
      habitsTotalCount > 0
        ? `Habits: ${habitsCompletedCount}/${habitsTotalCount} completed.`
        : "",
      moodToday ? `Mood logged: ${moodToday.mood}/5.` : "No mood logged yet today.",
    ]
  } else {
    const steps = recentHealth?.steps
    contextLines = [
      `It's evening on ${dateLabel}.`,
      `Water intake today: ${waterMl}ml.`,
      habitsTotalCount > 0
        ? `Habits completed: ${habitsCompletedCount}/${habitsTotalCount}.`
        : "",
      moodToday ? `Mood: ${moodToday.mood}/5.` : "",
      steps != null ? `Steps today: ${steps.toLocaleString()}.` : "",
    ]
  }

  const context = contextLines.filter(Boolean).join(" ")

  const briefTypeInstructions: Record<string, string> = {
    morning: "Write a warm, energetic good morning brief. Mention the date, weather if provided, and sleep. Give 1 motivating tip for the day. Keep it to 3-4 sentences.",
    midday: "Write a friendly midday check-in. Comment on water intake and habit progress. Be encouraging. 2-3 sentences.",
    evening: "Write a warm, reflective good evening summary. Review the day. Be proud of what was done, gentle about what wasn't. 3-4 sentences.",
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `You are Emergy 🌱 — a caring, warm, slightly dramatic AI plant companion living in ${firstName}'s health dashboard. ${briefTypeInstructions[type]}\n\nUser data: ${context}\n\nWrite the brief directly, starting with a greeting to ${firstName}. No preamble.`,
    }],
  })

  const brief = response.content[0].type === "text" ? response.content[0].text : ""

  return NextResponse.json({
    type,
    brief,
    data: {
      waterMl,
      habitsCompleted: habitsCompletedCount,
      habitsTotal: habitsTotalCount,
      readiness: recentHealth?.readinessScore,
      sleepHours: recentHealth?.sleepDuration ? recentHealth.sleepDuration / 60 : null,
      mood: moodToday?.mood,
      weather: weatherDesc,
    },
  })
}
