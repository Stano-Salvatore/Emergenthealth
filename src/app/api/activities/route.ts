import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

interface StravaActivityRow {
  id: string
  stravaId: string
  type: string
  name: string | null
  distanceM: number | null
  movingTimeSec: number
  elapsedTimeSec: number
  elevationM: number | null
  avgHR: number | null
  maxHR: number | null
  startDate: Date
  day: string
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const activities = await prisma.$queryRaw<StravaActivityRow[]>`
    SELECT
      "id", "stravaId", "type", "name",
      "distanceM", "movingTimeSec", "elapsedTimeSec", "elevationM",
      "avgHR", "maxHR", "startDate", "day"
    FROM "StravaActivity"
    WHERE "userId" = ${userId}
      AND "day" >= ${since}
    ORDER BY "startDate" DESC
    LIMIT 30
  `.catch(() => [] as StravaActivityRow[])

  return NextResponse.json({ activities })
}
