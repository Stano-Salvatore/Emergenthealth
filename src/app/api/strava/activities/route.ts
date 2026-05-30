import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export interface StravaActivityRow {
  id: string
  userId: string
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

export interface WeeklyStats {
  week: string
  distanceKm: number
  durationMin: number
  count: number
}

export interface StravaActivitiesResponse {
  connected: boolean
  activities: StravaActivityRow[]
  weeklyStats: WeeklyStats[]
}

// Returns ISO week string "YYYY-Www" for a given date
function isoWeek(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  // Thursday in current week determines the year
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const year = d.getFullYear()
  const week1 = new Date(year, 0, 4)
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  ) + 1
  return `${year}-W${String(weekNum).padStart(2, "0")}`
}

// Returns "Mon DD" label for the Monday of a given week string
function weekLabel(weekStr: string): string {
  const [yearStr, wStr] = weekStr.split("-W")
  const year = parseInt(yearStr)
  const weekNum = parseInt(wStr)
  // Jan 4 is always in week 1
  const jan4 = new Date(year, 0, 4)
  // Monday of week 1
  const mondayW1 = new Date(jan4)
  mondayW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  // Monday of requested week
  const monday = new Date(mondayW1)
  monday.setDate(mondayW1.getDate() + (weekNum - 1) * 7)
  return monday.toLocaleDateString("en-GB", { month: "short", day: "numeric" })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  // Check if user is connected to Strava
  const tokenRows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "StravaToken" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { userId: string }[])
  const connected = tokenRows.length > 0

  if (!connected) {
    return NextResponse.json({ connected: false, activities: [], weeklyStats: [] })
  }

  // Fetch last 50 activities ordered by startDate DESC
  const activities = await prisma.$queryRaw<StravaActivityRow[]>`
    SELECT
      "id", "userId", "stravaId", "type", "name",
      "distanceM", "movingTimeSec", "elapsedTimeSec",
      "elevationM", "avgHR", "maxHR", "startDate", "day"
    FROM "StravaActivity"
    WHERE "userId" = ${userId}
    ORDER BY "startDate" DESC
    LIMIT 50
  `.catch(() => [] as StravaActivityRow[])

  // Compute weekly stats for the last 12 weeks
  const twelveWeeksAgo = new Date()
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 12 * 7)
  const cutoff = twelveWeeksAgo.toISOString().slice(0, 10)

  const recentActivities = await prisma.$queryRaw<StravaActivityRow[]>`
    SELECT "distanceM", "movingTimeSec", "startDate"
    FROM "StravaActivity"
    WHERE "userId" = ${userId}
      AND "day" >= ${cutoff}
    ORDER BY "startDate" ASC
  `.catch(() => [] as StravaActivityRow[])

  // Build weekly buckets
  const weekMap = new Map<string, { distanceKm: number; durationMin: number; count: number }>()

  // Pre-populate last 12 weeks (so weeks with zero activities still appear)
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i * 7)
    const wk = isoWeek(d)
    if (!weekMap.has(wk)) {
      weekMap.set(wk, { distanceKm: 0, durationMin: 0, count: 0 })
    }
  }

  for (const act of recentActivities) {
    const wk = isoWeek(new Date(act.startDate))
    const bucket = weekMap.get(wk) ?? { distanceKm: 0, durationMin: 0, count: 0 }
    bucket.distanceKm += (act.distanceM ?? 0) / 1000
    bucket.durationMin += act.movingTimeSec / 60
    bucket.count += 1
    weekMap.set(wk, bucket)
  }

  // Sort by week and build response, keeping only weeks within the 12-week window
  const currentWeek = isoWeek(new Date())
  const allWeeksSorted = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    // Only include weeks up to (and including) the current week
    .filter(([wk]) => wk <= currentWeek)
    .slice(-12)

  const weeklyStats: WeeklyStats[] = allWeeksSorted.map(([week, stats]) => ({
    week: weekLabel(week),
    distanceKm: Math.round(stats.distanceKm * 10) / 10,
    durationMin: Math.round(stats.durationMin),
    count: stats.count,
  }))

  return NextResponse.json({ connected, activities, weeklyStats })
}
