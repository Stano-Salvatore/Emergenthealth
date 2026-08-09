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
  // Same-day metrics (activity, steps, mood)
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
  // Next-day metrics: sleep/readiness/HRV on the morning after a visit
  nextDayAvg: {
    readiness: number | null
    sleepHours: number | null
    hrv: number | null
    restingHR: number | null
  } | null
  nonVisitNextDayAvg: {
    readiness: number | null
    sleepHours: number | null
    hrv: number | null
    restingHR: number | null
  } | null
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

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split("T")[0]
}

type SavedPlaceRow = { id: string; name: string; emoji: string }
type CheckInRow = { checkedAt: Date; savedPlaceId: string }
type HealthRow = { date: Date; readinessScore: number | null; sleepDuration: number | null; hrv: number | null; steps: number | null; restingHR: number | null }
type MoodRow = { date: Date; mood: number }

const day = (d: Date) => new Date(d).toISOString().split("T")[0]

// One place's correlation, given data already loaded for the whole account.
// Health and mood history is identical for every place, so it is fetched once
// by the caller rather than re-read per place.
function correlatePlace(
  place: SavedPlaceRow,
  placeCheckIns: CheckInRow[],
  health: HealthRow[],
  moods: MoodRow[],
): PlaceCorrelation {
  const visitDates = new Set(placeCheckIns.map(c => day(c.checkedAt)))
  const postVisitDates = new Set(Array.from(visitDates).map(d => nextDay(d)))

  const healthByDate = new Map(health.map(h => [day(h.date), h]))

  const visitHealth    = health.filter(h =>  visitDates.has(day(h.date)))
  const nonVisitHealth = health.filter(h => !visitDates.has(day(h.date)) && !postVisitDates.has(day(h.date)))
  const visitMoods     = moods.filter(m =>  visitDates.has(day(m.date)))
  const nonVisitMoods  = moods.filter(m => !visitDates.has(day(m.date)))

  const nextDayHealth = Array.from(postVisitDates).map(d => healthByDate.get(d)).filter((h): h is HealthRow => h != null)
  const allDates = new Set(health.map(h => day(h.date)))
  const nonVisitDates = Array.from(allDates).filter(d => !visitDates.has(d))
  const nonVisitNextDayHealth = nonVisitDates.map(d => healthByDate.get(nextDay(d))).filter((h): h is HealthRow => h != null)

  const hasNextDay = nextDayHealth.length >= 3

  return {
    placeId: place.id,
    placeName: place.name,
    placeEmoji: place.emoji,
    visitCount: placeCheckIns.length,
    confidence: confidence(placeCheckIns.length),
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
    nextDayAvg: hasNextDay ? {
      readiness: avg(nextDayHealth.map(h => h.readinessScore)),
      sleepHours: avg(nextDayHealth.map(h => h.sleepDuration != null ? h.sleepDuration / 60 : null)),
      hrv: avg(nextDayHealth.map(h => h.hrv)),
      restingHR: avg(nextDayHealth.map(h => h.restingHR)),
    } : null,
    nonVisitNextDayAvg: hasNextDay ? {
      readiness: avg(nonVisitNextDayHealth.map(h => h.readinessScore)),
      sleepHours: avg(nonVisitNextDayHealth.map(h => h.sleepDuration != null ? h.sleepDuration / 60 : null)),
      hrv: avg(nonVisitNextDayHealth.map(h => h.hrv)),
      restingHR: avg(nonVisitNextDayHealth.map(h => h.restingHR)),
    } : null,
  }
}

// `placeId` returns one correlation; `placeIds` (comma-separated) returns an
// array. The Insights panel needs every place at once, and asking per place
// re-read the whole 90-day health and mood history once per place.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const single = searchParams.get("placeId")
  const many = searchParams.get("placeIds")?.split(",").map(s => s.trim()).filter(Boolean) ?? []
  const ids = single ? [single] : many
  if (!ids.length) return NextResponse.json({ error: "placeId or placeIds required" }, { status: 400 })
  if (ids.length > 50) return NextResponse.json({ error: "too many places" }, { status: 400 })

  const userId = session.user.id
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const places = await prisma.$queryRaw<SavedPlaceRow[]>`
    SELECT id, name, emoji FROM "SavedPlace" WHERE id = ANY(${ids}::text[]) AND "userId" = ${userId}
  `.catch(() => [] as SavedPlaceRow[])

  if (!places.length) {
    return single
      ? NextResponse.json({ error: "Place not found" }, { status: 404 })
      : NextResponse.json([])
  }

  const [checkIns, healthLogs, moodLogs] = await Promise.all([
    prisma.$queryRaw<CheckInRow[]>`
      SELECT "checkedAt", "savedPlaceId" FROM "CheckIn"
      WHERE "userId" = ${userId}
        AND "savedPlaceId" = ANY(${ids}::text[])
        AND "isAuto" = true
        AND "checkedAt" >= ${since}
    `.catch(() => [] as CheckInRow[]),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, readinessScore: true, sleepDuration: true, hrv: true, steps: true, restingHR: true },
    }),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, mood: true },
    }),
  ])

  const byPlace = new Map<string, CheckInRow[]>()
  for (const c of checkIns as CheckInRow[]) {
    const list = byPlace.get(c.savedPlaceId)
    if (list) list.push(c)
    else byPlace.set(c.savedPlaceId, [c])
  }

  const results = places.map(place =>
    correlatePlace(place, byPlace.get(place.id) ?? [], healthLogs as HealthRow[], moodLogs as MoodRow[])
  )

  return NextResponse.json(single ? results[0] : results)
}
