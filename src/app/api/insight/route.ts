import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { checkRateLimit } from "@/lib/rate-limit"
import { format, subDays } from "date-fns"

const INSIGHT_KEY = new Date("0002-01-01")

async function generateInsight(userId: string): Promise<{ bullets: string[]; generatedAt: string }> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const todayStr = today.toISOString().split("T")[0]
  const weekAgoStr = format(weekAgo, "yyyy-MM-dd")

  const [
    healthLogs,
    moodLogs,
    habitCompletionCount,
    totalHabits,
    todayCheckin,
    focusSessions,
    intakeLogs,
    transactions,
    stravaActivities,
    customMetricsSummary,
  ] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: weekAgo } },
      orderBy: { date: "desc" },
      select: { date: true, sleepDuration: true, steps: true, readinessScore: true, hrv: true, sleepScore: true, activeMinutes: true },
    }).catch(() => [] as { date: Date; sleepDuration: number | null; steps: number | null; readinessScore: number | null; hrv: number | null; sleepScore: number | null; activeMinutes: number | null }[]),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: weekAgo } },
      select: { mood: true },
    }).catch(() => [] as { mood: number }[]),
    prisma.habitCompletion.count({
      where: { userId, date: { gte: weekAgo } },
    }).catch(() => 0),
    prisma.habit.count({
      where: { userId, isArchived: false },
    }).catch(() => 0),
    prisma.$queryRaw<{ energy: number; mood: number }[]>`
      SELECT "energy", "mood" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" = ${todayStr}
      LIMIT 1
    `.catch(() => [] as { energy: number; mood: number }[]),
    prisma.focusSession.findMany({
      where: { userId, endedAt: { gte: weekAgo }, type: "focus" },
      select: { durationMin: true },
    }).catch(() => [] as { durationMin: number }[]),
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: weekAgo } },
      select: { amountMl: true, type: true },
    }).catch(() => [] as { amountMl: number; type: string }[]),
    prisma.transaction.findMany({
      where: { userId, date: { gte: weekAgo }, isTransfer: false, amount: { lt: 0 } },
      select: { amount: true, category: true },
    }).catch(() => [] as { amount: number; category: string | null }[]),
    prisma.$queryRaw<{ name: string; distance: number; movingTime: number; type: string }[]>`
      SELECT "name", "distance", "movingTime", "type"
      FROM "StravaActivity"
      WHERE "userId" = ${userId}
        AND "startDate" >= ${weekAgoStr}::timestamptz
      ORDER BY "startDate" DESC
      LIMIT 5
    `.catch(() => [] as { name: string; distance: number; movingTime: number; type: string }[]),
    prisma.$queryRaw<{ name: string; emoji: string; avg_val: number; n: number }[]>`
      SELECT cm."name", cm."emoji",
             AVG(cl."value")::numeric(6,1) as avg_val,
             COUNT(*)::int as n
      FROM "CustomMetricLog" cl
      JOIN "CustomMetric" cm ON cm."id" = cl."metricId"
      WHERE cl."userId" = ${userId}
        AND cl."date" >= ${weekAgoStr}
      GROUP BY cm."id", cm."name", cm."emoji"
      ORDER BY n DESC
      LIMIT 3
    `.catch(() => [] as { name: string; emoji: string; avg_val: number; n: number }[]),
  ])

  // ── Health averages ─────────────────────────────────────────────────────
  const sleepLogs = healthLogs.filter(l => l.sleepDuration != null)
  const avgSleepH = sleepLogs.length
    ? (sleepLogs.reduce((s, l) => s + l.sleepDuration!, 0) / sleepLogs.length / 60).toFixed(1)
    : null
  const sleepScores = healthLogs.filter(l => l.sleepScore != null).map(l => l.sleepScore!)
  const stepsLogs = healthLogs.filter(l => l.steps != null)
  const avgSteps = stepsLogs.length
    ? Math.round(stepsLogs.reduce((s, l) => s + l.steps!, 0) / stepsLogs.length)
    : null
  const readinessLogs = healthLogs.filter(l => l.readinessScore != null)
  const avgReadiness = readinessLogs.length
    ? Math.round(readinessLogs.reduce((s, l) => s + l.readinessScore!, 0) / readinessLogs.length)
    : null
  const hrvLogs = healthLogs.filter(l => l.hrv != null)
  const avgHrv = hrvLogs.length
    ? Math.round(hrvLogs.reduce((s, l) => s + l.hrv!, 0) / hrvLogs.length)
    : null
  const avgMood = moodLogs.length
    ? (moodLogs.reduce((s, l) => s + l.mood, 0) / moodLogs.length).toFixed(1)
    : null
  const checkinToday = (todayCheckin as { energy: number; mood: number }[])[0] ?? null

  // ── Focus ───────────────────────────────────────────────────────────────
  const totalFocusMin = focusSessions.reduce((s, f) => s + f.durationMin, 0)

  // ── Intake breakdown ────────────────────────────────────────────────────
  const waterMl = intakeLogs.filter(l => l.type === "water").reduce((s, l) => s + l.amountMl, 0)
  const alcoholMl = intakeLogs.filter(l => l.type === "alcohol").reduce((s, l) => s + l.amountMl, 0)
  const coffeeMl = intakeLogs.filter(l => l.type === "coffee").reduce((s, l) => s + l.amountMl, 0)

  // ── Spending ────────────────────────────────────────────────────────────
  const totalSpend = transactions.reduce((s, t) => s + Math.abs(t.amount), 0) / 100
  const spendByCategory: Record<string, number> = {}
  for (const t of transactions) {
    const cat = t.category ?? "Other"
    spendByCategory[cat] = (spendByCategory[cat] ?? 0) + Math.abs(t.amount) / 100
  }
  const topCategory = Object.entries(spendByCategory).sort(([, a], [, b]) => b - a)[0] ?? null

  // ── Strava ──────────────────────────────────────────────────────────────
  const totalWorkouts = stravaActivities.length
  const totalDistanceKm = stravaActivities.reduce((s, a) => s + a.distance / 1000, 0)

  // ── Build context ───────────────────────────────────────────────────────
  const lines: string[] = ["Last 7 days — full health & lifestyle snapshot:"]

  if (avgSleepH !== null) {
    const scores = sleepScores.length ? `, scores [${sleepScores.join(", ")}]` : ""
    lines.push(`- Sleep: avg ${avgSleepH} hrs${scores}`)
  }
  if (avgSteps !== null) lines.push(`- Steps: avg ${avgSteps.toLocaleString()} / day`)
  if (avgReadiness !== null) lines.push(`- Readiness: avg ${avgReadiness}/100`)
  if (avgHrv !== null) lines.push(`- HRV: avg ${avgHrv} ms`)
  lines.push(`- Habits: ${habitCompletionCount}/${totalHabits * 7} completed`)
  if (avgMood !== null) lines.push(`- Mood: avg ${avgMood}/5`)
  if (checkinToday) lines.push(`- Morning: energy ${checkinToday.energy}/5, mood ${checkinToday.mood}/5`)
  if (totalFocusMin > 0) lines.push(`- Focus: ${totalFocusMin} min deep work this week`)
  if (waterMl > 0) lines.push(`- Water: ${Math.round(waterMl / 1000 * 10) / 10}L total`)
  if (alcoholMl > 0) lines.push(`- Alcohol: ${alcoholMl} ml this week`)
  if (coffeeMl > 0) lines.push(`- Coffee: ${coffeeMl} ml this week`)
  if (totalWorkouts > 0) lines.push(`- Workouts: ${totalWorkouts} activities, ${totalDistanceKm.toFixed(1)} km total`)
  if (totalSpend > 0) {
    const catStr = topCategory ? `, most on "${topCategory[0]}" (€${topCategory[1].toFixed(0)})` : ""
    lines.push(`- Spending: €${totalSpend.toFixed(0)} this week${catStr}`)
  }
  for (const cm of customMetricsSummary) {
    lines.push(`- ${cm.emoji} ${cm.name}: avg ${cm.avg_val} (${cm.n} logs)`)
  }

  const summary = lines.join("\n")

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `You are a personal health and lifestyle coach. Based on this week's data, give exactly 3 short bullet point insights. Each bullet is 1 sentence under 15 words. Focus on the single most surprising or actionable cross-metric pattern — connect dots across sleep, focus, mood, spending, alcohol, workouts. No generic advice. Format: 3 bullets only, each starting with an emoji.\n\n${summary}`,
      },
    ],
  })

  const text = response.content.find(b => b.type === "text")?.type === "text"
    ? (response.content.find(b => b.type === "text") as { type: "text"; text: string }).text
    : ""
  const bullets = text.split("\n").map(l => l.trim()).filter(Boolean)

  return { bullets, generatedAt: new Date().toISOString() }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ bullets: [], error: "no_key" })
  }

  try {
    const cached = await prisma.dailyNote.findUnique({
      where: { userId_date: { userId, date: INSIGHT_KEY } },
    })

    if (cached) {
      const parsed = JSON.parse(cached.content) as { generatedAt: string; bullets: string[] }
      const generatedDate = new Date(parsed.generatedAt).toISOString().split("T")[0]
      const todayStr = new Date().toISOString().split("T")[0]
      if (generatedDate === todayStr) {
        return NextResponse.json({ bullets: parsed.bullets, generatedAt: parsed.generatedAt, cached: true })
      }
    }

    const { bullets, generatedAt } = await generateInsight(userId)
    const content = JSON.stringify({ generatedAt, bullets })

    await prisma.dailyNote.upsert({
      where: { userId_date: { userId, date: INSIGHT_KEY } },
      create: { userId, date: INSIGHT_KEY, content },
      update: { content },
    })

    return NextResponse.json({ bullets, generatedAt, cached: false })
  } catch {
    return NextResponse.json({ bullets: [], error: "no_key" })
  }
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const rl = checkRateLimit(userId, "insight", 5, 24 * 60 * 60 * 1000) // 5/day
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded for insight regeneration.", resetAt: rl.resetAt },
      { status: 429 }
    )
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ bullets: [], error: "no_key" })
  }

  try {
    await prisma.dailyNote.deleteMany({
      where: { userId, date: INSIGHT_KEY },
    })

    const { bullets, generatedAt } = await generateInsight(userId)
    const content = JSON.stringify({ generatedAt, bullets })

    await prisma.dailyNote.upsert({
      where: { userId_date: { userId, date: INSIGHT_KEY } },
      create: { userId, date: INSIGHT_KEY, content },
      update: { content },
    })

    return NextResponse.json({ bullets, generatedAt, cached: false })
  } catch {
    return NextResponse.json({ bullets: [], error: "no_key" })
  }
}
