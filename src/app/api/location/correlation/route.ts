import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const placeId = searchParams.get("placeId")
  if (!placeId) return NextResponse.json({ error: "placeId required" }, { status: 400 })

  const userId = session.user.id
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  // SavedPlace and isAuto/savedPlaceId may not exist in the schema on this branch
  // Fall back gracefully if these tables/columns don't exist
  type SavedPlaceRow = { id: string; name: string; emoji: string }
  type CheckInRow = { checkedAt: Date }
  type HealthLogRow = { date: Date; readinessScore: number | null; sleepDuration: number | null }
  type MoodLogRow = { date: Date; mood: number }

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
      select: { date: true, readinessScore: true, sleepDuration: true },
    }),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, mood: true },
    }),
  ])

  if (checkIns.length < 3) return NextResponse.json({ visitCount: checkIns.length, insufficient: true })

  const visitDates = new Set(checkIns.map(c => new Date(c.checkedAt).toISOString().split("T")[0]))

  function avg(nums: (number | null)[]): number | null {
    const valid = nums.filter((n): n is number => n != null)
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null
  }

  const visitHealth = healthLogs.filter(h => visitDates.has(h.date.toISOString().split("T")[0]))
  const nonVisitHealth = healthLogs.filter(h => !visitDates.has(h.date.toISOString().split("T")[0]))
  const visitMoods = moodLogs.filter(m => visitDates.has(m.date.toISOString().split("T")[0]))
  const nonVisitMoods = moodLogs.filter(m => !visitDates.has(m.date.toISOString().split("T")[0]))

  return NextResponse.json({
    placeId: place.id,
    placeName: place.name,
    placeEmoji: place.emoji,
    visitCount: checkIns.length,
    visitAvg: {
      readiness: avg(visitHealth.map(h => h.readinessScore)),
      sleepHours: avg(visitHealth.map(h => h.sleepDuration != null ? h.sleepDuration / 60 : null)),
      mood: avg(visitMoods.map(m => m.mood)),
    },
    nonVisitAvg: {
      readiness: avg(nonVisitHealth.map(h => h.readinessScore)),
      sleepHours: avg(nonVisitHealth.map(h => h.sleepDuration != null ? h.sleepDuration / 60 : null)),
      mood: avg(nonVisitMoods.map(m => m.mood)),
    },
  })
}
