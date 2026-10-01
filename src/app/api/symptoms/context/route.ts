import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr, addDaysISO } from "@/lib/local-date"
import { ethanolGrams, isAlcohol } from "@/lib/body-load"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { symptomLookback, lookbackSince, EPISODE_HORIZON_DAYS } from "@/lib/symptom-lookback"

// "What came before this one?" for a single logged symptom. The rows are read
// here and judged in lib/symptom-lookback.
//
// No read is caught into an empty list. An empty caffeine log beside a
// readable food log is "no caffeine that day"; the same empty list from a
// failed query would be a zero nobody measured, stated as a fact.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const id = new URL(req.url).searchParams.get("id") ?? ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  try {
    const current = await prisma.symptomLog.findFirst({
      where: { id, userId },
      select: { id: true, name: true, loggedAt: true },
    })
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const [timezone, sameName] = await Promise.all([
      getUserTimezone(userId),
      prisma.symptomLog.findMany({
        where: {
          userId,
          name: current.name,
          loggedAt: { gte: new Date(current.loggedAt.getTime() - EPISODE_HORIZON_DAYS * 86_400_000), lte: current.loggedAt },
        },
        select: { id: true, name: true, loggedAt: true },
        orderBy: { loggedAt: "desc" },
        take: 500,
      }),
    ])

    const since = lookbackSince(current, sameName)
    const until = current.loggedAt
    const window = { gt: since, lte: until }
    // HealthLog.date is the local morning a night ended on, stored as a date
    // column; a day either side covers the first anchor's "day before".
    const dateCol = (day: string) => new Date(`${day}T00:00:00Z`)
    const firstDay = addDaysISO(localDateStr(timezone, since), -1)
    const lastDay = localDateStr(timezone, until)

    const [health, intake, food, caffeine, ambient, tags] = await Promise.all([
      // The row as written under lib/health-precedence: the ring's night where
      // it has one, the phone's where it left a gap.
      prisma.healthLog.findMany({
        where: { userId, date: { gte: dateCol(firstDay), lte: dateCol(lastDay) } },
        select: { date: true, sleepEnd: true, sleepDuration: true, steps: true },
      }),
      prisma.intakeLog.findMany({
        where: { userId, loggedAt: window },
        select: { loggedAt: true, type: true, amountMl: true, note: true },
      }),
      prisma.foodLog.findMany({
        where: { userId, loggedAt: window },
        select: { loggedAt: true },
      }),
      prisma.caffeineLog.findMany({
        where: { userId, loggedAt: window },
        select: { loggedAt: true, caffeineMg: true },
      }),
      prisma.ambientSample.findMany({
        where: { userId, at: window, pressureHpa: { not: null } },
        select: { at: true, pressureHpa: true },
      }),
      prisma.ouraTag.findMany({
        where: { userId, timestamp: window },
        select: { timestamp: true, tagName: true, text: true },
      }),
    ])

    const doses: { at: Date; name: string }[] = []
    for (const t of tags) {
      const label = (t.tagName ?? t.text ?? "").trim()
      if (!label || UUID.test(label) || classifyOuraTag(label).kind !== "med") continue
      // The engine's own folding, so "Frontin 0,5 mg" and "Frontin" are one substance.
      doses.push({ at: t.timestamp, name: normalizeSupplement(label) ?? cleanLabel(label) })
    }

    const result = symptomLookback({
      timezone,
      nights: health
        .filter(h => h.sleepDuration != null)
        .map(h => ({ morning: h.date.toISOString().slice(0, 10), end: h.sleepEnd, minutes: h.sleepDuration! })),
      stepDays: health
        .filter(h => h.steps != null)
        .map(h => ({ day: h.date.toISOString().slice(0, 10), steps: h.steps! })),
      drinks: intake
        // Every alcohol type, not just "alcohol" — see ALCOHOL_TYPES.
        .filter(i => isAlcohol(i.type))
        .map(i => ({ at: i.loggedAt, grams: ethanolGrams(i.type, i.amountMl, i.note ?? undefined) })),
      caffeine: caffeine.map(c => ({ at: c.loggedAt, mg: c.caffeineMg })),
      diary: [...intake.map(i => i.loggedAt), ...food.map(f => f.loggedAt)],
      pressure: ambient.map(a => ({ at: a.at, hPa: a.pressureHpa! })),
      doses,
    }, current, sameName)

    return NextResponse.json({ id: current.id, name: current.name, ...result })
  } catch (err) {
    console.error("[symptoms/context]", err)
    return NextResponse.json({ error: "Could not read the day before" }, { status: 500 })
  }
}
