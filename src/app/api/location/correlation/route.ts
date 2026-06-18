import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export type CorrelationConfidence = "insufficient" | "low" | "moderate" | "good"

export type PlaceCorrelation = {
  placeId: string
  placeName: string
  placeEmoji: string
  visitCount: number
  confidence: CorrelationConfidence
  visitAvg: {
    readiness: number | null
    sleepHours: number | null
    mood: number | null
    hrv: number | null
    steps: number | null
    restingHR: number | null
  }
  nonVisitAvg: {
    readiness: number | null
    sleepHours: number | null
    mood: number | null
    hrv: number | null
    steps: number | null
    restingHR: number | null
  }
}

function confidence(n: number): CorrelationConfidence {
  if (n < 6)  return "insufficient"
  if (n < 15) return "low"
  if (n < 30) return "moderate"
  return "good"
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n != null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const placeId = searchParams.get("placeId")
  if (!placeId) return NextResponse.json({ error: "placeId required" }, { status: 400 })

  const userId = session.user.id
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  type SavedPlaceRow = { id: string; name: string; emoji: string }
  type CheckInRow = { checkedAt: Date }

  const placeRows = await prisma.$queryRaw<SavedPlaceRow[]>`
    SELECT id, name, emoji FROM "SavedPlace" WHERE id = ${placeId} AND "userId" = ${userId} LIMIT 1
  `.catch(() => [] as SavedPlaceRow[])

  if (!placeRows.length) return NextResponse.json({ error: "Place not found" }, { status: 404 })
  const place = placeRows[0]

  const [checkIns, healthLogs, moodLogs] = await Promise.all([
    prisma.$queryRaw<CheckInRow[]>`
      SELECT "checkedAt" FROM "CheckIn"
      WHERE "userId" = ${userId}
        AND "savedPlaceId" = ${placeId}
        AND "isAuto" = true
        AND "checkedAt" >= ${since}
    `.catch(() => [] as CheckInRow[]),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since } },
      select: {
        date: true,
        readinessScore: true,
        sleepDuration: true,
        hrv: true,
        steps: true,
        restingHR: true,
      },
    }),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, mood: true },
    }),
  ])

  const visitDates = new Set(checkIns.map(c => new Date(c.checkedAt).toISOString().split("T")[0]))

  const visitHealth    = healthLogs.filter(h =>  visitDates.has(h.date.toISOString().split("T")[0]))
  const nonVisitHealth = healthLogs.filter(h => !visitDates.has(h.date.toISOString().split("T")[0]))
  const visitMoods     = moodLogs.filter(m =>  visitDates.has(m.date.toISOString().split("T")[0]))
  const nonVisitMoods  = moodLogs.filter(m => !visitDates.has(m.date.toISOString().split("T")[0]))

  const result: PlaceCorrelation = {
    placeId: place.id,
    placeName: place.name,
    placeEmoji: place.emoji,
    visitCount: checkIns.length,
    confidence: confidence(checkIns.length),
    visitAvg: {
      readiness: avg(visitHealth.map(h => h.readinessScore)),
      sleepHours: avg(visitHealth.map(h => h.sleepDuration != null ? h.sleepDuration / 60 : null)),
      mood: avg(visitMoods.map(m => m.mood)),
      hrv: avg(visitHealth.map(h => h.hrv)),
      steps: avg(visitHealth.map(h => h.steps)),
      restingHR: avg(visitHealth.map(h => h.restingHR)),
    },
    nonVisitAvg: {
      readiness: avg(nonVisitHealth.map(h => h.readinessScore)),
      sleepHours: avg(nonVisitHealth.map(h => h.sleepDuration != null ? h.sleepDuration / 60 : null)),
      mood: avg(nonVisitMoods.map(m => m.mood)),
      hrv: avg(nonVisitHealth.map(h => h.hrv)),
      steps: avg(nonVisitHealth.map(h => h.steps)),
      restingHR: avg(nonVisitHealth.map(h => h.restingHR)),
    },
  }

  return NextResponse.json(result)
}
