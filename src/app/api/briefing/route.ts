import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic()

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "no_key" }, { status: 503 })
  }

  const userId = session.user.id
  const firstName = session.user.name?.split(" ")[0] ?? "there"

  const today = new Date()
  const todayStr = today.toISOString().split("T")[0]
  const cacheKey = `daily_briefing_${todayStr}`

  const { searchParams } = new URL(req.url)
  const force = searchParams.get("force") === "1"

  // Check cache unless force-refresh
  if (!force) {
    try {
      const cached = await prisma.$queryRaw<{ value: string }[]>`
        SELECT "value" FROM "UserPreference"
        WHERE "userId" = ${userId} AND "key" = ${cacheKey}
        LIMIT 1
      `
      if (cached.length > 0) {
        const parsed = JSON.parse(cached[0].value) as { briefing: string; generatedAt: string }
        return NextResponse.json({ briefing: parsed.briefing, generatedAt: parsed.generatedAt, cached: true })
      }
    } catch {
      // fall through to generate
    }
  }

  // Gather user data
  const todayStart = new Date(todayStr + "T00:00:00.000Z")
  const todayEnd = new Date(todayStr + "T23:59:59.999Z")

  const [checkinRows, latestHealth, habitRows, intakeRows] = await Promise.all([
    prisma.$queryRaw<{ energy: number; mood: number; intention: string | null }[]>`
      SELECT "energy", "mood", "intention" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" = ${todayStr}
      LIMIT 1
    `.catch(() => [] as { energy: number; mood: number; intention: string | null }[]),

    prisma.healthLog.findFirst({
      where: { userId },
      orderBy: { date: "desc" },
      select: { sleepDuration: true, readinessScore: true, date: true },
    }).catch(() => null),

    prisma.$queryRaw<{ name: string }[]>`
      SELECT h."name"
      FROM "HabitCompletion" hc
      JOIN "Habit" h ON h."id" = hc."habitId"
      WHERE hc."userId" = ${userId}
        AND hc."date" >= ${todayStart}
        AND hc."date" <= ${todayEnd}
    `.catch(() => [] as { name: string }[]),

    prisma.intakeLog.findMany({
      where: { userId, type: "water", loggedAt: { gte: todayStart, lte: todayEnd } },
      select: { amountMl: true },
    }).catch(() => [] as { amountMl: number }[]),
  ])

  // Get weather from /api/today (best-effort)
  let weatherSnippet = ""
  try {
    const host = req.headers.get("host") ?? "localhost:3000"
    const proto = req.headers.get("x-forwarded-proto") ?? "http"
    const weatherRes = await fetch(`${proto}://${host}/api/today`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(3000),
    })
    if (weatherRes.ok) {
      const wd = await weatherRes.json()
      if (wd.weather?.current) {
        weatherSnippet = `${wd.weather.current.temp}°C outside`
      }
    }
  } catch {
    // skip weather
  }

  // Build compact context
  const checkin = checkinRows[0] ?? null
  const waterMl = intakeRows.reduce((s, l) => s + l.amountMl, 0)

  const lines: string[] = [`User: ${firstName}. Today: ${todayStr}.`]

  if (checkin) {
    lines.push(`Morning check-in — energy: ${checkin.energy}/5, mood: ${checkin.mood}/5${checkin.intention ? `, intention: "${checkin.intention}"` : ""}.`)
  }

  if (latestHealth?.sleepDuration != null) {
    const sleepHrs = (latestHealth.sleepDuration / 60).toFixed(1)
    const readinessStr = latestHealth.readinessScore != null ? `, readiness ${latestHealth.readinessScore}/100` : ""
    lines.push(`Last night's sleep: ${sleepHrs} hours${readinessStr}.`)
  }

  if (habitRows.length > 0) {
    lines.push(`Habits completed today: ${habitRows.map(h => h.name).join(", ")}.`)
  }

  if (waterMl > 0) {
    lines.push(`Water so far: ${waterMl}ml.`)
  }

  if (weatherSnippet) {
    lines.push(`Weather: ${weatherSnippet}.`)
  }

  const context = lines.join(" ")

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: `You are a warm, perceptive AI assistant writing a personal morning briefing. Based on the user's data, write exactly 2 sentences. Be specific to their numbers — mention sleep quality, energy, or intentions. Sound like a smart friend who noticed the details, not a generic wellness bot. No greeting phrase, no "I", start directly with an observation.\n\n${context}`,
      },
    ],
  })

  const briefing = response.content[0].type === "text" ? response.content[0].text.trim() : ""
  const generatedAt = new Date().toISOString()

  // Store in cache
  try {
    const cacheValue = JSON.stringify({ briefing, generatedAt })
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},${cacheKey},${cacheValue})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${cacheValue}
    `
  } catch {
    // non-fatal
  }

  return NextResponse.json({ briefing, generatedAt, cached: false })
}
