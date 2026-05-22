import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { subDays, format } from "date-fns"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const since30 = subDays(new Date(), 29)

  const [logs, focusSessions, intakeLogs] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since30 } },
      orderBy: { date: "desc" },
      select: { date: true, sleepDuration: true, steps: true, readinessScore: true, activityScore: true, hrv: true },
    }),
    prisma.focusSession.findMany({
      where: { userId, endedAt: { gte: since30 }, type: "focus" },
      select: { durationMin: true, endedAt: true },
    }).catch(() => []),
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: since30 }, type: "water" },
      select: { amountMl: true, loggedAt: true },
    }).catch(() => []),
  ])

  // Weekly patterns: group by day of week (0=Sun)
  const byDow: Record<number, { sleep: number[]; steps: number[]; readiness: number[] }> = {}
  for (let i = 0; i < 7; i++) byDow[i] = { sleep: [], steps: [], readiness: [] }

  for (const l of logs) {
    const dow = l.date.getDay()
    if (l.sleepDuration != null) byDow[dow].sleep.push(l.sleepDuration / 60)
    if (l.steps != null) byDow[dow].steps.push(l.steps)
    if (l.readinessScore != null) byDow[dow].readiness.push(l.readinessScore)
  }

  function avg(arr: number[]) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null }

  const dowStats = [0,1,2,3,4,5,6].map(d => ({
    day: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d],
    avgSleep: avg(byDow[d].sleep),
    avgSteps: avg(byDow[d].steps),
    avgReadiness: avg(byDow[d].readiness),
  }))

  // Focus by day of week
  const focusByDow: Record<number, number[]> = {}
  for (let i = 0; i < 7; i++) focusByDow[i] = []
  for (const s of focusSessions) {
    focusByDow[new Date(s.endedAt).getDay()].push(s.durationMin)
  }
  const focusDowStats = [0,1,2,3,4,5,6].map(d => ({
    day: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d],
    avgFocusMin: avg(focusByDow[d]),
  }))

  // 7-day moving averages
  const trend7 = logs.slice(0, 7)
  const prev7 = logs.slice(7, 14)
  function avgF(arr: (number|null)[]) {
    const v = arr.filter((x): x is number => x != null)
    return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null
  }

  const trendData = {
    sleep: {
      current: avgF(trend7.map(l => l.sleepDuration != null ? l.sleepDuration/60 : null)),
      prev: avgF(prev7.map(l => l.sleepDuration != null ? l.sleepDuration/60 : null)),
    },
    steps: {
      current: avgF(trend7.map(l => l.steps)),
      prev: avgF(prev7.map(l => l.steps)),
    },
    readiness: {
      current: avgF(trend7.map(l => l.readinessScore)),
      prev: avgF(prev7.map(l => l.readinessScore)),
    },
    hrv: {
      current: avgF(trend7.map(l => l.hrv)),
      prev: avgF(prev7.map(l => l.hrv)),
    },
  }

  // Best/worst insights
  const sleepLogs = logs.filter(l => l.sleepDuration != null)
  const bestSleepDay = sleepLogs.length ? sleepLogs.reduce((best, l) =>
    l.sleepDuration! > best.sleepDuration! ? l : best
  ) : null
  const bestStepsDay = logs.filter(l => l.steps != null).reduce<typeof logs[0] | null>((best, l) =>
    !best || l.steps! > best.steps! ? l : best, null)

  // Water streak
  const waterByDay: Record<string, number> = {}
  for (const w of intakeLogs) {
    const d = format(new Date(w.loggedAt), "yyyy-MM-dd")
    waterByDay[d] = (waterByDay[d] ?? 0) + w.amountMl
  }
  let waterStreak = 0
  const cursor = new Date()
  while (true) {
    const d = format(cursor, "yyyy-MM-dd")
    if ((waterByDay[d] ?? 0) >= 2000) { waterStreak++; cursor.setDate(cursor.getDate()-1) }
    else break
    if (waterStreak > 30) break
  }

  return NextResponse.json({
    dowStats,
    focusDowStats,
    trendData,
    bestSleepDay: bestSleepDay ? {
      date: format(bestSleepDay.date, "MMM d"),
      sleepH: (bestSleepDay.sleepDuration! / 60).toFixed(1),
    } : null,
    bestStepsDay: bestStepsDay ? {
      date: format(bestStepsDay.date, "MMM d"),
      steps: bestStepsDay.steps!.toLocaleString(),
    } : null,
    waterStreak,
    totalFocusMin30: focusSessions.reduce((a, s) => a + s.durationMin, 0),
  })
}
