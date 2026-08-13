import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { getUserTimezone, localDateStr } from "@/lib/local-date"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { supplementInfoFor } from "@/lib/supplement-info"
import { scanUserAnomalies } from "@/lib/anomaly-scan"
import { loadLabTrends } from "@/lib/lab-trends-load"

const anthropic = new Anthropic()

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "no_key" }, { status: 503 })
  }

  const userId = session.user.id
  const firstName = session.user.name?.split(" ")[0] ?? "there"

  // Cache one brief per *user's* day. Keying on the server's UTC date meant
  // that around midnight the brief could be served for the wrong day, or
  // regenerated needlessly.
  const timezone = await getUserTimezone(userId)
  const todayStr = localDateStr(timezone)
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

  const yesterdayStart = new Date(todayStart.getTime() - 24 * 3_600_000)

  const [checkinRows, latestHealth, habitRows, intakeRows, foodRows, workoutRows, insightsRow, medTagRows] = await Promise.all([
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

    // Yesterday's eating — the brief happens in the morning, so today's food
    // hasn't happened yet and yesterday's is what the night was built on.
    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: yesterdayStart, lt: todayStart } },
      select: { calories: true, proteinG: true, loggedAt: true },
    }).catch(() => [] as { calories: number; proteinG: number | null; loggedAt: Date }[]),

    prisma.stravaActivity.findMany({
      where: { userId, day: { in: [todayStr, localDateStr(timezone, yesterdayStart)] } },
      select: { type: true, movingTimeSec: true, day: true },
    }).catch(() => [] as { type: string; movingTimeSec: number; day: string }[]),

    // Whatever the correlation engine last concluded — no recompute here, the
    // brief should be fast and the cache is refreshed daily anyway.
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "insights_cache:overall" } },
    }).catch(() => null),

    prisma.$queryRaw<{ tagName: string | null; text: string | null; timestamp: Date }[]>`
      SELECT "tagName", "text", "timestamp" FROM "OuraTag"
      WHERE "userId" = ${userId} AND "timestamp" >= ${yesterdayStart}
      ORDER BY "timestamp" DESC
    `.catch(() => [] as { tagName: string | null; text: string | null; timestamp: Date }[]),
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

  // Yesterday's eating, including how late it ended — meal timing is one of
  // the few things that plausibly explains the night that just happened.
  if (foodRows.length > 0) {
    const kcal = foodRows.reduce((s, f) => s + f.calories, 0)
    const protein = Math.round(foodRows.reduce((s, f) => s + (f.proteinG ?? 0), 0))
    const lastMeal = foodRows.reduce((latest, f) => f.loggedAt > latest ? f.loggedAt : latest, foodRows[0].loggedAt)
    const lastMealTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(lastMeal)
    lines.push(`Yesterday's food: ≈${kcal} kcal, ${protein}g protein, last meal ${lastMealTime}.`)
  }

  if (workoutRows.length > 0) {
    const mins = Math.round(workoutRows.reduce((s, w) => s + w.movingTimeSec, 0) / 60)
    lines.push(`Recent training: ${workoutRows.map(w => w.type).join(", ")} (${mins} min total).`)
  }

  // Meds and supplements taken since yesterday, and anything with a long
  // half-life that's still working — grogginess usually has a reason.
  const medNames: string[] = []
  const stillOnBoard: string[] = []
  const seenMeds = new Set<string>()
  for (const t of medTagRows) {
    const label = ((t.tagName ?? t.text) ?? "").trim()
    if (!label || classifyOuraTag(label).kind !== "med") continue
    const name = normalizeSupplement(label) ?? cleanLabel(label)
    if (seenMeds.has(name.toLowerCase())) continue
    seenMeds.add(name.toLowerCase())
    medNames.push(name)
    const info = supplementInfoFor(label)
    if (info?.halfLifeH) {
      const hours = (Date.now() - t.timestamp.getTime()) / 3_600_000
      const pct = Math.round(Math.pow(0.5, hours / info.halfLifeH) * 100)
      if (pct >= 25) stillOnBoard.push(`${name} ≈${pct}%`)
    }
  }
  if (medNames.length > 0) {
    lines.push(`Meds/supplements since yesterday: ${medNames.slice(0, 6).join(", ")}.`)
  }
  if (stillOnBoard.length > 0) {
    lines.push(`Still circulating this morning: ${stillOnBoard.slice(0, 3).join(", ")} of the last dose.`)
  }

  // The strongest thing the correlation engine currently believes, so the
  // brief can connect this morning to a pattern rather than just narrate it.
  try {
    const cached = insightsRow ? JSON.parse(insightsRow.value) : null
    const solid = (cached?.payload?.insights ?? [])
      .filter((i: { tier?: string }) => i.tier === "strong")
      .slice(0, 2)
      .map((i: { finding: string }) => i.finding)
    if (solid.length > 0) {
      lines.push(`Established patterns for this user: ${solid.join(" | ")}.`)
    }
  } catch { /* no insights yet */ }

  // Anything genuinely unusual for this person today. Population norms are
  // useless here — the point is the deviation from their own median.
  try {
    const { anomalies } = await scanUserAnomalies(userId)
    const notable = anomalies.filter(a => a.concerning).slice(0, 2).map(a => a.summary)
    if (notable.length > 0) {
      lines.push(`Off their own baseline today: ${notable.join(" | ")}.`)
    }
  } catch { /* not enough history */ }

  // Blood work, but only while it's news. A marker that has been out of range
  // since March shouldn't reappear in the brief every morning until December —
  // so this goes quiet a month after the draw.
  try {
    const { notable } = await loadLabTrends(userId)
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const recent = notable.filter(t => t.latest.date >= cutoff).slice(0, 2)
    if (recent.length > 0) {
      lines.push(`Recent blood work worth knowing about: ${recent.map(t => t.summary).join(" ")}`)
    }
  } catch { /* no labs */ }

  const context = lines.join(" ")

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `You are a warm, perceptive AI assistant writing a personal morning briefing. Based on the user's data, write 2-3 sentences.

Pick the two or three things that actually matter this morning rather than listing everything — a late dinner before a bad night, a med still circulating that explains feeling foggy, a workout that earned the tiredness, an established pattern this morning is repeating. Prefer a connection between two facts over two separate observations. If something contradicts an established pattern, that's worth saying too.

Be specific with their numbers. Sound like a smart friend who noticed, not a wellness bot. Never give medical advice or suggest changing a medication. If blood work appears above, you may repeat what it says, but never interpret what a result means, never say what caused it, and never suggest what to do about it — that belongs to the doctor who ordered the test. No greeting, no "I", start directly with the observation.

${context}`,
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
