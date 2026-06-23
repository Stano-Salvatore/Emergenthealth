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

function isoWeek(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const year = d.getFullYear()
  const week1 = new Date(year, 0, 4)
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  ) + 1
  return `${year}-W${String(weekNum).padStart(2, "0")}`
}

function weekLabel(weekStr: string): string {
  const [yearStr, wStr] = weekStr.split("-W")
  const year = parseInt(yearStr)
  const weekNum = parseInt(wStr)
  const jan4 = new Date(year, 0, 4)
  const mondayW1 = new Date(jan4)
  mondayW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  const monday = new Date(mondayW1)
  monday.setDate(mondayW1.getDate() + (weekNum - 1) * 7)
  return monday.toLocaleDateString("en-GB", { month: "short", day: "numeric" })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const token = await prisma.stravaToken.findUnique({ where: { userId }, select: { userId: true } }).catch(() => null)
  if (!token) return NextResponse.json({ connected: false, activities: [], weeklyStats: [] })

  const [activities, recentActivities] = await Promise.all([
    prisma.stravaActivity.findMany({
      where: { userId },
      orderBy: { startDate: "desc" },
      take: 50,
    }).catch(() => []),
    prisma.stravaActivity.findMany({
      where: { userId, day: { gte: new Date(Date.now() - 12 * 7 * 86400000).toISOString().slice(0, 10) } },
      orderBy: { startDate: "asc" },
      select: { distanceM: true, movingTimeSec: true, startDate: true },
    }).catch(() => []),
  ])

  const weekMap = new Map<string, { distanceKm: number; durationMin: number; count: number }>()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i * 7)
    const wk = isoWeek(d)
    if (!weekMap.has(wk)) weekMap.set(wk, { distanceKm: 0, durationMin: 0, count: 0 })
  }
  for (const act of recentActivities) {
    const wk = isoWeek(new Date(act.startDate))
    const bucket = weekMap.get(wk) ?? { distanceKm: 0, durationMin: 0, count: 0 }
    bucket.distanceKm += (act.distanceM ?? 0) / 1000
    bucket.durationMin += act.movingTimeSec / 60
    bucket.count += 1
    weekMap.set(wk, bucket)
  }

  const currentWeek = isoWeek(new Date())
  const weeklyStats: WeeklyStats[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([wk]) => wk <= currentWeek)
    .slice(-12)
    .map(([week, stats]) => ({
      week: weekLabel(week),
      distanceKm: Math.round(stats.distanceKm * 10) / 10,
      durationMin: Math.round(stats.durationMin),
      count: stats.count,
    }))

  return NextResponse.json({ connected: true, activities, weeklyStats })
}
